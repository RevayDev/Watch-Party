import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  IRoom,
  IMusicQueueEntry,
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
/** Plan efectivo de una sala (siempre 'free': sin premium). */
export function getRoomPlan(_room: Pick<IRoom, 'plan'>): 'free' {
  return 'free';
}

/** Cupo de participantes (demo: tope fijo). */
export function maxUsersForRoom(_room: Pick<IRoom, 'plan'>): number {
  return DEMO_MAX_USERS_PER_ROOM;
}

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
    // No bloqueante: evita existsSync/unlinkSync en el event loop.
    // El borrado es mejor esfuerzo; ENOENT se ignora en silencio.
    const filePath = path.join(uploadsDir, fileName);
    void fs.promises.unlink(filePath).then(
      () => console.log(`🗑️ Archivo de video eliminado del servidor: ${fileName}`),
      (err: unknown) => {
        const code = (err as { code?: string } | null)?.code;
        if (code !== 'ENOENT') console.warn('⚠️ No se pudo eliminar el archivo de video:', err);
      }
    );
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
   * Create a new room with a leader.
   *
   * DEMO (flag `DEMO_MODE`): tope de 5 salas vivas por servidor (429 con
   * mensaje exacto). Todas las salas son 'free' con `isTemporary` forzado
   * a true (ninguna sala permanente).
   * La sección crítica contar+crear va tras mutex en memoria (1 instancia).
   */
  public static async createRoom(dto: CreateRoomDTO): Promise<{ room: IRoom; leaderSecret: string }> {
    return createRoomMutex.run(async () => {
      if (isDemoMode()) {
        const liveRooms = await roomRepository.count();
        if (liveRooms >= DEMO_MAX_ROOMS) {
          throw new DemoCapacityError('DEMO_ROOM_LIMIT', DEMO_ROOM_LIMIT_MESSAGE);
        }
      }

      const roomId = await this.getUniqueRoomCode();
      const leaderSecret = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      const plan = 'free' as const;
      // En demo NINGUNA sala es permanente.
      const isTemporary = isDemoMode()
        ? true
        : (dto.isTemporary !== undefined ? dto.isTemporary : true);
    const roomData: IRoom = {
      roomId,
      leaderName: dto.leaderName.trim(),
      leaderSecret,
      status: 'waiting',
      isTemporary,
      plan,
      participants: [
        {
          name: dto.leaderName.trim(),
          userId: dto.userId,
          isLeader: true,
          role: 'leader',
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
        // timerEndsAt se establece cuando entra el primer participante no-leader
        // (disparador: waiting → active). Ver joinRoomLocked.
      },
      createdAt: now,
      updatedAt: now,
    };

    const room = await roomRepository.create(roomData);
      return { room, leaderSecret };
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
   * Todas las salas del store activo (panel admin: solo-lectura).
   * El controlador sanitiza (jamás expone `leaderSecret` ni `socketId`).
   */
  public static async listRooms(): Promise<IRoom[]> {
    return roomRepository.findAll();
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
      if (isDemoMode() && room.participants.length >= maxUsersForRoom(room)) {
        throw new DemoCapacityError('DEMO_ROOM_FULL', DEMO_ROOM_FULL_MESSAGE);
      }
      const isLeader = room.leaderName.toLowerCase() === trimmedName.toLowerCase();
      room.participants.push({
        name: trimmedName,
        userId,
        isLeader,
        role: isLeader ? 'leader' : 'member',
        joinedAt: new Date(),
        device,
      });

      // ── Disparador: primer miembro (no-leader) → waiting → active + timer ──
      // Cuando entra el primer participante que no es el leader y la sala aún
      // está en estado 'waiting', se activa el temporizador de 3 h 30 min.
      if (!isLeader && room.status === 'waiting') {
        room.status = 'active';
        if (room.settings && !room.settings.timerEndsAt) {
          room.settings.timerEndsAt = new Date(Date.now() + 210 * 60 * 1000).toISOString();
        }
      }

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
   * Change a participant's role (e.g. promote to coleader or demote)
   */
  public static async setParticipantRole(
    roomId: string,
    targetName: string,
    newRole: 'coleader' | 'member'
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    const room = await roomRepository.findById(cleanId);
    if (!room) return null;
    const target = room.participants.find(
      (p) => p.name.toLowerCase() === targetName.trim().toLowerCase()
    );
    if (target && !target.isLeader) {
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
      if (participant.isLeader) room.leaderName = cleanNewName;
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
    if (targetIndex !== -1 && !room.participants[targetIndex].isLeader) {
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
   * el leader puede aprobar más tarde). Todo ello bajo el mutex de la sala.
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
        room.participants.length >= maxUsersForRoom(room)
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
        kickedBy: opts.rejectedBy || 'Anfitrión',
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
   * DEMO: fuerza `isTemporary=true` (ninguna sala es permanente).
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
   * Transfer the Host role to another participant.
   *
   * - Localiza al objetivo por userId o nombre (trim/case-insensitive).
   * - Si no existe o ya es leader → no-op `{ room, newLeaderName: null, leaderSecret: null }`.
   * - Si sí: el leader actual pasa a coleader y el objetivo a leader; actualiza
   *   `room.leaderName`; rota `leaderSecret` salvo `opts.rotateSecret === false`.
   */
  public static async transferLeader(
    roomId: string,
    target: { userId?: string; name?: string },
    opts: { rotateSecret?: boolean } = {}
  ): Promise<{ room: IRoom | null; newLeaderName: string | null; leaderSecret: string | null }> {
    const cleanId = cleanIdOf(roomId);
    const room = await roomRepository.findById(cleanId);
    if (!room) return { room: null, newLeaderName: null, leaderSecret: null };

    let participant: IParticipant | undefined;
    if (target.userId) {
      participant = room.participants.find((p) => p.userId === target.userId);
    }
    if (!participant && target.name) {
      const lower = target.name.trim().toLowerCase();
      if (lower) participant = room.participants.find((p) => p.name.toLowerCase() === lower);
    }
    if (!participant) return { room, newLeaderName: null, leaderSecret: null };
    if (participant.isLeader === true || participant.role === 'leader') {
      return { room, newLeaderName: null, leaderSecret: null };
    }

    for (const p of room.participants) {
      if (p !== participant && (p.isLeader === true || p.role === 'leader')) {
        p.isLeader = false;
        p.role = 'coleader';
      }
    }
    participant.isLeader = true;
    participant.role = 'leader';
    room.leaderName = participant.name;
    if (opts.rotateSecret !== false) {
      room.leaderSecret = crypto.randomBytes(16).toString('hex');
    }
    room.updatedAt = new Date();
    await roomRepository.save(room);
    return { room, newLeaderName: participant.name, leaderSecret: room.leaderSecret ?? null };
  }

  /**
   * Remove a participant and transfer Host role to the next participant if the leader left.
   */
  public static async removeParticipantAndTransferHost(
    roomId: string,
    userName: string,
    userId?: string
  ): Promise<{ room: IRoom | null; newLeaderName: string | null }> {
    const cleanId = cleanIdOf(roomId);

    const matches = (p: IParticipant): boolean => {
      if (userId && p.userId) return p.userId === userId;
      return p.name.toLowerCase() === userName.toLowerCase();
    };

    const room = await roomRepository.findById(cleanId);
    if (!room) return { room: null, newLeaderName: null };

    let newLeaderName: string | null = null;
    const wasLeader = room.participants.some((p) => matches(p) && p.isLeader);

    room.participants = room.participants.filter((p) => !matches(p));

    if (wasLeader && room.participants.length > 0) {
      room.participants[0].isLeader = true;
      room.participants[0].role = 'leader';
      room.leaderName = room.participants[0].name;
      newLeaderName = room.participants[0].name;
      console.log(`👑 Rol de Anfitrión transferido a: ${newLeaderName} en la sala ${cleanId}`);
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

    return { room, newLeaderName };
  }

  /**
   * Delete room and cleanup its uploaded video file.
   * @param forceDeleteVideo  When true the video file is always removed from disk
   *   (used when the leader deliberately closes/deletes the room vs auto-cleanup).
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
    //  1. forceDeleteVideo was requested (leader explicitly destroyed the room), or
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

  // ── Núcleo musical Spotify (cola + now playing) ──────────────────────────

  private static musicQueueOf(room: IRoom): IMusicQueueEntry[] {
    if (!Array.isArray(room.musicQueue)) room.musicQueue = [];
    return room.musicQueue;
  }

  private static voterKeyOf(voter: { userId?: string; name: string }): string {
    if (voter.userId) return voter.userId;
    return voter.name.trim().toLowerCase();
  }

  private static proposerKeyOf(entry: IMusicQueueEntry): string {
    if (entry.proposedByUserId) return entry.proposedByUserId;
    return entry.proposedBy.trim().toLowerCase();
  }

  /**
   * Añade un tema a la cola musical. Duplicados (mismo trackId en
   * queued/pending) y exceso del tope por usuario se ignoran (no-op que
   * devuelve la sala sin cambios). Entradas inválidas también son no-op.
   */
  public static async addMusicEntry(
    roomId: string,
    entry: Omit<IMusicQueueEntry, 'id' | 'status' | 'votes' | 'createdAt'> & {
      status?: 'queued' | 'pending';
    }
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    return withRoomLock(cleanId, async () => {
      const room = await roomRepository.findById(cleanId);
      if (!room) return null;
      const queue = this.musicQueueOf(room);
      const trackId = (entry.trackId || '').trim();
      const name = (entry.name || '').trim();
      const artists = (entry.artists || '').trim();
      const proposedBy = (entry.proposedBy || '').trim();
      // Validación estricta: no-op si no cumple.
      if (!/^[A-Za-z0-9]{8,}$/.test(trackId)) return room;
      if (!name || !artists || !proposedBy) return room;
      if (name.length > 200 || artists.length > 200) return room;
      // Dupe: mismo trackId ya en cola (queued/pending).
      if (queue.some((e) => e.trackId === trackId)) return room;
      // Límite por usuario (default 5).
      const max = room.settings?.musicMaxPerUser ?? 5;
      const key = entry.proposedByUserId ? entry.proposedByUserId : proposedBy.toLowerCase();
      // Nota: cuando el proponente trae userId se compara por userId; si no,
      // por nombre en minúsculas (mismo criterio que voterKeyOf/proposerKeyOf).
      const mineCount = entry.proposedByUserId
        ? queue.filter((e) => e.proposedByUserId === entry.proposedByUserId).length
        : queue.filter((e) => !e.proposedByUserId && e.proposedBy.trim().toLowerCase() === key).length;
      if (mineCount >= max) return room;
      const now = new Date();
      const full: IMusicQueueEntry = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        trackId,
        name,
        artists,
        albumArt: entry.albumArt,
        durationMs: entry.durationMs,
        uri: entry.uri,
        openUrl: entry.openUrl,
        kind: entry.kind ?? 'track',
        proposedBy,
        proposedByUserId: entry.proposedByUserId,
        status: entry.status ?? 'queued',
        votes: [],
        createdAt: now,
      };
      queue.push(full);
      room.updatedAt = new Date();
      await roomRepository.save(room);
      return room;
    });
  }

  /** Alterna el voto de un usuario sobre una entrada encolada. */
  public static async toggleMusicVote(
    roomId: string,
    entryId: string,
    voter: { userId?: string; name: string }
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    return withRoomLock(cleanId, async () => {
      const room = await roomRepository.findById(cleanId);
      if (!room) return null;
      const queue = this.musicQueueOf(room);
      const entry = queue.find((e) => e.id === entryId);
      if (!entry || entry.status !== 'queued') return room;
      const key = this.voterKeyOf(voter);
      const idx = entry.votes.findIndex((v) => v === key);
      if (idx !== -1) entry.votes.splice(idx, 1);
      else entry.votes.push(key);
      room.updatedAt = new Date();
      await roomRepository.save(room);
      return room;
    });
  }

  /** Quita una entrada: moderador o proponente (según settings.musicCanRemove). */
  public static async removeMusicEntry(
    roomId: string,
    entryId: string,
    requester: { userId?: string; name: string; isModerator: boolean }
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    return withRoomLock(cleanId, async () => {
      const room = await roomRepository.findById(cleanId);
      if (!room) return null;
      const queue = this.musicQueueOf(room);
      const entry = queue.find((e) => e.id === entryId);
      if (!entry) return room;
      const mode = room.settings?.musicCanRemove ?? 'proposer';
      let allowed = requester.isModerator;
      if (!allowed && mode !== 'moderator') {
        if (entry.proposedByUserId && requester.userId) {
          allowed = entry.proposedByUserId === requester.userId;
        } else {
          allowed = entry.proposedBy.trim().toLowerCase() === requester.name.trim().toLowerCase();
        }
      }
      if (!allowed) return room;
      room.musicQueue = queue.filter((e) => e.id !== entryId);
      room.updatedAt = new Date();
      await roomRepository.save(room);
      return room;
    });
  }

  /** Reordena la cola (solo moderadores y con musicAllowReorder=true). */
  public static async reorderMusicQueue(
    roomId: string,
    order: string[],
    isModerator: boolean
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    return withRoomLock(cleanId, async () => {
      const room = await roomRepository.findById(cleanId);
      if (!room) return null;
      if (!isModerator) return room;
      if (room.settings?.musicAllowReorder !== true) return room;
      const queue = this.musicQueueOf(room);
      if (!Array.isArray(order) || order.length === 0) return room;
      if (order.length !== queue.length) return room;
      const current = new Set(queue.map((e) => e.id));
      if (order.some((id) => typeof id !== 'string' || !current.has(id))) return room;
      if (new Set(order).size !== queue.length) return room;
      const byId = new Map(queue.map((e) => [e.id, e]));
      room.musicQueue = order.map((id) => byId.get(id) as IMusicQueueEntry);
      room.updatedAt = new Date();
      await roomRepository.save(room);
      return room;
    });
  }

  /** Pasa una entrada pending → queued (solo moderadores). */
  public static async approveMusicEntry(
    roomId: string,
    entryId: string,
    isModerator: boolean
  ): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    return withRoomLock(cleanId, async () => {
      const room = await roomRepository.findById(cleanId);
      if (!room) return null;
      if (!isModerator) return room;
      const queue = this.musicQueueOf(room);
      const entry = queue.find((e) => e.id === entryId);
      if (!entry) return room;
      if (entry.status !== 'pending') return room;
      entry.status = 'queued';
      room.updatedAt = new Date();
      await roomRepository.save(room);
      return room;
    });
  }

  /**
   * Avanza la cola: saca el siguiente tema (fifo = más antiguo, votes = más
   * votos con desempate por antigüedad), lo fija como nowPlaying y refleja el
   * embed Spotify en `room.video`. Con cola vacía deja nowPlaying=null.
   */
  public static async advanceMusicQueue(roomId: string): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    return withRoomLock(cleanId, async () => {
      const room = await roomRepository.findById(cleanId);
      if (!room) return null;
      const queue = this.musicQueueOf(room);
      const queued = queue.filter((e) => e.status === 'queued');
      if (queued.length === 0) {
        room.musicNowPlaying = null;
        room.updatedAt = new Date();
        await roomRepository.save(room);
        return room;
      }
      const mode = room.settings?.musicQueueMode ?? 'fifo';
      let next: IMusicQueueEntry = queued[0];
      if (mode === 'votes') {
        for (const e of queued) {
          const ev = e.votes.length;
          const nv = next.votes.length;
          if (
            ev > nv ||
            (ev === nv && new Date(e.createdAt).getTime() < new Date(next.createdAt).getTime())
          ) {
            next = e;
          }
        }
      } else {
        for (const e of queued) {
          if (new Date(e.createdAt).getTime() < new Date(next.createdAt).getTime()) next = e;
        }
      }
      room.musicQueue = queue.filter((e) => e.id !== next.id);
      room.musicNowPlaying = {
        entryId: next.id,
        trackId: next.trackId,
        name: next.name,
        artists: next.artists,
        albumArt: next.albumArt,
        uri: next.uri,
        openUrl: next.openUrl,
        startedAt: new Date(),
        startedBy: 'sala',
      };
      room.video = {
        originalName: `${next.name} — ${next.artists}`,
        fileName: next.openUrl ?? `https://open.spotify.com/track/${next.trackId}`,
        mimeType: 'audio/spotify',
        sizeBytes: 0,
        durationSeconds: 0,
        sourceType: 'spotify',
        directUrl: `https://open.spotify.com/embed/track/${next.trackId}`,
      };
      room.updatedAt = new Date();
      await roomRepository.save(room);
      return room;
    });
  }

  /** Detiene la música: limpia nowPlaying y el video solo si era de Spotify. */
  public static async stopMusic(roomId: string): Promise<IRoom | null> {
    const cleanId = cleanIdOf(roomId);
    return withRoomLock(cleanId, async () => {
      const room = await roomRepository.findById(cleanId);
      if (!room) return null;
      room.musicNowPlaying = null;
      if (room.video?.sourceType === 'spotify') room.video = undefined;
      room.updatedAt = new Date();
      await roomRepository.save(room);
      return room;
    });
  }
}
