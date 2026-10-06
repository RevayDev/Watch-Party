/**
 * SUBAGENTE 4 (testing/security): guards de `video-changed` / `upload-progress`.
 *
 * PREGUNTA DOCUMENTADA EN CÓDIGO: ¿quién puede cambiar el video hoy?
 * - REST `POST /api/rooms/:roomId/video-url` y `uploadVideo` → SOLO host
 *   (403 sin secreto/rol; cubierto en `tests/rest-security.test.ts`).
 * - Socket `video-changed` → SIN guard de auth: CUALQUIER socket (miembro,
 *   no-miembro, sin hostSecret) provoca un broadcast `video-changed` a toda
 *   la sala (ver `src/sockets/handlers/sync-playback.handler.ts:84-114`:
 *   valida forma del payload pero nunca llama a `requireHost`).
 * - Socket `upload-progress` → igual, sin guard (spoofing de barra de progreso).
 *
 * Estos tests NO fijan el comportamiento deseado, solo el ACTUAL, para que
 * cualquier endurecimiento futuro (exigir host) se discuta con el equipo
 * antes de romper el flujo del frontend (que reemite `res.video` tras el
 * upload del host). NO tocar sin coordinar UI.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { RoomService } from '../src/services/room.service.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { registerSyncPlaybackHandlers } from '../src/sockets/handlers/sync-playback.handler.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

const created: string[] = [];

function makeSocket(id: string) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const emitted: Array<{ event: string; args: unknown[] }> = [];
  const socket: any = {
    id,
    on: (event: string, fn: (...args: any[]) => unknown) => {
      handlers.set(event, fn);
    },
    emit: (event: string, ...args: unknown[]) => {
      emitted.push({ event, args });
    },
    join: (_room: string) => {},
    leave: (_room: string) => {},
    to: (room: string) => ({
      emit: (event: string, payload?: unknown) => {
        emitted.push({ event: `to:${room}:${event}`, args: [payload] });
      },
    }),
  };
  return { socket, handlers, emitted };
}

function makeIo() {
  const roomEmits: Array<{ room: string; event: string; payload: unknown }> = [];
  const io: any = {
    to: (room: string) => ({
      emit: (event: string, payload?: unknown) => {
        roomEmits.push({ room, event, payload });
      },
    }),
    in: (_room: string) => ({ socketsLeave: (_r: string) => {} }),
    sockets: { adapter: { rooms: new Map<string, Set<string>>() } },
  };
  return { io, roomEmits };
}

async function fire(handlers: Map<string, (...args: any[]) => unknown>, event: string, data: unknown) {
  await (handlers.get(event) as (...args: any[]) => unknown)(data);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeAll(() => {
  backupRoomsFile();
});

beforeEach(() => {
  activeUsers.clear();
});

afterEach(async () => {
  activeUsers.clear();
  while (created.length > 0) {
    const id = created.pop()!;
    await RoomService.deleteRoom(id, true).catch(() => false);
  }
});

afterAll(async () => {
  await restoreRoomsFile();
});

const VALID_VIDEO = (tag: string) => ({
  originalName: `pelicula-${tag}.mp4`,
  fileName: `upload-${tag}.mp4`,
  mimeType: 'video/mp4',
  sizeBytes: 1234,
  durationSeconds: 0,
  sourceType: 'file' as const,
});

describe('video-changed vía socket: estado ACTUAL (sin guard de host)', () => {
  it('ACTUAL: un MIEMBRO (no host, sin secreto) provoca broadcast a la sala', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-host');
    await RoomService.joinRoom(room.roomId, 'Miembro', 'Web', 'u-mem');

    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-mem-video');
    activeUsers.set('s-mem-video', {
      socketId: 's-mem-video',
      roomId: room.roomId,
      userName: 'Miembro',
      isHost: false,
      userId: 'u-mem',
    });
    registerSyncPlaybackHandlers(io, sock.socket);

    // Sin hostSecret, sin requesterUserId de host: payload "normal" de miembro.
    await fire(sock.handlers, 'video-changed', {
      roomId: room.roomId,
      video: VALID_VIDEO('miembro'),
    });

    const broadcasts = roomEmits.filter((e) => e.event === 'video-changed');
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].room).toBe(room.roomId);
    expect((broadcasts[0].payload as any)?.video?.originalName).toContain('pelicula-');
    // Y nadie recibe action-denied: el servidor no lo considera privilegiado.
    expect(sock.emitted.some((e) => e.event === 'action-denied')).toBe(false);
  });

  it('ACTUAL: un socket ANÓNIMO (fuera de la sala) también provoca broadcast', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-anon-video');
    // Sin entrada en activeUsers: el handler ni siquiera lo mira.
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'video-changed', {
      roomId: room.roomId,
      video: VALID_VIDEO('anonimo'),
    });

    expect(roomEmits.filter((e) => e.event === 'video-changed')).toHaveLength(1);
  });

  it('la validación de FORMA sí existe: sin originalName/fileName no hay broadcast', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-malo-video');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'video-changed', {
      roomId: room.roomId,
      video: { originalName: '', fileName: '' },
    });

    expect(roomEmits.filter((e) => e.event === 'video-changed')).toHaveLength(0);
  });
});

describe('upload-progress vía socket: estado ACTUAL (sin guard)', () => {
  it('ACTUAL: cualquiera reemite progreso a la sala (superficie de spoofing)', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const { io } = makeIo();
    const sock = makeSocket('s-spoof-prog');
    const toEmitted: Array<{ event: string; payload: unknown }> = [];
    sock.socket.to = (_room: string) => ({
      emit: (event: string, payload?: unknown) => {
        toEmitted.push({ event, payload });
      },
    });
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'upload-progress', {
      roomId: room.roomId,
      progress: 99,
      fileName: 'falso.mp4',
    });

    expect(toEmitted.some((e) => e.event === 'upload-progress')).toBe(true);
  });
});
