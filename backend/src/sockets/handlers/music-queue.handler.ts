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
const AUTO_NEXT_LIMIT = { max: 10, windowMs: 60_000 };
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
  socket.on('music-playback', async (data: { roomId: string; entryId: string; currentTime: number; playing: boolean } & PrivilegedPayload) => {
    if (!data || typeof data.entryId !== 'string' || data.entryId.length > 100 || !Number.isFinite(data.currentTime) || data.currentTime < 0 || typeof data.playing !== 'boolean') return;
    const roomId = cleanRoomIdOf(data.roomId);
    if (!roomId || !memberOf(socket.id, roomId) || !checkSocketRateLimit(socket.id, 'music-playback', 60, 60000)) return;
    const room = await RoomService.getRoomById(roomId);
    if (!room || room.settings?.musicEnabled === false) return;
    if (room.settings?.hostOnlySync && !requireModerator(room, resolveSocketClaim(socket, data))) return;
    const updated = await RoomService.syncMusic(roomId, data.entryId, data.currentTime, data.playing);
    if (updated) emitQueue(io, roomId, updated);
  });
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
      if (room.settings?.musicEnabled === false) {
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
      if (room.settings?.musicEnabled === false) return;
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

  // Pasar al siguiente tema (solo moderadores): actualiza cola y nowPlaying.
  // Solo metadatos: NO emite `video-changed` (la película sigue intacta).
  socket.on('music-next', async (data: { roomId: string } & PrivilegedPayload) => {
    if (!data || typeof data !== 'object') return;
    const cleanRoomId = cleanRoomIdOf(data.roomId);
    if (!cleanRoomId) return;
    if (!checkSocketRateLimit(socket.id, 'music-next', DEFAULT_LIMIT.max, DEFAULT_LIMIT.windowMs)) return;
    const member = memberOf(socket.id, cleanRoomId);
    if (!member) return;
    const room = await RoomService.getRoomById(cleanRoomId);
    if (!room) return;
    // Sin nada sonando cualquiera puede arrancar (play); saltar con música
    // sonando sigue siendo solo de moderadores.
    if (room.musicNowPlaying && !requireModerator(room, resolveSocketClaim(socket, data))) {
      denySocket(socket, 'music-next', MODERATOR_ONLY);
      return;
    }
    const updated = await RoomService.advanceMusicQueue(cleanRoomId);
    if (!updated) return;
    emitQueue(io, cleanRoomId, updated);
  });

  // Avance automático al terminar un tema: lo puede pedir CUALQUIER miembro
  // (su reproductor detecta el fin). Con rate-limit + dedup anti-spam.
  // Solo avanza si hay algo sonando; el Siguiente manual sigue moderador-only.
  socket.on('music-auto-next', async (data: { roomId: string } | undefined) => {
    if (!data || typeof data !== 'object') return;
    const cleanRoomId = cleanRoomIdOf(data.roomId);
    if (!cleanRoomId) return;
    if (!checkSocketRateLimit(socket.id, 'music-auto-next', AUTO_NEXT_LIMIT.max, AUTO_NEXT_LIMIT.windowMs)) return;
    if (isDuplicateSocketEvent(socket.id, 'music-auto-next', cleanRoomId, DEDUP_WINDOW_MS)) return;
    const member = memberOf(socket.id, cleanRoomId);
    if (!member) return;
    const room = await RoomService.getRoomById(cleanRoomId);
    if (!room) return;
    if (room.settings?.musicEnabled === false) return;
    if (!room.musicNowPlaying) return;
    const updated = await RoomService.advanceMusicQueue(cleanRoomId);
    if (!updated) return;
    emitQueue(io, cleanRoomId, updated);
  });

  // Detener la música (solo moderadores): limpia nowPlaying. No toca el video.
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
  });
}
