/**
 * Guards de `video-changed` / `upload-progress`: SOLO el host puede cambiar
 * el video o informar progreso de subida (el frontend solo lo emite desde
 * el panel del anfitrión). Sin permiso → `action-denied`, sin broadcast.
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

describe('video-changed vía socket: solo host', () => {
  it('un MIEMBRO (no host, sin secreto) recibe action-denied y no hay broadcast', async () => {
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

    await fire(sock.handlers, 'video-changed', {
      roomId: room.roomId,
      video: VALID_VIDEO('miembro'),
    });

    expect(roomEmits.filter((e) => e.event === 'video-changed')).toHaveLength(0);
    expect(sock.emitted.some((e) => e.event === 'action-denied')).toBe(true);
  });

  it('un socket ANÓNIMO (fuera de la sala) es denegado sin broadcast', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-anon-video');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'video-changed', {
      roomId: room.roomId,
      video: VALID_VIDEO('anonimo'),
    });

    expect(roomEmits.filter((e) => e.event === 'video-changed')).toHaveLength(0);
    expect(sock.emitted.some((e) => e.event === 'action-denied')).toBe(true);
  });

  it('el HOST (con secreto) sí provoca broadcast', async () => {
    const { room, hostSecret } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-host');

    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-host-video');
    activeUsers.set('s-host-video', {
      socketId: 's-host-video',
      roomId: room.roomId,
      userName: 'Host',
      isHost: true,
      userId: 'u-host',
    });
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'video-changed', {
      roomId: room.roomId,
      video: VALID_VIDEO('host'),
      hostSecret,
    });

    expect(roomEmits.filter((e) => e.event === 'video-changed')).toHaveLength(1);
    expect(sock.emitted.some((e) => e.event === 'action-denied')).toBe(false);
  });

  it('la validación de FORMA sigue exigiendo originalName/fileName', async () => {
    const { room, hostSecret } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-malo-video');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'video-changed', {
      roomId: room.roomId,
      video: { originalName: '', fileName: '' },
      hostSecret,
    });

    expect(roomEmits.filter((e) => e.event === 'video-changed')).toHaveLength(0);
  });
});

describe('upload-progress vía socket: solo host', () => {
  it('un NO-host recibe action-denied y no hay reemisión', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const { io } = makeIo();
    const sock = makeSocket('s-spoof-prog');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'upload-progress', {
      roomId: room.roomId,
      progress: 99,
      fileName: 'falso.mp4',
    });

    expect(sock.emitted.some((e) => e.event === 'to:' + room.roomId + ':upload-progress')).toBe(false);
    expect(sock.emitted.some((e) => e.event === 'action-denied')).toBe(true);
  });

  it('el HOST sí reemite progreso', async () => {
    const { room, hostSecret } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-host');

    const { io } = makeIo();
    const sock = makeSocket('s-host-prog');
    activeUsers.set('s-host-prog', {
      socketId: 's-host-prog',
      roomId: room.roomId,
      userName: 'Host',
      isHost: true,
      userId: 'u-host',
    });
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'upload-progress', {
      roomId: room.roomId,
      progress: 42,
      fileName: 'peli.mp4',
      hostSecret,
    });

    expect(sock.emitted.some((e) => e.event === 'to:' + room.roomId + ':upload-progress')).toBe(true);
  });
});
