import { Server, Socket } from 'socket.io';
import { RoomService } from '../../services/room.service.js';
import { sanitizeRoomSettings } from '../../domain/settings-policy.js';
import { requireLeader } from '../../domain/auth-policy.js';
import { isDemoMode } from '../../config/demo-mode.js';
import { PrivilegedPayload, denySocket, resolveSocketClaim } from '../socket-auth.js';

/** Handler de ajustes de sala. Nombres de eventos y payloads idénticos al original. */
export function registerSettingsHandlers(io: Server, socket: Socket): void {
  // Update Room Settings (Mute on entry, name, info, timer, etc.)
  // Solo el leader (estado del servidor o leaderSecret válido). Si el payload es
  // inválido se responde `settings-error` al emisor y no se aplica nada (atómico).
  socket.on(
    'update-room-settings',
    async (data: { roomId: string; settings: unknown } & PrivilegedPayload) => {
      const { roomId, settings } = data;
      if (!roomId || !settings) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const room = await RoomService.getRoomById(cleanRoomId);
      if (!requireLeader(room, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'update-room-settings', 'Solo el anfitrión puede cambiar los ajustes de la sala.');
        return;
      }

      const { settings: payload, errors } = sanitizeRoomSettings(settings, { demo: isDemoMode() });
      if (errors.length > 0) {
        socket.emit('settings-error', { message: errors.join(' ') });
        return;
      }

      const updatedRoom = await RoomService.updateSettings(cleanRoomId, payload);
      io.to(cleanRoomId).emit('room-settings-updated', {
        settings: updatedRoom?.settings || payload,
      });
    }
  );
}
