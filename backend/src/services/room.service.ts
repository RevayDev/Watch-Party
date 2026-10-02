import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RoomModel } from '../models/room.model.js';
import {
  IRoom,
  IVideoMetadata,
  CreateRoomDTO,
  IParticipant,
  IJoinRequest,
  IKickedParticipant,
} from '../types/room.types.js';
import { isMongoConnected } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '../../uploads');
const dataDir = path.join(__dirname, '../../data');
const roomsFile = path.join(dataDir, 'rooms.json');

// In-memory store used when MongoDB is not running locally
const inMemoryRooms = new Map<string, IRoom>();

// ── Disk persistence for the in-memory mode (survives server restarts) ──
function loadRoomsFromDisk(): void {
  try {
    if (!fs.existsSync(roomsFile)) return;
    const raw = fs.readFileSync(roomsFile, 'utf-8');
    const parsed = JSON.parse(raw) as IRoom[];
    const reviveDate = (value: any): any => (value ? new Date(value) : value);
    for (const room of parsed) {
      if (!room?.roomId) continue;
      room.createdAt = reviveDate(room.createdAt) || new Date();
      room.updatedAt = reviveDate(room.updatedAt) || new Date();
      room.hostName = room.hostName || '';
      room.participants = (room.participants || []).map((p) => ({ ...p, joinedAt: reviveDate(p.joinedAt) || new Date() }));
      room.kickedUsers = (room.kickedUsers || []).map((k) => ({ ...k, kickedAt: reviveDate(k.kickedAt) || new Date() }));
      room.joinRequests = (room.joinRequests || []).map((j) => ({ ...j, requestedAt: reviveDate(j.requestedAt) || new Date() }));
      inMemoryRooms.set(room.roomId.toUpperCase().trim(), room);
    }
    console.log(`💾 ${inMemoryRooms.size} sala(s) restaurada(s) desde data/rooms.json`);
  } catch (err) {
    console.warn('⚠️ No se pudieron cargar las salas guardadas en disco:', err);
  }
}

function persistRoomsToDisk(): void {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const tmpFile = `${roomsFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify([...inMemoryRooms.values()], null, 2), 'utf-8');
    fs.renameSync(tmpFile, roomsFile);
  } catch (err) {
    console.warn('⚠️ No se pudieron guardar las salas en disco:', err);
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(): void {
  if (isMongoConnected) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistRoomsToDisk();
  }, 300);
}

loadRoomsFromDisk();

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
      if (isMongoConnected) {
        const found = await RoomModel.findOne({ roomId });
        if (!found) exists = false;
      } else {
        if (!inMemoryRooms.has(roomId)) exists = false;
      }
    }
    return roomId;
  }

  /**
   * Create a new room with a host.
   */
  public static async createRoom(dto: CreateRoomDTO): Promise<{ room: IRoom; hostSecret: string }> {
    const roomId = await this.getUniqueRoomCode();
    const hostSecret = crypto.randomBytes(16).toString('hex');
    const now = new Date();

    const isTemporary = dto.isTemporary !== undefined ? dto.isTemporary : true;
    const roomData: IRoom = {
      roomId,
      hostName: dto.hostName.trim(),
      hostSecret,
      status: 'waiting',
      isTemporary,
      participants: [
        {
          name: dto.hostName.trim(),
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

    if (isMongoConnected) {
      const room = await RoomModel.create(roomData);
      return { room, hostSecret };
    } else {
      inMemoryRooms.set(roomId, roomData);
      schedulePersist();
      return { room: roomData, hostSecret };
    }
  }

  /**
   * Find room by its public ID.
   */
  public static async getRoomById(roomId: string): Promise<IRoom | null> {
    const cleanId = roomId.toUpperCase().trim();
    if (isMongoConnected) {
      return RoomModel.findOne({ roomId: cleanId });
    }
    return inMemoryRooms.get(cleanId) || null;
  }

  /**
   * Join a room. Identity is the stable `userId` (falls back to name for legacy
   * participants that never claimed an id). This prevents duplicates after a rename.
   */
  public static async joinRoom(
    roomId: string,
    userName: string,
    device = 'Web Browser',
    userId?: string
  ): Promise<IRoom | null> {
    const cleanId = roomId.toUpperCase().trim();
    const trimmedName = userName.trim();

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

    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return null;

      const existingIndex = findParticipantIndex(room.participants as IParticipant[]);

      if (existingIndex === -1) {
        const isHost = room.hostName.toLowerCase() === trimmedName.toLowerCase();
        room.participants.push({
          name: trimmedName,
          userId,
          isHost,
          role: isHost ? 'host' : 'member',
          joinedAt: new Date(),
          device,
        });
        await room.save();
      } else if (userId && !room.participants[existingIndex].userId) {
        room.participants[existingIndex].userId = userId;
        await room.save();
      }
      return room;
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return null;

      const existingIndex = findParticipantIndex(room.participants);

      if (existingIndex === -1) {
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
        schedulePersist();
      } else if (userId && !room.participants[existingIndex].userId) {
        room.participants[existingIndex].userId = userId;
        room.updatedAt = new Date();
        schedulePersist();
      }
      return room;
    }
  }

  /**
   * Change a participant's role (e.g. promote to cohost or demote)
   */
  public static async setParticipantRole(
    roomId: string,
    targetName: string,
    newRole: 'cohost' | 'member'
  ): Promise<IRoom | null> {
    const cleanId = roomId.toUpperCase().trim();
    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return null;
      const target = room.participants.find(
        (p) => p.name.toLowerCase() === targetName.trim().toLowerCase()
      );
      if (target && !target.isHost) {
        target.role = newRole;
        await room.save();
      }
      return room;
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return null;
      const target = room.participants.find(
        (p) => p.name.toLowerCase() === targetName.trim().toLowerCase()
      );
      if (target && !target.isHost) {
        target.role = newRole;
        room.updatedAt = new Date();
        schedulePersist();
      }
      return room;
    }
  }

  /**
   * Rename a participant in room. Identified by userId (name is only a legacy fallback).
   */
  public static async renameParticipant(
    roomId: string,
    newName: string,
    target: { userId?: string; oldName?: string }
  ): Promise<IRoom | null> {
    const cleanId = roomId.toUpperCase().trim();
    const cleanNewName = newName.trim();
    if (!cleanNewName) return null;

    const matches = (p: IParticipant): boolean => {
      if (target.userId && p.userId) return p.userId === target.userId;
      if (target.oldName) return p.name.toLowerCase() === target.oldName.trim().toLowerCase();
      return false;
    };

    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return null;
      const participant = room.participants.find(matches);
      if (participant) {
        participant.name = cleanNewName;
        if (participant.isHost) room.hostName = cleanNewName;
        await room.save();
      }
      return room;
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return null;
      const participant = room.participants.find(matches);
      if (participant) {
        participant.name = cleanNewName;
        if (participant.isHost) room.hostName = cleanNewName;
        room.updatedAt = new Date();
        schedulePersist();
      }
      return room;
    }
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
    const cleanId = roomId.toUpperCase().trim();

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

    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return null;
      const targetIndex = room.participants.findIndex(matches);
      if (targetIndex !== -1 && !room.participants[targetIndex].isHost) {
        const removed = room.participants[targetIndex];
        room.participants = room.participants.filter((_, i) => i !== targetIndex);
        if (!room.kickedUsers) room.kickedUsers = [];
        room.kickedUsers.push(record(removed));
        await room.save();
      }
      return room;
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return null;
      const targetIndex = room.participants.findIndex(matches);
      if (targetIndex !== -1 && !room.participants[targetIndex].isHost) {
        const removed = room.participants[targetIndex];
        room.participants = room.participants.filter((_, i) => i !== targetIndex);
        if (!room.kickedUsers) room.kickedUsers = [];
        room.kickedUsers.push(record(removed));
        room.updatedAt = new Date();
        schedulePersist();
      }
      return room;
    }
  }

  /**
   * Remove a user from the kicked/banned list (unban).
   */
  public static async unbanParticipant(
    roomId: string,
    target: { name?: string; userId?: string }
  ): Promise<IRoom | null> {
    const cleanId = roomId.toUpperCase().trim();

    const matches = (k: IKickedParticipant): boolean => {
      if (target.userId && k.userId) return k.userId === target.userId;
      if (target.name) return k.name.toLowerCase() === target.name.trim().toLowerCase();
      return false;
    };

    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return null;
      room.kickedUsers = (room.kickedUsers || []).filter((k) => !matches(k));
      await room.save();
      return room;
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return null;
      room.kickedUsers = (room.kickedUsers || []).filter((k) => !matches(k));
      room.updatedAt = new Date();
      schedulePersist();
      return room;
    }
  }

  // ── Join requests (manual approval / waiting list) ────────────────────────

  /**
   * Add a join request (dedupes by userId). Returns the updated room.
   */
  public static async addJoinRequest(
    roomId: string,
    req: { socketId: string; userId?: string; name: string; device?: string }
  ): Promise<IRoom | null> {
    const cleanId = roomId.toUpperCase().trim();

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

    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return null;
      const next = build(room.joinRequests || []);
      if (next) {
        room.joinRequests = next;
        await room.save();
      }
      return room;
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return null;
      const next = build(room.joinRequests || []);
      if (next) {
        room.joinRequests = next;
        room.updatedAt = new Date();
        schedulePersist();
      }
      return room;
    }
  }

  /**
   * Approve a join request: moves the requester into the participants list.
   */
  public static async approveJoinRequest(
    roomId: string,
    target: { userId?: string; name?: string }
  ): Promise<{ room: IRoom | null; request: IJoinRequest | null }> {
    const cleanId = roomId.toUpperCase().trim();

    const matches = (j: IJoinRequest): boolean => {
      if (target.userId && j.userId) return j.userId === target.userId;
      if (target.name) return j.name.toLowerCase() === target.name.trim().toLowerCase();
      return false;
    };

    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return { room: null, request: null };
      const request = (room.joinRequests || []).find(matches) || null;
      if (!request) return { room, request: null };
      room.joinRequests = (room.joinRequests || []).filter((j) => !matches(j));
      await room.save();
      await this.joinRoom(cleanId, request.name, request.device, request.userId);
      const updated = await RoomModel.findOne({ roomId: cleanId });
      return { room: updated, request };
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return { room: null, request: null };
      const request = (room.joinRequests || []).find(matches) || null;
      if (!request) return { room, request: null };
      room.joinRequests = (room.joinRequests || []).filter((j) => !matches(j));
      room.updatedAt = new Date();
      await this.joinRoom(cleanId, request.name, request.device, request.userId);
      schedulePersist();
      return { room, request };
    }
  }

  /**
   * Reject a join request; when ban=true the user is also banned from rejoining.
   */
  public static async rejectJoinRequest(
    roomId: string,
    target: { userId?: string; name?: string },
    opts: { ban?: boolean; rejectedBy?: string } = {}
  ): Promise<IRoom | null> {
    const cleanId = roomId.toUpperCase().trim();

    const matches = (j: IJoinRequest): boolean => {
      if (target.userId && j.userId) return j.userId === target.userId;
      if (target.name) return j.name.toLowerCase() === target.name.trim().toLowerCase();
      return false;
    };

    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
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
      await room.save();
      return room;
    } else {
      const room = inMemoryRooms.get(cleanId);
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
      schedulePersist();
      return room;
    }
  }

  /**
   * Update Room Settings (e.g. mute on entry, disable camera on entry)
   */
  public static async updateSettings(
    roomId: string,
    settings: Partial<IRoom['settings']>
  ): Promise<IRoom | null> {
    const cleanId = roomId.toUpperCase().trim();
    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return null;
      room.settings = { ...room.settings, ...settings } as IRoom['settings'];
      await room.save();
      return room;
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return null;
      room.settings = { ...(room.settings || {}), ...settings } as any;
      room.updatedAt = new Date();
      schedulePersist();
      return room;
    }
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

    if (isMongoConnected) {
      const rooms = await RoomModel.find({
        'settings.timerEndsAt': { $exists: true, $ne: null },
      }).lean();
      return (rooms as unknown as IRoom[]).filter(isExpired);
    }
    return [...inMemoryRooms.values()].filter(isExpired);
  }

  /**
   * Remove a participant and transfer Host role to the next participant if the host left.
   */
  public static async removeParticipantAndTransferHost(
    roomId: string,
    userName: string,
    userId?: string
  ): Promise<{ room: IRoom | null; newHostName: string | null }> {
    const cleanId = roomId.toUpperCase().trim();
    let room: IRoom | null = null;
    let newHostName: string | null = null;

    const matches = (p: IParticipant): boolean => {
      if (userId && p.userId) return p.userId === userId;
      return p.name.toLowerCase() === userName.toLowerCase();
    };

    if (isMongoConnected) {
      const dbRoom = await RoomModel.findOne({ roomId: cleanId });
      if (!dbRoom) return { room: null, newHostName: null };

      const wasHost = dbRoom.participants.some((p) => matches(p) && p.isHost);

      dbRoom.participants = dbRoom.participants.filter((p) => !matches(p));

      if (wasHost && dbRoom.participants.length > 0) {
        dbRoom.participants[0].isHost = true;
        dbRoom.participants[0].role = 'host';
        dbRoom.hostName = dbRoom.participants[0].name;
        newHostName = dbRoom.participants[0].name;
        console.log(`👑 Rol de Affitrión transferido a: ${newHostName} en la sala ${cleanId}`);
      }

      await dbRoom.save();
      room = dbRoom;
    } else {
      const memRoom = inMemoryRooms.get(cleanId);
      if (!memRoom) return { room: null, newHostName: null };

      const wasHost = memRoom.participants.some((p) => matches(p) && p.isHost);

      memRoom.participants = memRoom.participants.filter((p) => !matches(p));

      if (wasHost && memRoom.participants.length > 0) {
        memRoom.participants[0].isHost = true;
        memRoom.participants[0].role = 'host';
        memRoom.hostName = memRoom.participants[0].name;
        newHostName = memRoom.participants[0].name;
        console.log(`👑 Rol de Affitrión transferido a: ${newHostName} en la sala ${cleanId}`);
      }

      memRoom.updatedAt = new Date();
      schedulePersist();
      room = memRoom;
    }

    return { room, newHostName };
  }

  /**
   * Delete room and cleanup its uploaded video file.
   * @param forceDeleteVideo  When true the video file is always removed from disk
   *   (used when the host deliberately closes/deletes the room vs auto-cleanup).
   */
  public static async deleteRoom(roomId: string, forceDeleteVideo = false): Promise<boolean> {
    const cleanId = roomId.toUpperCase().trim();
    let videoFile: string | undefined;
    let isTemp = true;
    let sourceType: string | undefined;

    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return false;
      videoFile = room.video?.fileName;
      sourceType = room.video?.sourceType;
      isTemp = room.isTemporary !== false;
      await RoomModel.deleteOne({ roomId: cleanId });
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return false;
      videoFile = room.video?.fileName;
      sourceType = room.video?.sourceType;
      isTemp = room.isTemporary !== false;
      inMemoryRooms.delete(cleanId);
      schedulePersist();
    }

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
    const cleanId = roomId.toUpperCase().trim();

    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return null;

      if (room.video && room.video.fileName !== video.fileName) {
        this.removeOldVideoFile(room.video.fileName);
      }

      room.video = video;
      room.status = 'active';
      await room.save();
      return room;
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return null;

      if (room.video && room.video.fileName !== video.fileName) {
        this.removeOldVideoFile(room.video.fileName);
      }

      room.video = video;
      room.status = 'active';
      room.updatedAt = new Date();
      schedulePersist();
      return room;
    }
  }
}
