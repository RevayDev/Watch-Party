/**
 * Guards de `video-changed` / `upload-progress`: anfitrión o co-anfitrión
 * pueden cambiar el video o informar progreso de subida. Sin permiso →
 * `action-denied`, sin broadcast.
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

describe('video-changed vía socket: anfitrión o co-anfitrión', () => {
  it('un MIEMBRO (no leader, sin secreto) recibe action-denied y no hay broadcast', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-leader');
    await RoomService.joinRoom(room.roomId, 'Miembro', 'Web', 'u-mem');

    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-mem-video');
    activeUsers.set('s-mem-video', {
      socketId: 's-mem-video',
      roomId: room.roomId,
      userName: 'Miembro',
      isLeader: false,
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
    const { room } = await RoomService.createRoom({ leaderName: 'Host' });
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

  it('el LEADER (con secreto) sí provoca broadcast', async () => {
    const { room, leaderSecret } = await RoomService.createRoom({ leaderName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-leader');

    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-leader-video');
    activeUsers.set('s-leader-video', {
      socketId: 's-leader-video',
      roomId: room.roomId,
      userName: 'Host',
      isLeader: true,
      userId: 'u-leader',
    });
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'video-changed', {
      roomId: room.roomId,
      video: VALID_VIDEO('leader'),
      leaderSecret,
    });

    expect(roomEmits.filter((e) => e.event === 'video-changed')).toHaveLength(1);
    expect(sock.emitted.some((e) => e.event === 'action-denied')).toBe(false);
  });

  it('un CO-ANFITRIÓN sí provoca broadcast', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-leader');
    await RoomService.joinRoom(room.roomId, 'Ayudante', 'Web', 'u-ay');
    await RoomService.setParticipantRole(room.roomId, 'Ayudante', 'coleader');

    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-co-video');
    activeUsers.set('s-co-video', {
      socketId: 's-co-video',
      roomId: room.roomId,
      userName: 'Ayudante',
      isLeader: false,
      userId: 'u-ay',
    });
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'video-changed', {
      roomId: room.roomId,
      video: VALID_VIDEO('coleader'),
      requesterUserId: 'u-ay',
      requesterName: 'Ayudante',
    });

    expect(roomEmits.filter((e) => e.event === 'video-changed')).toHaveLength(1);
    expect(sock.emitted.some((e) => e.event === 'action-denied')).toBe(false);
  });

  it('la validación de FORMA sigue exigiendo originalName/fileName', async () => {
    const { room, leaderSecret } = await RoomService.createRoom({ leaderName: 'Host' });
    created.push(room.roomId);

    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-malo-video');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'video-changed', {
      roomId: room.roomId,
      video: { originalName: '', fileName: '' },
      leaderSecret,
    });

    expect(roomEmits.filter((e) => e.event === 'video-changed')).toHaveLength(0);
  });
});

describe('upload-progress vía socket: anfitrión o co-anfitrión', () => {
  it('un NO-leader recibe action-denied y no hay reemisión', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'Host' });
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

  it('el LEADER sí reemite progreso', async () => {
    const { room, leaderSecret } = await RoomService.createRoom({ leaderName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-leader');

    const { io } = makeIo();
    const sock = makeSocket('s-leader-prog');
    activeUsers.set('s-leader-prog', {
      socketId: 's-leader-prog',
      roomId: room.roomId,
      userName: 'Host',
      isLeader: true,
      userId: 'u-leader',
    });
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'upload-progress', {
      roomId: room.roomId,
      progress: 42,
      fileName: 'peli.mp4',
      leaderSecret,
    });

    expect(sock.emitted.some((e) => e.event === 'to:' + room.roomId + ':upload-progress')).toBe(true);
  });

  it('un CO-ANFITRIÓN sí reemite progreso', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-leader');
    await RoomService.joinRoom(room.roomId, 'Ayudante', 'Web', 'u-ay');
    await RoomService.setParticipantRole(room.roomId, 'Ayudante', 'coleader');

    const { io } = makeIo();
    const sock = makeSocket('s-co-prog');
    activeUsers.set('s-co-prog', {
      socketId: 's-co-prog',
      roomId: room.roomId,
      userName: 'Ayudante',
      isLeader: false,
      userId: 'u-ay',
    });
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'upload-progress', {
      roomId: room.roomId,
      progress: 55,
      fileName: 'peli.mp4',
      requesterUserId: 'u-ay',
      requesterName: 'Ayudante',
    });

    expect(sock.emitted.some((e) => e.event === 'to:' + room.roomId + ':upload-progress')).toBe(true);
    expect(sock.emitted.some((e) => e.event === 'action-denied')).toBe(false);
  });
});
