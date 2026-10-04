import { Server, Socket } from 'socket.io';
import { IVideoMetadata } from '../../types/room.types.js';
import { RecordHeartbeatUseCase, SyncPlaybackUseCase } from '../../application/sync-playback.usecase.js';
import { roomPlayback } from '../../domain/playback-policy.js';
import { RoomService } from '../../services/room.service.js';
import { activeUsers } from '../socket-state.js';
import { PrivilegedPayload } from '../socket-auth.js';
import { checkSocketThrottle, isDuplicateSocketEvent } from '../socket-limits.js';

// Throttle de heartbeats por socket: mínimo 1 cada 2s (el excedente se
// ignora). El cliente emite cada ~5s, así que es transparente en uso normal.
const HEARTBEAT_MIN_INTERVAL_MS = 2000;
// Dedup de sync: dos eventos idénticos consecutivos del mismo socket en esta
// ventana se procesan una sola vez (dobles envíos de clientes legítimos).
const SYNC_DEDUP_WINDOW_MS = 500;

type SyncAction = 'play' | 'pause' | 'seek';

function isSyncAction(value: unknown): value is SyncAction {
  return value === 'play' || value === 'pause' || value === 'seek';
}

/** Handler de sincronización / playback. Nombres de eventos y payloads idénticos al original. */
export function registerSyncPlaybackHandlers(io: Server, socket: Socket): void {
  // 5. Video Playback Synchronization (play, pause, seek with latency compensation)
  // Decisión explícita: cualquier participante puede sincronizar (sin restricción al host).
  socket.on(
    'sync-video',
    async (
      data: { roomId: string; action: 'play' | 'pause' | 'seek'; currentTime: number } & PrivilegedPayload
    ) => {
      if (!data || typeof data !== 'object') return;
      const { roomId, action, currentTime } = data;
      if (typeof roomId !== 'string' || !roomId.trim()) return;
      if (!isSyncAction(action)) return;
      if (!Number.isFinite(currentTime) || currentTime < 0) return;
      const cleanRoomId = roomId.toUpperCase().trim();
      if (isDuplicateSocketEvent(socket.id, 'sync-video', `${cleanRoomId}|${action}|${currentTime}`, SYNC_DEDUP_WINDOW_MS)) {
        return;
      }

      const room = await RoomService.getRoomById(cleanRoomId);
      if (!room) return;

      // ── Update in-memory playback state (vía caso de uso) ──────────────────
      const payload = SyncPlaybackUseCase.execute({ roomId: cleanRoomId, action, currentTime });
      if (!payload) return;

      socket.to(cleanRoomId).emit('sync-video', {
        action: payload.action,
        currentTime: payload.currentTime,
        sentAt: payload.sentAt,
        senderSocketId: socket.id,
      });
    }
  );

  // 5.1 Playback position heartbeat (every few seconds per member).
  // Feeds the member-consensus time used when someone (re)joins.
  socket.on(
    'playback-heartbeat',
    (data: { roomId: string; currentTime: number; isPlaying: boolean }) => {
      if (!data || typeof data !== 'object') return;
      const { roomId, currentTime, isPlaying } = data;
      if (typeof roomId !== 'string' || !roomId.trim()) return;
      if (!Number.isFinite(currentTime) || currentTime < 0) return;
      // Throttle: el excedente por encima de 1/2s se ignora.
      if (!checkSocketThrottle(socket.id, HEARTBEAT_MIN_INTERVAL_MS)) return;
      const cleanRoomId = roomId.toUpperCase().trim();
      const user = activeUsers.get(socket.id);
      RecordHeartbeatUseCase.execute({
        roomId: cleanRoomId,
        socketId: socket.id,
        userName: user?.userName || '',
        userId: user?.userId,
        currentTime,
        isPlaying: isPlaying === true,
        isMember: Boolean(user && user.roomId === cleanRoomId && !user.pending),
      });
    }
  );

  // 6. Video Changed (when host uploads or swaps movie)
  socket.on('video-changed', (data: { roomId: string; video: IVideoMetadata } | undefined) => {
    if (!data || typeof data !== 'object') return;
    const { roomId, video } = data;
    if (typeof roomId !== 'string' || !roomId.trim()) return;
    if (!video || typeof video !== 'object') return;
    // La metadata la emite el servidor tras subir/fijar el video: exige sus
    // campos de identidad (el frontend reemite `res.video` tal cual).
    if (typeof video.originalName !== 'string' || !video.originalName.trim()) return;
    if (typeof video.fileName !== 'string' || !video.fileName.trim()) return;
    const cleanRoomId = roomId.toUpperCase().trim();
    if (
      isDuplicateSocketEvent(
        socket.id,
        'video-changed',
        `${cleanRoomId}|${video.fileName}|${video.originalName}`,
        SYNC_DEDUP_WINDOW_MS
      )
    ) {
      return;
    }

    // Reset playback state for the new video
    roomPlayback.set(cleanRoomId, {
      currentTime: 0,
      isPlaying: false,
      updatedAt: Date.now(),
    });

    console.log(`🎬 Nuevo video cargado en sala [${cleanRoomId}]: ${video.originalName}`);
    io.to(cleanRoomId).emit('video-changed', { video });
  });

  // 6.1 Upload Progress broadcast (so all members see live upload status)
  socket.on(
    'upload-progress',
    (data: { roomId: string; progress: number | null; fileName?: string } | undefined) => {
      if (!data || typeof data !== 'object') return;
      const { roomId, progress, fileName } = data;
      if (typeof roomId !== 'string' || !roomId.trim()) return;
      // El cliente emite porcentaje 0-100 y `null` para limpiar la barra.
      if (progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 100)) return;
      if (fileName !== undefined && typeof fileName !== 'string') return;
      const cleanRoomId = roomId.toUpperCase().trim();
      if (
        isDuplicateSocketEvent(
          socket.id,
          'upload-progress',
          `${cleanRoomId}|${String(progress)}|${fileName ?? ''}`,
          SYNC_DEDUP_WINDOW_MS
        )
      ) {
        return;
      }
      socket.to(cleanRoomId).emit('upload-progress', { progress, fileName });
    }
  );
}
