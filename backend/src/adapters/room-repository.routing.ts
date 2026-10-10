import type { RoomRepository } from '../ports/room.repository.js';
import type { IRoom } from '../types/room.types.js';
import { getIsMongoConnected, getIsPrismaConnected, isPrismaStore } from '../config/database.js';
import { memoryRoomRepository } from './memory-room.repository.js';
import { mongoRoomRepository } from './mongo-room.repository.js';
import { prismaRoomRepository } from './prisma-room.repository.js';

/**
 * Repositorio de enrutado: un único punto de acceso que delega según el
 * estado de la conexión (evaluado en cada llamada).
 * - `ROOM_STORE=prisma` → Prisma (si conectó) o memoria (fallback).
 * - default (`auto`) → Mongoose (si conectó) o memoria (fallback).
 * Esto elimina la duplicación `if (isMongoConnected) / else` del servicio.
 */
class RoutingRoomRepository implements RoomRepository {
  private active(): RoomRepository {
    if (isPrismaStore()) {
      return getIsPrismaConnected() ? prismaRoomRepository : memoryRoomRepository;
    }
    return getIsMongoConnected() ? mongoRoomRepository : memoryRoomRepository;
  }

  exists(roomId: string): Promise<boolean> {
    return this.active().exists(roomId);
  }

  create(room: IRoom): Promise<IRoom> {
    return this.active().create(room);
  }

  findById(roomId: string): Promise<IRoom | null> {
    return this.active().findById(roomId);
  }

  save(room: IRoom): Promise<IRoom> {
    return this.active().save(room);
  }

  delete(roomId: string): Promise<boolean> {
    return this.active().delete(roomId);
  }

  findTimerCandidates(): Promise<IRoom[]> {
    return this.active().findTimerCandidates();
  }

  findAll(): Promise<IRoom[]> {
    return this.active().findAll();
  }

  count(): Promise<number> {
    return this.active().count();
  }
}

/** Singleton usado por RoomService. */
export const roomRepository: RoomRepository = new RoutingRoomRepository();
