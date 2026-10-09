import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IRoom } from '../types/room.types.js';
import type { RoomRepository } from '../ports/room.repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '../../data');
const roomsFile = path.join(dataDir, 'rooms.json');

function normalize(roomId: string): string {
  return roomId.toUpperCase().trim();
}

function reviveDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Adaptador en memoria (fallback sin MongoDB), con persistencia en disco. */
export class MemoryRoomRepository implements RoomRepository {
  private rooms = new Map<string, IRoom>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(roomsFile)) return;
      const raw = fs.readFileSync(roomsFile, 'utf-8');
      const parsed = JSON.parse(raw) as IRoom[];
      for (const room of parsed) {
        if (!room?.roomId) continue;
        room.createdAt = reviveDate(room.createdAt);
        room.updatedAt = reviveDate(room.updatedAt);
        room.leaderName = room.leaderName || '';
        room.participants = (room.participants || []).map((p) => ({ ...p, joinedAt: reviveDate(p.joinedAt) }));
        room.kickedUsers = (room.kickedUsers || []).map((k) => ({ ...k, kickedAt: reviveDate(k.kickedAt) }));
        room.joinRequests = (room.joinRequests || []).map((j) => ({ ...j, requestedAt: reviveDate(j.requestedAt) }));
        this.rooms.set(normalize(room.roomId), room);
      }
      console.log(`💾 ${this.rooms.size} sala(s) restaurada(s) desde data/rooms.json`);
    } catch (err) {
      console.warn('⚠️ No se pudieron cargar las salas guardadas en disco:', err);
    }
  }

  private persistToDisk(): void {
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const tmpFile = `${roomsFile}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify([...this.rooms.values()], null, 2), 'utf-8');
      fs.renameSync(tmpFile, roomsFile);
    } catch (err) {
      console.warn('⚠️ No se pudieron guardar las salas en disco:', err);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistToDisk();
    }, 300);
  }

  async exists(roomId: string): Promise<boolean> {
    return this.rooms.has(normalize(roomId));
  }

  async create(room: IRoom): Promise<IRoom> {
    this.rooms.set(normalize(room.roomId), room);
    this.schedulePersist();
    return room;
  }

  async findById(roomId: string): Promise<IRoom | null> {
    return this.rooms.get(normalize(roomId)) || null;
  }

  async save(room: IRoom): Promise<IRoom> {
    this.rooms.set(normalize(room.roomId), room);
    this.schedulePersist();
    return room;
  }

  async delete(roomId: string): Promise<boolean> {
    const existed = this.rooms.delete(normalize(roomId));
    if (existed) this.schedulePersist();
    return existed;
  }

  async findTimerCandidates(): Promise<IRoom[]> {
    return [...this.rooms.values()];
  }

  async count(): Promise<number> {
    return this.rooms.size;
  }
}

/** Singleton del adaptador en memoria (conserva el estado entre llamadas). */
export const memoryRoomRepository = new MemoryRoomRepository();
