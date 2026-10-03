import { Server, Socket } from 'socket.io';
import { RoomService } from '../services/room.service.js';
import { roomPlayback, roomPositions } from '../domain/playback-policy.js';
import { registerJoinApprovalHandlers } from './handlers/join-approval.handler.js';
import { registerSyncPlaybackHandlers } from './handlers/sync-playback.handler.js';
import { registerChatReactionsHandlers } from './handlers/chat-reactions.handler.js';
import { registerModerationHandlers } from './handlers/moderation.handler.js';
import { registerWebrtcRelayHandlers } from './handlers/webrtc-relay.handler.js';
import { registerSettingsHandlers } from './handlers/settings.handler.js';

// Re-export de compatibilidad: la regla pura vive en domain/playback-policy.ts.
export { resolveRoomTime } from '../domain/playback-policy.js';

export function setupSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`⚡ Socket conectado: ${socket.id}`);

    registerJoinApprovalHandlers(io, socket);
    registerSyncPlaybackHandlers(io, socket);
    registerChatReactionsHandlers(io, socket);
    registerModerationHandlers(io, socket);
    registerWebrtcRelayHandlers(io, socket);
    registerSettingsHandlers(io, socket);
  });

  // ⏱ Room auto-close timer sweep: closes rooms whose settings.timerEndsAt has passed.
  // Works for both storage modes (MongoDB and the in-memory fallback) and survives
  // because the deadline is persisted with the room itself.
  const timerSweep = setInterval(async () => {
    try {
      const expiredRooms = await RoomService.getRoomsPastTimer();
      for (const room of expiredRooms) {
        const cleanRoomId = room.roomId.toUpperCase().trim();
        console.log(`⏱ Temporizador finalizado: cerrando la sala [${cleanRoomId}]`);

        io.to(cleanRoomId).emit('room-closed', {
          message: 'El temporizador de la sala finalizó. La sala se ha cerrado.',
          reason: 'timer',
        });
        io.in(cleanRoomId).socketsLeave(cleanRoomId);
        roomPlayback.delete(cleanRoomId);
        roomPositions.delete(cleanRoomId);
        // Video is only removed when the room is temporary (deleteRoom handles that)
        await RoomService.deleteRoom(cleanRoomId, false);
      }
    } catch (err) {
      console.warn('⚠️ Error en el barrido de temporizadores de sala:', err);
    }
  }, 15_000);
  timerSweep.unref();
}
