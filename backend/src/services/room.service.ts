import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  IRoom,
  IVideoMetadata,
  CreateRoomDTO,
  IParticipant,
  IJoinRequest,
  IKickedParticipant,
} from '../types/room.types.js';
import { roomRepository } from '../adapters/room-repository.routing.js';
import {
  DEMO_MAX_ROOMS,
  DEMO_MAX_USERS_PER_ROOM,
  DEMO_ROOM_FULL_MESSAGE,
  DEMO_ROOM_LIMIT_MESSAGE,
  isDemoMode,
} from '../config/demo-mode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '../../uploads');

function cleanIdOf(roomId: string): string {
  return roomId.toUpperCase().trim();
}

/** Error de cuota demo (HTTP 429). Los controladores lo traducen al contrato exacto. */
export type DemoCapacityCode = 'DEMO_ROOM_LIMIT' | 'DEMO_ROOM_FULL';

export class DemoCapacityError extends Error {
  readonly statusCode = 429;
  readonly code: DemoCapacityCode;
  constructor(code: DemoCapacityCode, message: string) {
    super(message);
    this.name = 'DemoCapacityError';
    this.code = code;
  }
}

/**
 * Mutex async simple en memoria (cola FIFO de adquirentes).
 * Protege las secciones críticas crear-contando y leer-modificar-escribir de
 * participantes: Node es single-thread pero los `await` intercalan operaciones
 * concurrentes (dos creates/joins paralelos leerían el mismo conteo).
 * ASUME 1 INSTANCIA (Render Free): con varias réplicas cada una serializaría
 * solo su propio proceso y contaría solo su store visible.
 */
class AsyncMutex {
  private locked = false;
  private readonly queue: Array<() => void> = [];

  get isLocked(): boolean {
    return this.locked;
  }

  get waiters(): number {
    return this.queue.length;
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.locked) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.locked = true;
    }
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/** Mutex global para la sección crítica contar+crear salas. */
const createRoomMutex = new AsyncMutex();

/** Mutex por sala para la reserva de cupo en join/approve (se reciclan al quedar libres). */
const joinRoomMutexes = new Map<string, AsyncMutex>();

async function withRoomLock<T>(cleanId: string, fn: () => Promise<T>): Promise<T> {
  let mutex = joinRoomMutexes.get(cleanId);
  if (!mutex) {
    mutex = new AsyncMutex();
    joinRoomMutexes.set(cleanId, mutex);
  }
  try {
    return await mutex.run(fn);
  } finally {
    if (!mutex.isLocked && mutex.waiters === 0) {
      joinRoomMutexes.delete(cleanId);
    }
  }
}

export class RoomService {
  /**
   * Helper to safely remove an old video file from disk
   */
  public static removeOldVideoFile(fileName: string | undefined): void {
    if (!fileName) return;
    try {
      const filePath = path.join(uploadsDir, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Archivo de video eliminado del servidor: ${fileName}`);
      }
    } catch (err) {
      console.warn('⚠️ No se pudo eliminar el archivo de video:', err);
    }
  }

  /**
   * Generates a readable 6-character room code.
   */
  private static generateRoomCode(length = 6): string {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const bytes = crypto.randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }

  /**
   * Generates a unique room code.
   */
  private static async getUniqueRoomCode(): Promise<string> {
    let roomId = '';
    let exists = true;
    while (exists) {
      roomId = this.generateRoomCode(6);
      exists = await roomRepository.exists(roomId);
    }
    return roomId;
  }

  /**
   * Create a new room with a host.
   *
   * DEMO (flag `DEMO_MODE`): tope de 5 salas vivas por servidor (429 con
   * mensaje exacto) y `isTemporary` forzado a true (ninguna sala permanente).
   * La sección crítica contar+crear va tras mutex en memoria (1 instancia).
   */
  public static async createRoom(dto: CreateRoomDTO): Promise<{ room: IRoom; hostSecret: string }> {
    return createRoomMutex.run(async () => {
      if (isDemoMode()) {
        const liveRooms = await roomRepository.count();
        if (liveRooms >= DEMO_MAX_ROOMS) {
          throw new DemoCapacityError('DEMO_ROOM_LIMIT', DEMO_ROOM_LIMIT_MESSAGE);
        }
      }

      const roomId = await this.getUniqueRoomCode();
      const hostSecret = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      // En demo NINGUNA sala es permanente (se ignora el modo persistente sin borrar su código).
      const isTemporary = isDemoMode()
        ? true
        : (dto.isTemporary !== undefined ? dto.isTemporary : true);
    const roomData: IRoom = {
      roomId,
      hostName: dto.hostName.trim(),
      hostSecret,
      status: 'waiting',
      isTemporary,
      participants: [
        {
          name: dto.hostName.trim(),
          userId: dto.userId,
          isHost: true,
          role: 'host',
          joinedAt: now,
          device: 'Host Web',
        },
      ],
      joinRequests: [],
      kickedUsers: [],
      settings: {
        muteOnEntry: false,
        cameraOffOnEntry: false,
        allowMicReactivation: true,
        allowCamReactivation: true,
        isTemporary,
      },
      createdAt: now,
      updatedAt: now,
    };

    const room = await roomRepository.create(roomData);
      return { room, hostSecret };
    });
  }

  /**
   * Nº de salas vivas en el store activo (mismo proceso; cubre Mongo o memoria
   * según el enrutado). Solo conteo para la cuota demo y el endpoint
   * `GET /api/demo/availability`: jamás expone códigos ni listas (privacidad).
   * NOTA: si el store activo cambia (caída/recuperación de Mongo), el conteo
   * refleja el nuevo activo; las salas del otro store no se suman.
   */
  public static async countLiveRooms(): Promise<number> {
    return roomRepository.count();
  }

  /**
   * Find room by its public ID.
   */
  public static async getRoomById(roomId: string): Promise<IRoom | null> {
    return roomRepository.findById(cleanIdOf(roomId));
  }

  /**
   * Join a room. Identity is the stable `userId` (falls back to name for legacy
   * participants that never claimed an id). This prevents duplicates after a rename.
   *
   * MERGE LEGACY DE ANÓNIMOS (se mantiene a propósito, no convertir en rechazo):
   * dos conexiones sin `userId` con el mismo nombre se fusionan en UN solo
   * participante (segunda rama de `findParticipantIndex`: mismo nombre +
   * `!p.userId`, sin push). Es lo que permite que un refresh/reconexión sin
   * identidad estable no duplique la lista. Es seguro porque (a) la guarda
   * previa `isNameTaken` (socket join-room / REST join) ya rechazó al anónimo
   * cuyo nombre pertenece a una identidad REGISTRADA (con userId), así que el
   * merge solo ocurre entre anónimos entre sí; (b) si el segundo join trae
   * `userId`, la entrada legacy lo adopta (claim) en vez de duplicarse; (c) el
   * estado efímero no fuga: `activeUsers`/`activeMediaStates` van por socket.id
   * (se borran en disconnect/leave) y `roomPositions` por socket.id (dropPosition
   * + TTL de 12s); (d) la gracia de desconexión (20s) solo existe por userId, así
   * que el anónimo conserva su eliminación inmediata original.
   */
  public static async joinRoom(
    roomId: string,
    userName: string,
    device = 'Web Browser',
    userId?: string
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    const trimmedName = userName.trim();
    // Reserva atómica del cupo: leer+insertar+guardar bajo el mutex de la sala.
    return withRoomLock(cleanId, () => this.joinRoomLocked(cleanId, trimmedName, device, userId));
  }

  /**
   * Núcleo de join (ASUME el mutex de la sala ya adquirido). Reserva el cupo
   * al añadir al participante; en demo, un genuinely-nuevo participante con
   * la sala llena (≥5) lanza `DemoCapacityError`. Rejoin/claim/merge legacy
   * NO consumen cupo y nunca se rechazan por lleno.
   */
  private static async joinRoomLocked(
    cleanId: string,
    trimmedName: string,
    device: string,
    userId?: string
  ): Promise<IRoom | null> {
    const findParticipantIndex = (participants: IParticipant[]): number => {
      if (userId) {
        const byId = participants.findIndex((p) => p.userId === userId);
        if (byId !== -1) return byId;
      }
      // Legacy participants without a claimed userId (same name = same person)
      return participants.findIndex(
        (p) => p.name.toLowerCase() === trimmedName.toLowerCase() && !p.userId
      );
    };

    const room = await roomRepository.findById(cleanId);
    if (!room) return null;

    const existingIndex = findParticipantIndex(room.participants);

    if (existingIndex === -1) {
      if (isDemoMode() && room.participants.length >= DEMO_MAX_USERS_PER_ROOM) {
        throw new DemoCapacityError('DEMO_ROOM_FULL', DEMO_ROOM_FULL_MESSAGE);
      }
      const isHost = room.hostName.toLowerCase() === trimmedName.toLowerCase();
      room.participants.push({
        name: trimmedName,
        userId,
        isHost,
        role: isHost ? 'host' : 'member',
        joinedAt: new Date(),
        device,
      });
      room.updatedAt = new Date();
      await roomRepository.save(room);
    } else if (userId && !room.participants[existingIndex].userId) {
      room.participants[existingIndex].userId = userId;
      room.updatedAt = new Date();
      await roomRepository.save(room);
    }
    return room;
  }

  /** ¿Añadiría (userId, nombre) un participante NUEVO (consume cupo)? */
  private static wouldAddParticipant(
    participants: IParticipant[],
    userId: string | undefined,
    trimmedName: string
  ): boolean {
    if (userId) {
      if (participants.some((p) => p.userId === userId)) return false;
    }
    // Merge legacy: mismo nombre sin userId registrado = la misma persona.
    if (participants.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase() && !p.userId)) {
      return false;
    }
    return true;
  }

  /**
   * Change a participant's role (e.g. promote to cohost or demote)
   */
  public static async setParticipantRole(
    roomId: string,
    targetName: string,
    newRole: 'cohost' | 'member'
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    const room = await roomRepository.findById(cleanId);
    if (!room) return null;
    const target = room.participants.find(
      (p) => p.name.toLowerCase() === targetName.trim().toLowerCase()
    );
    if (target && !target.isHost) {
      target.role = newRole;
      room.updatedAt = new Date();
      await roomRepository.save(room);
    }
    return room;
  }

  /**
   * Rename a participant in room. Identified by userId (name is only a legacy fallback).
   */
  public static async renameParticipant(
    roomId: string,
    newName: string,
    target: { userId?: string; oldName?: string }
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    const cleanNewName = newName.trim();
    if (!cleanNewName) return null;

    const matches = (p: IParticipant): boolean => {
      if (target.userId && p.userId) return p.userId === target.userId;
      if (target.oldName) return p.name.toLowerCase() === target.oldName.trim().toLowerCase();
      return false;
    };

    const room = await roomRepository.findById(cleanId);
    if (!room) return null;
    const participant = room.participants.find(matches);
    if (participant) {
      participant.name = cleanNewName;
      if (participant.isHost) room.hostName = cleanNewName;
      room.updatedAt = new Date();
      await roomRepository.save(room);
    }
    return room;
  }

  /**
   * Kick (ban=false → can rejoin) or Ban (ban=true → rejoin blocked) a participant.
   */
  public static async kickParticipant(
    roomId: string,
    target: { name: string; userId?: string },
    kickedBy: string,
    ban = false
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);

    const matches = (p: IParticipant): boolean => {
      if (target.userId && p.userId) return p.userId === target.userId;
      return p.name.toLowerCase() === target.name.trim().toLowerCase();
    };

    const record = (p: IParticipant) => ({
      name: p.name,
      userId: p.userId || target.userId,
      kickedAt: new Date(),
      kickedBy,
      banned: ban,
    });

    const room = await roomRepository.findById(cleanId);
    if (!room) return null;
    const targetIndex = room.participants.findIndex(matches);
    if (targetIndex !== -1 && !room.participants[targetIndex].isHost) {
      const removed = room.participants[targetIndex];
      room.participants = room.participants.filter((_, i) => i !== targetIndex);
      if (!room.kickedUsers) room.kickedUsers = [];
      room.kickedUsers.push(record(removed));
      room.updatedAt = new Date();
      await roomRepository.save(room);
    }
    return room;
  }

  /**
   * Remove a user from the kicked/banned list (unban).
   */
  public static async unbanParticipant(
    roomId: string,
    target: { name?: string; userId?: string }
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);

    const matches = (k: IKickedParticipant): boolean => {
      if (target.userId && k.userId) return k.userId === target.userId;
      if (target.name) return k.name.toLowerCase() === target.name.trim().toLowerCase();
      return false;
    };

    const room = await roomRepository.findById(cleanId);
    if (!room) return null;
    room.kickedUsers = (room.kickedUsers || []).filter((k) => !matches(k));
    room.updatedAt = new Date();
    await roomRepository.save(room);
    return room;
  }

  // ── Join requests (manual approval / waiting list) ────────────────────────

  /**
   * Add a join request (dedupes by userId). Returns the updated room.
   */
  public static async addJoinRequest(
    roomId: string,
    req: { socketId: string; userId?: string; name: string; device?: string }
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);

    const build = (existing: IJoinRequest[]): IJoinRequest[] | null => {
      const dup = existing.some(
        (j) => (req.userId && j.userId === req.userId) || j.name.toLowerCase() === req.name.toLowerCase()
      );
      if (dup) return null;
      return [
        ...existing,
        {
          socketId: req.socketId,
          userId: req.userId,
          name: req.name,
          requestedAt: new Date(),
          device: req.device || 'Web Browser',
        },
      ];
    };

    const room = await roomRepository.findById(cleanId);
    if (!room) return null;
    const next = build(room.joinRequests || []);
    if (next) {
      room.joinRequests = next;
      room.updatedAt = new Date();
      await roomRepository.save(room);
    }
    return room;
  }

  /**
   * Approve a join request: moves the requester into the participants list.
   *
   * DEMO: si la sala está llena y la solicitud añadiría un participante nuevo,
   * lanza `DemoCapacityError` SIN desencolar (la solicitud sigue en espera y
   * el host puede aprobar más tarde). Todo ello bajo el mutex de la sala.
   */
  public static async approveJoinRequest(
    roomId: string,
    target: { userId?: string; name?: string }
  ): Promise<{ room: IRoom | null; request: IJoinRequest | null }> {
    const cleanId = cleanIdOf(roomId);

    const matches = (j: IJoinRequest): boolean => {
      if (target.userId && j.userId) return j.userId === target.userId;
      if (target.name) return j.name.toLowerCase() === target.name.trim().toLowerCase();
      return false;
    };

    return withRoomLock(cleanId, async () => {
      const room = await roomRepository.findById(cleanId);
      if (!room) return { room: null, request: null };
      const request = (room.joinRequests || []).find(matches) || null;
      if (!request) return { room, request: null };
      if (
        isDemoMode() &&
        this.wouldAddParticipant(room.participants, request.userId, request.name.trim()) &&
        room.participants.length >= DEMO_MAX_USERS_PER_ROOM
      ) {
        throw new DemoCapacityError('DEMO_ROOM_FULL', DEMO_ROOM_FULL_MESSAGE);
      }
      room.joinRequests = (room.joinRequests || []).filter((j) => !matches(j));
      room.updatedAt = new Date();
      await roomRepository.save(room);
      // joinRoomLocked (no el público): el mutex ya está adquirido.
      const updated = await this.joinRoomLocked(
        cleanId,
        request.name.trim(),
        request.device || 'Web Browser',
        request.userId
      );
      const refreshed = updated ?? (await roomRepository.findById(cleanId));
      return { room: refreshed, request };
    });
  }

  /**
   * Reject a join request; when ban=true the user is also banned from rejoining.
   */
  public static async rejectJoinRequest(
    roomId: string,
    target: { userId?: string; name?: string },
    opts: { ban?: boolean; rejectedBy?: string } = {}
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);

    const matches = (j: IJoinRequest): boolean => {
      if (target.userId && j.userId) return j.userId === target.userId;
      if (target.name) return j.name.toLowerCase() === target.name.trim().toLowerCase();
      return false;
    };

    const room = await roomRepository.findById(cleanId);
    if (!room) return null;
    const request = (room.joinRequests || []).find(matches);
    if (!request) return room;
    room.joinRequests = (room.joinRequests || []).filter((j) => !matches(j));
    if (opts.ban) {
      if (!room.kickedUsers) room.kickedUsers = [];
      room.kickedUsers.push({
        name: request.name,
        userId: request.userId,
        kickedAt: new Date(),
        kickedBy: opts.rejectedBy || 'Afitrión',
        banned: true,
      });
    }
    room.updatedAt = new Date();
    await roomRepository.save(room);
    return room;
  }

  /**
   * Update Room Settings (e.g. mute on entry, disable camera on entry)
   *
   * DEMO: fuerza `isTemporary=true` (ninguna sala permanente; se ignora el
   * modo persistente sin borrar su código).
   */
  public static async updateSettings(
    roomId: string,
    settings: Partial<IRoom['settings']>
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    const room = await roomRepository.findById(cleanId);
    if (!room) return null;
    // En demo ninguna sala es permanente (sin mutar el objeto del llamador).
    const demoForced = isDemoMode() ? { isTemporary: true as const } : {};
    room.settings = { ...(room.settings || {}), ...settings, ...demoForced } as IRoom['settings'];
    if (isDemoMode()) {
      room.isTemporary = true;
    }
    room.updatedAt = new Date();
    await roomRepository.save(room);
    return room;
  }

  /**
   * Rooms whose auto-close timer (settings.timerEndsAt) has already expired.
   * Used by the periodic sweep that closes rooms when their timer reaches 0.
   */
  public static async getRoomsPastTimer(): Promise<IRoom[]> {
    const now = Date.now();
    const isExpired = (room: IRoom): boolean => {
      const endsAt = (room.settings as Record<string, unknown> | undefined)?.timerEndsAt;
      if (!endsAt || typeof endsAt !== 'string') return false;
      const parsed = new Date(endsAt).getTime();
      return !Number.isNaN(parsed) && parsed <= now;
    };

    const candidates = await roomRepository.findTimerCandidates();
    return candidates.filter(isExpired);
  }

  /**
   * Remove a participant and transfer Host role to the next participant if the host left.
   */
  public static async removeParticipantAndTransferHost(
    roomId: string,
    userName: string,
    userId?: string
  ): Promise<{ room: IRoom | null; newHostName: string | null }> {
    const cleanId = cleanIdOf(roomId);

    const matches = (p: IParticipant): boolean => {
      if (userId && p.userId) return p.userId === userId;
      return p.name.toLowerCase() === userName.toLowerCase();
    };

    const room = await roomRepository.findById(cleanId);
    if (!room) return { room: null, newHostName: null };

    let newHostName: string | null = null;
    const wasHost = room.participants.some((p) => matches(p) && p.isHost);

    room.participants = room.participants.filter((p) => !matches(p));

    if (wasHost && room.participants.length > 0) {
      room.participants[0].isHost = true;
      room.participants[0].role = 'host';
      room.hostName = room.participants[0].name;
      newHostName = room.participants[0].name;
      console.log(`👑 Rol de Affitrión transferido a: ${newHostName} en la sala ${cleanId}`);
    }

    room.updatedAt = new Date();
    await roomRepository.save(room);

    if (isDemoMode() && room.participants.length === 0) {
      // Cuota demo: la sala que queda vacía se borra para liberar el cupo de
      // las 5 salas (ver reporte: fuera de demo las salas vacías PERSISTEN —
      // el código real solo limpiaba el playback en memoria, no la sala).
      // El cupo se libera al eliminar de verdad (incluida la gracia de 20s,
      // que solo elimina al expirar), nunca al desconectar.
      await this.deleteRoom(cleanId, false);
      console.log(`🧹 Demo: sala vacía [${cleanId}] eliminada para liberar cupo.`);
    }

    return { room, newHostName };
  }

  /**
   * Delete room and cleanup its uploaded video file.
   * @param forceDeleteVideo  When true the video file is always removed from disk
   *   (used when the host deliberately closes/deletes the room vs auto-cleanup).
   */
  public static async deleteRoom(roomId: string, forceDeleteVideo = false): Promise<boolean> {
    const cleanId = cleanIdOf(roomId);
    const room = await roomRepository.findById(cleanId);
    if (!room) return false;

    const videoFile = room.video?.fileName;
    const sourceType = room.video?.sourceType;
    const isTemp = room.isTemporary !== false;
    await roomRepository.delete(cleanId);

    // Delete the physical video file if:
    //  1. forceDeleteVideo was requested (host explicitly destroyed the room), or
    //  2. the room was temporary (auto-cleanup)
    // For URL/HLS sources there is no physical file to remove.
    const hasLocalFile = sourceType === 'file' || !sourceType;
    if (videoFile && hasLocalFile && (forceDeleteVideo || isTemp)) {
      this.removeOldVideoFile(videoFile);
    } else if (videoFile && hasLocalFile && !isTemp) {
      console.log(`💾 Sala no temporal [${cleanId}]: Archivo de video conservado en servidor: ${videoFile}`);
    }

    console.log(`❌ Sala [${cleanId}] eliminada permanentemente (temporal: ${isTemp}, forceDelete: ${forceDeleteVideo})`);
    return true;
  }

  /**
   * Update or replace the video of a room.
   */
  public static async updateRoomVideo(roomId: string, video: IVideoMetadata): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);

    const room = await roomRepository.findById(cleanId);
    if (!room) return null;

    if (room.video && room.video.fileName !== video.fileName) {
      this.removeOldVideoFile(room.video.fileName);
    }

    room.video = video;
    room.status = 'active';
    room.updatedAt = new Date();
    await roomRepository.save(room);
    return room;
  }
}
