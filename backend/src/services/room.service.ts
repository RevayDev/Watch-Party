import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RoomModel } from '../models/room.model.js';
import { IRoom, IVideoMetadata, CreateRoomDTO } from '../types/room.types.js';
import { isMongoConnected } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '../../uploads');

// In-memory store used when MongoDB is not running locally
const inMemoryRooms = new Map<string, IRoom>();

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

    const roomData: IRoom = {
      roomId,
      hostName: dto.hostName.trim(),
      hostSecret,
      status: 'waiting',
      participants: [
        {
          name: dto.hostName.trim(),
          isHost: true,
          joinedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    if (isMongoConnected) {
      const room = await RoomModel.create(roomData);
      return { room, hostSecret };
    } else {
      inMemoryRooms.set(roomId, roomData);
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
   * Join a room.
   */
  public static async joinRoom(roomId: string, userName: string): Promise<IRoom | null> {
    const cleanId = roomId.toUpperCase().trim();

    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return null;

      const trimmedName = userName.trim();
      const existingIndex = room.participants.findIndex(
        (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
      );

      if (existingIndex === -1) {
        room.participants.push({
          name: trimmedName,
          isHost: false,
          joinedAt: new Date(),
        });
        await room.save();
      }
      return room;
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return null;

      const trimmedName = userName.trim();
      const existingIndex = room.participants.findIndex(
        (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
      );

      if (existingIndex === -1) {
        room.participants.push({
          name: trimmedName,
          isHost: false,
          joinedAt: new Date(),
        });
        room.updatedAt = new Date();
      }
      return room;
    }
  }

  /**
   * Remove a participant and transfer Host role to the next participant if the host left.
   */
  public static async removeParticipantAndTransferHost(
    roomId: string,
    userName: string
  ): Promise<{ room: IRoom | null; newHostName: string | null }> {
    const cleanId = roomId.toUpperCase().trim();
    let room: IRoom | null = null;
    let newHostName: string | null = null;

    if (isMongoConnected) {
      const dbRoom = await RoomModel.findOne({ roomId: cleanId });
      if (!dbRoom) return { room: null, newHostName: null };

      const wasHost = dbRoom.participants.some(
        (p) => p.name.toLowerCase() === userName.toLowerCase() && p.isHost
      );

      dbRoom.participants = dbRoom.participants.filter(
        (p) => p.name.toLowerCase() !== userName.toLowerCase()
      );

      // If host left and there are remaining participants, promote the first one
      if (wasHost && dbRoom.participants.length > 0) {
        dbRoom.participants[0].isHost = true;
        dbRoom.hostName = dbRoom.participants[0].name;
        newHostName = dbRoom.participants[0].name;
        console.log(`👑 Rol de Host transferido a: ${newHostName} en la sala ${cleanId}`);
      }

      await dbRoom.save();
      room = dbRoom;
    } else {
      const memRoom = inMemoryRooms.get(cleanId);
      if (!memRoom) return { room: null, newHostName: null };

      const wasHost = memRoom.participants.some(
        (p) => p.name.toLowerCase() === userName.toLowerCase() && p.isHost
      );

      memRoom.participants = memRoom.participants.filter(
        (p) => p.name.toLowerCase() !== userName.toLowerCase()
      );

      if (wasHost && memRoom.participants.length > 0) {
        memRoom.participants[0].isHost = true;
        memRoom.hostName = memRoom.participants[0].name;
        newHostName = memRoom.participants[0].name;
        console.log(`👑 Rol de Host transferido a: ${newHostName} en la sala ${cleanId}`);
      }

      memRoom.updatedAt = new Date();
      room = memRoom;
    }

    return { room, newHostName };
  }

  /**
   * Delete room and cleanup its uploaded video file
   */
  public static async deleteRoom(roomId: string): Promise<boolean> {
    const cleanId = roomId.toUpperCase().trim();
    let videoFile: string | undefined;

    if (isMongoConnected) {
      const room = await RoomModel.findOne({ roomId: cleanId });
      if (!room) return false;
      videoFile = room.video?.fileName;
      await RoomModel.deleteOne({ roomId: cleanId });
    } else {
      const room = inMemoryRooms.get(cleanId);
      if (!room) return false;
      videoFile = room.video?.fileName;
      inMemoryRooms.delete(cleanId);
    }

    if (videoFile) {
      this.removeOldVideoFile(videoFile);
    }

    console.log(`❌ Sala [${cleanId}] eliminada permanentemente`);
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
      return room;
    }
  }
}
