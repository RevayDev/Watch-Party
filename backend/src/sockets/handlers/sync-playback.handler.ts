import { Server, Socket } from 'socket.io';
import { IVideoMetadata } from '../../types/room.types.js';
import { RecordHeartbeatUseCase, SyncPlaybackUseCase } from '../../application/sync-playback.usecase.js';
import { roomPlayback } from '../../domain/playback-policy.js';
import { RoomService } from '../../services/room.service.js';
import { activeUsers } from '../socket-state.js';
import { PrivilegedPayload } from '../socket-auth.js';

/** Handler de sincronización / playback. Nombres de eventos y payloads idénticos al original. */
export function registerSyncPlaybackHandlers(io: Server, socket: Socket): void {
  // 5. Video Playback Synchronization (play, pause, seek with latency compensation)
  socket.on(
    'sync-video',
    async (
      data: { roomId: string; action: 'play' | 'pause' | 'seek'; currentTime: number } & PrivilegedPayload
    ) => {
      const { roomId, action, currentTime } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

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
      const { roomId, currentTime, isPlaying } = data;
      if (!roomId || !Number.isFinite(currentTime) || currentTime < 0) return;
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
  socket.on('video-changed', (data: { roomId: string; video: IVideoMetadata }) => {
    const { roomId, video } = data;
    if (!roomId) return;
    const cleanRoomId = roomId.toUpperCase().trim();

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
  socket.on('upload-progress', (data: { roomId: string; progress: number | null; fileName?: string }) => {
    const { roomId, progress, fileName } = data;
    if (!roomId) return;
    const cleanRoomId = roomId.toUpperCase().trim();
    socket.to(cleanRoomId).emit('upload-progress', { progress, fileName });
  });
}
