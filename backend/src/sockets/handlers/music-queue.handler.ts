import { Server, Socket } from 'socket.io';
import { RoomService } from '../../services/room.service.js';
import { requireModerator } from '../../domain/auth-policy.js';
import { activeUsers } from '../socket-state.js';
import { PrivilegedPayload, denySocket, resolveSocketClaim } from '../socket-auth.js';
import { checkSocketRateLimit, isDuplicateSocketEvent } from '../socket-limits.js';
import type { IRoom } from '../../types/room.types.js';

const MODERATOR_ONLY = 'Solo el anfitrión o un co-anfitrión puede realizar esta acción.';
const MUSIC_DISABLED = 'La música está desactivada en esta sala.';

const ADD_LIMIT = { max: 12, windowMs: 60_000 };
const VOTE_LIMIT = { max: 30, windowMs: 60_000 };
const DEFAULT_LIMIT = { max: 20, windowMs: 60_000 };
const DEDUP_WINDOW_MS = 2_000;

/**
 * Miembro real de la sala (ni fantasma, ni en espera). Devuelve la identidad
 * DEL SERVIDOR (anti-suplantación) o null.
 */
function memberOf(socketId: string, cleanRoomId: string): { name: string; userId?: string } | null {
  const member = activeUsers.get(socketId);
  if (!member || member.roomId !== cleanRoomId || member.pending) return null;
  return { name: member.userName, userId: member.userId };
}

function emitQueue(io: Server, cleanRoomId: string, room: IRoom): void {
  io.to(cleanRoomId).emit('music-queue-updated', {
    queue: room.musicQueue || [],
    nowPlaying: room.musicNowPlaying || null,
  });
}

function cleanRoomIdOf(roomId: unknown): string | null {
  if (typeof roomId !== 'string' || !roomId.trim()) return null;
  return roomId.toUpperCase().trim();
}

/** Handler de la cola musical Spotify. Eventos y payloads según contrato. */
export function registerMusicQueueHandlers(io: Server, socket: Socket): void {
  // Añadir un tema a la cola.
  socket.on(
    'music-add',
    async (
      data:
        | {
            roomId: string;
            track: {
              id: string;
              name: string;
              artists: string;
              albumArt?: string;
              durationSeconds?: number;
              durationMs?: number;
              uri?: string;
              openUrl?: string;
            };
          }
        | undefined
    ) => {
      if (!data || typeof data !== 'object') return;
      const cleanRoomId = cleanRoomIdOf((data as { roomId: unknown }).roomId);
      if (!cleanRoomId) return;
      const track = (data as { track?: unknown }).track;
      if (!track || typeof track !== 'object') return;
      const t = track as Record<string, unknown>;
      if (typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.artists !== 'string') {
        return;
      }
      if (!checkSocketRateLimit(socket.id, 'music-add', ADD_LIMIT.max, ADD_LIMIT.windowMs)) return;
      if (isDuplicateSocketEvent(socket.id, 'music-add', `${cleanRoomId}:${t.id}`, DEDUP_WINDOW_MS)) {
        return;
      }
      const member = memberOf(socket.id, cleanRoomId);
      if (!member) return;
      const room = await RoomService.getRoomById(cleanRoomId);
      if (!room) return;
      if (room.settings?.musicEnabled !== true) {
        denySocket(socket, 'music-add', MUSIC_DISABLED);
        return;
      }
      if (room.settings?.musicCanAdd === 'moderator') {
        const payload = data as PrivilegedPayload;
        if (!requireModerator(room, resolveSocketClaim(socket, payload))) {
          denySocket(socket, 'music-add', MODERATOR_ONLY);
          return;
        }
      }
      const durationMs =
        typeof t.durationMs === 'number' && Number.isFinite(t.durationMs)
          ? Math.round(t.durationMs)
          : typeof t.durationSeconds === 'number' && Number.isFinite(t.durationSeconds)
            ? Math.round(t.durationSeconds * 1000)
            : undefined;
      const updated = await RoomService.addMusicEntry(cleanRoomId, {
        trackId: t.id,
        name: t.name,
        artists: t.artists,
        albumArt: typeof t.albumArt === 'string' ? t.albumArt : undefined,
        durationMs,
        uri: typeof t.uri === 'string' ? t.uri : undefined,
        openUrl: typeof t.openUrl === 'string' ? t.openUrl : undefined,
        proposedBy: member.name,
        proposedByUserId: member.userId,
        status: room.settings?.musicRequireApproval === true ? 'pending' : 'queued',
      });
      if (!updated) return;
      emitQueue(io, cleanRoomId, updated);
    }
  );

  // Votar / retirar el voto de un tema (solo modo 'votes').
  socket.on(
    'music-vote',
    async (data: { roomId: string; entryId: string } | undefined) => {
      if (!data || typeof data !== 'object') return;
      const cleanRoomId = cleanRoomIdOf(data.roomId);
      if (!cleanRoomId || typeof data.entryId !== 'string' || !data.entryId) return;
      if (!checkSocketRateLimit(socket.id, 'music-vote', VOTE_LIMIT.max, VOTE_LIMIT.windowMs)) return;
      if (
        isDuplicateSocketEvent(socket.id, 'music-vote', `${cleanRoomId}:${data.entryId}`, DEDUP_WINDOW_MS)
      ) {
        return;
      }
      const member = memberOf(socket.id, cleanRoomId);
      if (!member) return;
      const room = await RoomService.getRoomById(cleanRoomId);
      if (!room) return;
      if (room.settings?.musicEnabled !== true) return;
      if ((room.settings?.musicQueueMode ?? 'fifo') !== 'votes') return;
      const updated = await RoomService.toggleMusicVote(cleanRoomId, data.entryId, {
        userId: member.userId,
        name: member.name,
      });
      if (!updated) return;
      emitQueue(io, cleanRoomId, updated);
    }
  );

  // Quitar un tema (proponente o moderador, según settings).
  socket.on(
    'music-remove',
    async (data: { roomId: string; entryId: string } & PrivilegedPayload) => {
      if (!data || typeof data !== 'object') return;
      const cleanRoomId = cleanRoomIdOf(data.roomId);
      if (!cleanRoomId || typeof data.entryId !== 'string' || !data.entryId) return;
      if (!checkSocketRateLimit(socket.id, 'music-remove', DEFAULT_LIMIT.max, DEFAULT_LIMIT.windowMs)) {
        return;
      }
      const member = memberOf(socket.id, cleanRoomId);
      if (!member) return;
      const room = await RoomService.getRoomById(cleanRoomId);
      if (!room) return;
      const isModerator = requireModerator(room, resolveSocketClaim(socket, data));
      const updated = await RoomService.removeMusicEntry(cleanRoomId, data.entryId, {
        userId: member.userId,
        name: member.name,
        isModerator,
      });
      if (!updated) return;
      emitQueue(io, cleanRoomId, updated);
    }
  );

  // Reordenar la cola (solo moderadores).
  socket.on(
    'music-reorder',
    async (data: { roomId: string; order: string[] } & PrivilegedPayload) => {
      if (!data || typeof data !== 'object') return;
      const cleanRoomId = cleanRoomIdOf(data.roomId);
      if (!cleanRoomId || !Array.isArray(data.order)) return;
      if (!checkSocketRateLimit(socket.id, 'music-reorder', DEFAULT_LIMIT.max, DEFAULT_LIMIT.windowMs)) {
        return;
      }
      const member = memberOf(socket.id, cleanRoomId);
      if (!member) return;
      const room = await RoomService.getRoomById(cleanRoomId);
      if (!room) return;
      if (!requireModerator(room, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'music-reorder', MODERATOR_ONLY);
        return;
      }
      const updated = await RoomService.reorderMusicQueue(cleanRoomId, data.order, true);
      if (!updated) return;
      emitQueue(io, cleanRoomId, updated);
    }
  );

  // Aprobar un tema pendiente (solo moderadores).
  socket.on(
    'music-approve',
    async (data: { roomId: string; entryId: string } & PrivilegedPayload) => {
      if (!data || typeof data !== 'object') return;
      const cleanRoomId = cleanRoomIdOf(data.roomId);
      if (!cleanRoomId || typeof data.entryId !== 'string' || !data.entryId) return;
      if (!checkSocketRateLimit(socket.id, 'music-approve', DEFAULT_LIMIT.max, DEFAULT_LIMIT.windowMs)) {
        return;
      }
      const member = memberOf(socket.id, cleanRoomId);
      if (!member) return;
      const room = await RoomService.getRoomById(cleanRoomId);
      if (!room) return;
      if (!requireModerator(room, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'music-approve', MODERATOR_ONLY);
        return;
      }
      const updated = await RoomService.approveMusicEntry(cleanRoomId, data.entryId, true);
      if (!updated) return;
      emitQueue(io, cleanRoomId, updated);
    }
  );

  // Pasar al siguiente tema (solo moderadores): actualiza cola y video.
  socket.on('music-next', async (data: { roomId: string } & PrivilegedPayload) => {
    if (!data || typeof data !== 'object') return;
    const cleanRoomId = cleanRoomIdOf(data.roomId);
    if (!cleanRoomId) return;
    if (!checkSocketRateLimit(socket.id, 'music-next', DEFAULT_LIMIT.max, DEFAULT_LIMIT.windowMs)) return;
    const member = memberOf(socket.id, cleanRoomId);
    if (!member) return;
    const room = await RoomService.getRoomById(cleanRoomId);
    if (!room) return;
    if (!requireModerator(room, resolveSocketClaim(socket, data))) {
      denySocket(socket, 'music-next', MODERATOR_ONLY);
      return;
    }
    const updated = await RoomService.advanceMusicQueue(cleanRoomId);
    if (!updated) return;
    emitQueue(io, cleanRoomId, updated);
    io.to(cleanRoomId).emit('video-changed', { video: updated.video ?? null });
  });

  // Detener la música (solo moderadores): limpia nowPlaying y el video Spotify.
  socket.on('music-stop', async (data: { roomId: string } & PrivilegedPayload) => {
    if (!data || typeof data !== 'object') return;
    const cleanRoomId = cleanRoomIdOf(data.roomId);
    if (!cleanRoomId) return;
    if (!checkSocketRateLimit(socket.id, 'music-stop', DEFAULT_LIMIT.max, DEFAULT_LIMIT.windowMs)) return;
    const member = memberOf(socket.id, cleanRoomId);
    if (!member) return;
    const room = await RoomService.getRoomById(cleanRoomId);
    if (!room) return;
    if (!requireModerator(room, resolveSocketClaim(socket, data))) {
      denySocket(socket, 'music-stop', MODERATOR_ONLY);
      return;
    }
    const updated = await RoomService.stopMusic(cleanRoomId);
    if (!updated) return;
    emitQueue(io, cleanRoomId, updated);
    io.to(cleanRoomId).emit('video-changed', { video: null });
  });
}
