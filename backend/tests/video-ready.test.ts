import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { RoomService } from '../src/services/room.service.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { clearAllPendingGraces } from '../src/sockets/disconnect-grace.js';
import { __resetSocketLimitsForTests } from '../src/sockets/socket-limits.js';
import { roomPositions, roomPlayback } from '../src/domain/playback-policy.js';
import {
  registerVideoReadyHandlers,
  __resetVideoReadyForTests,
  __videoReadyPendingForTests,
} from '../src/sockets/handlers/video-ready.handler.js';
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
    to: (_room: string) => ({ emit: (_event: string, _payload?: unknown) => {} }),
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

const VIDEO = { originalName: 'peli.mp4', fileName: 'abc123.mp4', mimeType: 'video/mp4', sizeBytes: 10 };

beforeAll(() => {
  backupRoomsFile();
});

beforeEach(() => {
  activeUsers.clear();
  clearAllPendingGraces();
  __resetSocketLimitsForTests();
  __resetVideoReadyForTests();
  roomPositions.clear();
  roomPlayback.clear();
});

afterEach(async () => {
  activeUsers.clear();
  clearAllPendingGraces();
  __resetSocketLimitsForTests();
  __resetVideoReadyForTests();
  while (created.length > 0) {
    const id = created.pop()!;
    await RoomService.deleteRoom(id, true).catch(() => false);
  }
});

afterAll(async () => {
  await restoreRoomsFile();
});

describe('video-ready: handshake de auto-play grupal', () => {
  it('al completarse todos los presentes emite play grupal con autoplay', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-leader');
    await RoomService.joinRoom(room.roomId, 'Ana', 'Web', 'u-ana');
    await RoomService.updateRoomVideo(room.roomId, VIDEO as any);

    const { io, roomEmits } = makeIo();
    const leader = makeSocket('s-leader');
    const ana = makeSocket('s-ana');
    activeUsers.set('s-leader', { socketId: 's-leader', roomId: room.roomId, userName: 'Host', isLeader: true, userId: 'u-leader' });
    activeUsers.set('s-ana', { socketId: 's-ana', roomId: room.roomId, userName: 'Ana', isLeader: false, userId: 'u-ana' });
    registerVideoReadyHandlers(io, leader.socket);
    registerVideoReadyHandlers(io, ana.socket);

    await fire(leader.handlers, 'video-ready', { roomId: room.roomId, fileName: VIDEO.fileName });
    // Solo uno reportó: aún no hay play grupal
    expect(roomEmits.filter((e) => e.event === 'sync-video')).toHaveLength(0);
    expect(__videoReadyPendingForTests(room.roomId)).toBe(true);

    await fire(ana.handlers, 'video-ready', { roomId: room.roomId, fileName: VIDEO.fileName });
    // Todos los presentes listos: play grupal con autoplay, y solo play
    const plays = roomEmits.filter((e) => e.event === 'sync-video');
    expect(plays).toHaveLength(1);
    expect(plays[0].payload).toMatchObject({ action: 'play', currentTime: 0, autoplay: true });
    expect(__videoReadyPendingForTests(room.roomId)).toBe(false);
    expect(roomPlayback.get(room.roomId)).toMatchObject({ currentTime: 0, isPlaying: true });
  });

  it('video-ready con fileName ajeno se ignora (no abre conteo)', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-leader');
    await RoomService.updateRoomVideo(room.roomId, VIDEO as any);

    const { io, roomEmits } = makeIo();
    const leader = makeSocket('s-leader');
    activeUsers.set('s-leader', { socketId: 's-leader', roomId: room.roomId, userName: 'Host', isLeader: true, userId: 'u-leader' });
    registerVideoReadyHandlers(io, leader.socket);

    await fire(leader.handlers, 'video-ready', { roomId: room.roomId, fileName: 'otro.mp4' });
    expect(roomEmits.filter((e) => e.event === 'sync-video')).toHaveLength(0);
    expect(__videoReadyPendingForTests(room.roomId)).toBe(false);
  });

  it('miembro ajeno a la sala no alimenta el conteo', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-leader');
    await RoomService.updateRoomVideo(room.roomId, VIDEO as any);

    const { io, roomEmits } = makeIo();
    const outsider = makeSocket('s-out');
    activeUsers.set('s-out', { socketId: 's-out', roomId: 'OTRASALA', userName: 'Troll', isLeader: false });
    registerVideoReadyHandlers(io, outsider.socket);

    await fire(outsider.handlers, 'video-ready', { roomId: room.roomId, fileName: VIDEO.fileName });
    expect(roomEmits.filter((e) => e.event === 'sync-video')).toHaveLength(0);
    expect(__videoReadyPendingForTests(room.roomId)).toBe(false);
  });

  it('payloads inválidos se ignoran sin emitir ni lanzar', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'Host' });
    created.push(room.roomId);
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-x');
    registerVideoReadyHandlers(io, sock.socket);

    await fire(sock.handlers, 'video-ready', undefined);
    await fire(sock.handlers, 'video-ready', { roomId: '', fileName: 'x.mp4' });
    await fire(sock.handlers, 'video-ready', { roomId: room.roomId });
    expect(roomEmits.filter((e) => e.event === 'sync-video')).toHaveLength(0);
  });
});
