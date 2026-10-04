import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { RoomService } from '../src/services/room.service.js';
import { RoomController } from '../src/controllers/room.controller.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { clearAllPendingGraces } from '../src/sockets/disconnect-grace.js';
import { __resetSocketLimitsForTests } from '../src/sockets/socket-limits.js';
import { roomPositions, roomPlayback } from '../src/domain/playback-policy.js';
import { registerSyncPlaybackHandlers } from '../src/sockets/handlers/sync-playback.handler.js';
import { registerJoinApprovalHandlers } from '../src/sockets/handlers/join-approval.handler.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

const created: string[] = [];

function makeSocket(id: string) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const emitted: Array<{ event: string; args: unknown[] }> = [];
  const toEmitted: Array<{ room: string; event: string; payload: unknown }> = [];
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
        toEmitted.push({ room, event, payload });
      },
    }),
  };
  return { socket, handlers, emitted, toEmitted };
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

function mockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res;
  });
  return res;
}

const next = vi.fn();

beforeAll(() => {
  backupRoomsFile();
});

beforeEach(() => {
  activeUsers.clear();
  clearAllPendingGraces();
  __resetSocketLimitsForTests();
  roomPositions.clear();
  roomPlayback.clear();
});

afterEach(async () => {
  activeUsers.clear();
  clearAllPendingGraces();
  __resetSocketLimitsForTests();
  while (created.length > 0) {
    const id = created.pop()!;
    await RoomService.deleteRoom(id, true).catch(() => false);
  }
});

afterAll(async () => {
  await restoreRoomsFile();
});

describe('sync-video: dedup de duplicados consecutivos idénticos (<500ms)', () => {
  it('dos play idénticos seguidos del mismo socket → se emite uno', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    const { io } = makeIo();
    const sock = makeSocket('s-dedup');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'sync-video', { roomId: room.roomId, action: 'play', currentTime: 10 });
    await fire(sock.handlers, 'sync-video', { roomId: room.roomId, action: 'play', currentTime: 10 });

    expect(sock.toEmitted.filter((e) => e.event === 'sync-video')).toHaveLength(1);
  });

  it('eventos distintos consecutivos sí se procesan (seek ≠ play, tiempos distintos)', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    const { io } = makeIo();
    const sock = makeSocket('s-dedup2');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'sync-video', { roomId: room.roomId, action: 'play', currentTime: 10 });
    await fire(sock.handlers, 'sync-video', { roomId: room.roomId, action: 'seek', currentTime: 10 });
    await fire(sock.handlers, 'sync-video', { roomId: room.roomId, action: 'play', currentTime: 25 });

    expect(sock.toEmitted.filter((e) => e.event === 'sync-video')).toHaveLength(3);
  });
});

describe('sync-video: validación de payloads (sin romper clientes legítimos)', () => {
  it('payloads inválidos se ignoran sin emitir ni lanzar', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    const { io } = makeIo();
    const sock = makeSocket('s-valid');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'sync-video', undefined);
    await fire(sock.handlers, 'sync-video', { roomId: '', action: 'play', currentTime: 5 });
    await fire(sock.handlers, 'sync-video', { roomId: room.roomId, action: 'dance', currentTime: 5 });
    await fire(sock.handlers, 'sync-video', { roomId: room.roomId, action: 'play', currentTime: NaN });
    await fire(sock.handlers, 'sync-video', { roomId: room.roomId, action: 'pause', currentTime: -3 });

    expect(sock.toEmitted.filter((e) => e.event === 'sync-video')).toHaveLength(0);
  });

  it('payload legítimo sigue emitiéndose con el formato original', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    const { io } = makeIo();
    const sock = makeSocket('s-legit');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'sync-video', { roomId: room.roomId, action: 'pause', currentTime: 42 });

    const emitted = sock.toEmitted.filter((e) => e.event === 'sync-video');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ action: 'pause', currentTime: 42 });
    expect((emitted[0].payload as any).sentAt).toEqual(expect.any(Number));
    expect((emitted[0].payload as any).senderSocketId).toBe('s-legit');
  });
});

describe('video-changed / upload-progress: validación + dedup', () => {
  it('video-changed válido se emite; sin originalName/fileName se descarta', async () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-vc');
    registerSyncPlaybackHandlers(io, sock.socket);
    const video = { originalName: 'peli.mp4', fileName: 'abc.mp4', mimeType: 'video/mp4', sizeBytes: 10 };

    await fire(sock.handlers, 'video-changed', { roomId: 'ABC123', video });
    await fire(sock.handlers, 'video-changed', { roomId: 'ABC123', video }); // duplicado idéntico
    await fire(sock.handlers, 'video-changed', { roomId: 'ABC123', video: { fileName: 'x.mp4' } });
    await fire(sock.handlers, 'video-changed', { roomId: 'ABC123', video: { originalName: 'x' } });
    await fire(sock.handlers, 'video-changed', undefined);

    const emitted = roomEmits.filter((e) => e.event === 'video-changed');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ video });
  });

  it('upload-progress: 0-100 y null pasan; fuera de rango se descarta; idénticos se dedupan', async () => {
    const { io } = makeIo();
    const sock = makeSocket('s-up');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'upload-progress', { roomId: 'ABC123', progress: 50, fileName: 'peli.mp4' });
    await fire(sock.handlers, 'upload-progress', { roomId: 'ABC123', progress: 50, fileName: 'peli.mp4' });
    await fire(sock.handlers, 'upload-progress', { roomId: 'ABC123', progress: 150, fileName: 'peli.mp4' });
    await fire(sock.handlers, 'upload-progress', { roomId: 'ABC123', progress: -1 });
    await fire(sock.handlers, 'upload-progress', { roomId: 'ABC123', progress: null });

    const emitted = sock.toEmitted.filter((e) => e.event === 'upload-progress');
    expect(emitted).toHaveLength(2);
    expect(emitted[0].payload).toMatchObject({ progress: 50, fileName: 'peli.mp4' });
    expect(emitted[1].payload).toMatchObject({ progress: null });
  });
});

describe('playback-heartbeat: throttle mínimo 1/2s (excedente se ignora)', () => {
  it('dos heartbeats inmediatos del mismo socket → solo el primero alimenta el consenso', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    const { io } = makeIo();
    const sock = makeSocket('s-hb');
    activeUsers.set('s-hb', {
      socketId: 's-hb',
      roomId: room.roomId,
      userName: 'Ana',
      isHost: false,
      userId: 'u-ana',
    });
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'playback-heartbeat', { roomId: room.roomId, currentTime: 10, isPlaying: true });
    await fire(sock.handlers, 'playback-heartbeat', { roomId: room.roomId, currentTime: 99, isPlaying: true });

    const recorded = roomPositions.get(room.roomId)?.get('s-hb');
    expect(recorded?.currentTime).toBe(10);
  });

  it('heartbeats inválidos no alimentan el consenso', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    const { io } = makeIo();
    const sock = makeSocket('s-hb2');
    activeUsers.set('s-hb2', {
      socketId: 's-hb2',
      roomId: room.roomId,
      userName: 'Ana',
      isHost: false,
      userId: 'u-ana',
    });
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'playback-heartbeat', undefined);
    await fire(sock.handlers, 'playback-heartbeat', { roomId: room.roomId, currentTime: -5, isPlaying: true });
    await fire(sock.handlers, 'playback-heartbeat', { roomId: '', currentTime: 5, isPlaying: true });

    expect(roomPositions.get(room.roomId)?.get('s-hb2')).toBeUndefined();
  });
});

describe('anónimos: nombre en uso por otro participante → rechazo (sin fusionar)', () => {
  it('REST join sin userId frente a nombre registrado → 409', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Ana', 'Web', 'u-ana');

    const res = mockRes();
    await RoomController.join(
      { params: { roomId: room.roomId }, body: { userName: 'ana' }, headers: {} } as any,
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(409);
    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.participants.filter((p) => p.name.toLowerCase() === 'ana')).toHaveLength(1);
  });

  it('socket join-room sin userId frente a nombre registrado → join-rejected name-taken', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Ana', 'Web', 'u-ana');

    const { io } = makeIo();
    const sock = makeSocket('s-anon');
    registerJoinApprovalHandlers(io, sock.socket);

    await fire(sock.handlers, 'join-room', { roomId: room.roomId, userName: 'ana' });

    const rejected = sock.emitted.filter((e) => e.event === 'join-rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].args[0]).toMatchObject({ reason: 'name-taken' });
    expect(sock.emitted.some((e) => e.event === 'room-state')).toBe(false);
    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.participants.filter((p) => p.name.toLowerCase() === 'ana')).toHaveLength(1);
  });
});
