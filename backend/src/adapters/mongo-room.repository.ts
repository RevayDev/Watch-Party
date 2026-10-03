import type { IRoom } from '../types/room.types.js';
import type { RoomRepository } from '../ports/room.repository.js';
import { RoomModel } from '../models/room.model.js';

function normalize(roomId: string): string {
  return roomId.toUpperCase().trim();
}

/** Adaptador MongoDB del puerto RoomRepository. */
export class MongoRoomRepository implements RoomRepository {
  async exists(roomId: string): Promise<boolean> {
    const found = await RoomModel.exists({ roomId: normalize(roomId) });
    return found !== null;
  }

  async create(room: IRoom): Promise<IRoom> {
    const created = await RoomModel.create(room);
    return created.toObject() as unknown as IRoom;
  }

  async findById(roomId: string): Promise<IRoom | null> {
    const room = await RoomModel.findOne({ roomId: normalize(roomId) }).lean();
    return (room as unknown as IRoom) || null;
  }

  async save(room: IRoom): Promise<IRoom> {
    const cleanId = normalize(room.roomId);
    const existing = await RoomModel.findOne({ roomId: cleanId });
    if (!existing) {
      const created = await RoomModel.create(room);
      return created.toObject() as unknown as IRoom;
    }
    existing.hostName = room.hostName;
    existing.hostSecret = room.hostSecret;
    existing.status = room.status;
    existing.isTemporary = room.isTemporary;
    existing.video = room.video as never;
    existing.participants = room.participants as never;
    existing.joinRequests = (room.joinRequests || []) as never;
    existing.kickedUsers = (room.kickedUsers || []) as never;
    existing.settings = room.settings as never;
    existing.updatedAt = room.updatedAt;
    await existing.save();
    return existing.toObject() as unknown as IRoom;
  }

  async delete(roomId: string): Promise<boolean> {
    const result = await RoomModel.deleteOne({ roomId: normalize(roomId) });
    return result.deletedCount > 0;
  }

  async findTimerCandidates(): Promise<IRoom[]> {
    const rooms = await RoomModel.find({
      'settings.timerEndsAt': { $exists: true, $ne: null },
    }).lean();
    return rooms as unknown as IRoom[];
  }
}

/** Singleton del adaptador MongoDB. */
export const mongoRoomRepository = new MongoRoomRepository();
