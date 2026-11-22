// Handshake `video-ready` con auto-play grupal (Rol A).
//
// Tras `video-changed`, cada cliente emite `video-ready { roomId, fileName }`
// cuando su <video> alcanza `loadeddata` con `currentTime ≈ 0`. El servidor
// cuenta miembros presentes (no pendientes) y, al completarse,
// emite un `play` grupal programado con marca `autoplay: true` que el
// cliente aplica como `play` normal (sin re-emitir `sync-video` ni `seek`:
// lo cubren `isApplyingRemote` + el dedup de 500 ms existente).
//
// La identidad del video se valida contra `room.video` del servidor: un
// `fileName` ajeno se ignora (evita que un miembro reinicie el conteo con
// datos rancios). `video-changed` resetea el conteo vía `resetVideoReady`.

import { Server, Socket } from 'socket.io';
import { SyncPlaybackUseCase } from '../../application/sync-playback.usecase.js';
import { RoomService } from '../../services/room.service.js';
import { activeUsers } from '../socket-state.js';
import { roomPlayback } from '../../domain/playback-policy.js';
import { isDuplicateSocketEvent } from '../socket-limits.js';

/** Valor legado conservado para compatibilidad; ya no fuerza un arranque. */
export const VIDEO_READY_TIMEOUT_MS = 15_000;
const VIDEO_READY_DEDUP_MS = 500;

interface ReadyState {
  videoKey: string;
  startTime?: number;
  ready: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

const readyByRoom = new Map<string, ReadyState>();
export const isVideoWaitingForReady = (roomId: string) => readyByRoom.has(roomId.toUpperCase().trim());
const startedByRoom = new Map<string, string>();

function clearTimer(state: ReadyState): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

/** Miembros presentes (no pendientes) de una sala, por socket.id. */
function presentSocketIds(roomId: string): string[] {
  const out: string[] = [];
  for (const u of activeUsers.values()) {
    if (u.roomId === roomId && !u.pending) out.push(u.socketId);
  }
  return out;
}

/** Emite el `play` grupal con marca `autoplay` y limpia el estado. */
function finishVideoReady(io: Server, roomId: string): void {
  const state = readyByRoom.get(roomId);
  if (!state) return;
  clearTimer(state);
  readyByRoom.delete(roomId);
  startedByRoom.set(roomId, state.videoKey);
  const payload = SyncPlaybackUseCase.execute({ roomId, action: 'play', currentTime: state.startTime ?? 0 });
  if (!payload) return;
  const startAt = Date.now() + 1200;
  const snapshot = roomPlayback.get(roomId);
  if (snapshot) snapshot.updatedAt = startAt;
  io.to(roomId).emit('sync-video', {
    action: payload.action,
    currentTime: payload.currentTime,
    sentAt: startAt,
    autoplay: true,
  });
}

/**
 * Reinicia el conteo de una sala (llamar al cambiar el video o al cerrar la
 * sala). El próximo `video-ready` válido abre un conteo nuevo.
 */
export function resetVideoReady(roomId: string): void {
  const cleanRoomId = roomId.toUpperCase().trim();
  startedByRoom.delete(cleanRoomId);
  const state = readyByRoom.get(cleanRoomId);
  if (!state) return;
  clearTimer(state);
  readyByRoom.delete(cleanRoomId);
}

/** Alias de teardown (cierre de sala / sala vacía). */
export function clearVideoReady(roomId: string): void {
  resetVideoReady(roomId);
}

/**
 * Saca un socket del conteo (salida voluntaria o desconexión) y, si con ello
 * se completa el resto, adelanta el `play` grupal sin esperar al timeout.
 */
export function pruneVideoReadySocket(io: Server, roomId: string, socketId: string): void {
  const cleanRoomId = roomId.toUpperCase().trim();
  const state = readyByRoom.get(cleanRoomId);
  if (!state) return;
  state.ready.delete(socketId);
  const present = presentSocketIds(cleanRoomId);
  if (present.length > 0 && present.every((sid) => state.ready.has(sid))) {
    finishVideoReady(io, cleanRoomId);
  } else if (present.length === 0) {
    clearTimer(state);
    readyByRoom.delete(cleanRoomId);
  }
}

/** Solo para tests: ¿hay un conteo abierto en la sala? */
export function __videoReadyPendingForTests(roomId: string): boolean {
  return readyByRoom.has(roomId.toUpperCase().trim());
}

/** Solo para tests: vacía todo el estado del módulo. */
export function __resetVideoReadyForTests(): void {
  startedByRoom.clear();
  for (const state of readyByRoom.values()) clearTimer(state);
  readyByRoom.clear();
}

/** Handler del handshake `video-ready`. Nombres de eventos y payloads nuevos (Rol A). */
export function registerVideoReadyHandlers(io: Server, socket: Socket): void {
  socket.on('video-ready', async (data: { roomId: string; fileName?: string } | undefined) => {
    if (!data || typeof data !== 'object') return;
    const { roomId, fileName } = data;
    if (typeof roomId !== 'string' || !roomId.trim()) return;
    if (typeof fileName !== 'string' || !fileName.trim()) return;
    const cleanRoomId = roomId.toUpperCase().trim();

    // Solo miembros presentes reportan (evita inyección externa y pendientes).
    const member = activeUsers.get(socket.id);
    if (!member || member.roomId !== cleanRoomId || member.pending) return;

    // Dedup: reintentos del mismo socket con el mismo video cuentan una vez.
    if (isDuplicateSocketEvent(socket.id, 'video-ready', `${cleanRoomId}|${fileName}`, VIDEO_READY_DEDUP_MS)) {
      return;
    }

    // La identidad del video la dicta el servidor (room.video actual).
    const room = await RoomService.getRoomById(cleanRoomId);
    if (!room) return;
    const expectedKey = room.video?.fileName || room.video?.directUrl || '';
    if (!expectedKey || fileName !== expectedKey) return;
    if (startedByRoom.get(cleanRoomId) === expectedKey) {
      // Late joiners load the same source after the room is already playing.
      // Send the current mark only to them; never pause or rewind the room.
      const playback = roomPlayback.get(cleanRoomId);
      if (playback) {
        const elapsed = playback.isPlaying ? Math.max(0, (Date.now() - playback.updatedAt) / 1000) : 0;
        socket.emit('sync-video', {
          action: playback.isPlaying ? 'play' : 'pause',
          currentTime: playback.currentTime + elapsed,
          sentAt: Date.now(),
        });
      }
      return;
    }

    let state = readyByRoom.get(cleanRoomId);
    if (!state || state.videoKey !== expectedKey) {
      if (state) clearTimer(state);
      const fresh: ReadyState = { videoKey: expectedKey, startTime: room.video?.startTime ?? 0, ready: new Set(), timer: null };
      readyByRoom.set(cleanRoomId, fresh);
      state = fresh;
      io.to(cleanRoomId).emit('sync-video', { action: 'pause', currentTime: fresh.startTime ?? 0, sentAt: Date.now(), awaitingReady: true });
      // Remain paused until every present member is ready. Never start on a timeout.
    }
    state.ready.add(socket.id);

    const present = presentSocketIds(cleanRoomId);
    if (present.length > 0 && present.every((sid) => state.ready.has(sid))) {
      finishVideoReady(io, cleanRoomId);
    }
  });
}
