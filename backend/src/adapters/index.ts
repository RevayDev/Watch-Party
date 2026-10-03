import type { Server } from 'socket.io';
import { roomRepository } from './room-repository.routing.js';
import { memoryRoomRepository } from './memory-room.repository.js';
import { mongoRoomRepository } from './mongo-room.repository.js';
export { roomRepository } from './room-repository.routing.js';
export { memoryRoomRepository } from './memory-room.repository.js';
export { mongoRoomRepository } from './mongo-room.repository.js';

/** Adaptador del puerto EventBus sobre Socket.IO. */
import type { EventBus } from '../ports/event-bus.js';

export class SocketEventBus implements EventBus {
  constructor(private readonly io: Server) {}

  toRoom(roomId: string, event: string, payload?: unknown): void {
    this.io.to(roomId).emit(event, payload);
  }

  toSocket(socketId: string, event: string, payload?: unknown): void {
    this.io.to(socketId).emit(event, payload);
  }

  broadcastExcept(roomId: string, exceptSocketId: string, event: string, payload?: unknown): void {
    void exceptSocketId;
    this.io.to(roomId).emit(event, payload);
  }
}

export function createSocketEventBus(io: Server): EventBus {
  return new SocketEventBus(io);
}
