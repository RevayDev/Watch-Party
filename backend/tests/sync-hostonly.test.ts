import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { RoomService } from '../src/services/room.service.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { clearAllPendingGraces } from '../src/sockets/disconnect-grace.js';
import { __resetSocketLimitsForTests } from '../src/sockets/socket-limits.js';
import { roomPositions, roomPlayback } from '../src/domain/playback-policy.js';
import { registerSyncPlaybackHandlers } from '../src/sockets/handlers/sync-playback.handler.js';
import { sanitizeRoomSettings } from '../src/domain/settings-policy.js';
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
  };
  return { io, roomEmits };
}

async function fire(handlers: Map<string, (...args: any[]) => unknown>, event: string, data: unknown) {
  await (handlers.get(event) as (...args: any[]) => unknown)(data);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Sala con host + miembro + cohost y `hostOnlySync` al valor pedido. */
async function setupRoom(hostOnlySync?: boolean) {
  const { room, hostSecret } = await RoomService.createRoom({ hostName: 'Host' });
  created.push(room.roomId);
  await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-host');
  await RoomService.joinRoom(room.roomId, 'Ana', 'Web', 'u-ana');
  await RoomService.joinRoom(room.roomId, 'Beto', 'Web', 'u-beto');
  await RoomService.setParticipantRole(room.roomId, 'Beto', 'cohost');
  if (hostOnlySync !== undefined) {
    await RoomService.updateSettings(room.roomId, { hostOnlySync });
  }
  return { roomId: room.roomId, hostSecret };
}

function joinActive(socketId: string, roomId: string, userName: string, userId: string) {
  activeUsers.set(socketId, { socketId, roomId, userName, userId, isHost: false });
}

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

describe('sync-video con hostOnlySync bloqueado (true)', () => {
  it('miembro normal denegado: NO se emite sync-video a la sala', async () => {
    const { roomId } = await setupRoom(true);
    const { io } = makeIo();
    const sock = makeSocket('s-member-denied');
    joinActive('s-member-denied', roomId, 'Ana', 'u-ana');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'sync-video', { roomId, action: 'play', currentTime: 10 });

    expect(sock.toEmitted.filter((e) => e.event === 'sync-video')).toHaveLength(0);
    const denied = sock.emitted.filter((e) => e.event === 'action-denied');
    expect(denied).toHaveLength(1);
    expect(denied[0].args[0]).toMatchObject({
      event: 'sync-video',
      message: 'Solo el anfitrión controla la reproducción.',
    });
  });

  it('cohost permitido', async () => {
    const { roomId } = await setupRoom(true);
    const { io } = makeIo();
    const sock = makeSocket('s-cohost-ok');
    joinActive('s-cohost-ok', roomId, 'Beto', 'u-beto');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'sync-video', { roomId, action: 'pause', currentTime: 20 });

    const emitted = sock.toEmitted.filter((e) => e.event === 'sync-video');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ action: 'pause', currentTime: 20 });
    expect(sock.emitted.filter((e) => e.event === 'action-denied')).toHaveLength(0);
  });

  it('host permitido', async () => {
    const { roomId } = await setupRoom(true);
    const { io } = makeIo();
    const sock = makeSocket('s-host-ok');
    joinActive('s-host-ok', roomId, 'Host', 'u-host');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'sync-video', { roomId, action: 'seek', currentTime: 30 });

    const emitted = sock.toEmitted.filter((e) => e.event === 'sync-video');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ action: 'seek', currentTime: 30 });
    expect(sock.emitted.filter((e) => e.event === 'action-denied')).toHaveLength(0);
  });
});

describe('sync-video con hostOnlySync desactivado/ausente (comportamiento actual)', () => {
  it('con locked=false el miembro sí sincroniza como hoy', async () => {
    const { roomId } = await setupRoom(false);
    const { io } = makeIo();
    const sock = makeSocket('s-member-open');
    joinActive('s-member-open', roomId, 'Ana', 'u-ana');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'sync-video', { roomId, action: 'play', currentTime: 7 });

    const emitted = sock.toEmitted.filter((e) => e.event === 'sync-video');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ action: 'play', currentTime: 7 });
    expect(sock.emitted.filter((e) => e.event === 'action-denied')).toHaveLength(0);
  });

  it('con ajuste ausente el miembro sí sincroniza como hoy', async () => {
    const { roomId } = await setupRoom(undefined);
    const { io } = makeIo();
    const sock = makeSocket('s-member-legacy');
    joinActive('s-member-legacy', roomId, 'Ana', 'u-ana');
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'sync-video', { roomId, action: 'pause', currentTime: 3 });

    const emitted = sock.toEmitted.filter((e) => e.event === 'sync-video');
    expect(emitted).toHaveLength(1);
    expect(sock.emitted.filter((e) => e.event === 'action-denied')).toHaveLength(0);
  });
});

describe('settings-policy: hostOnlySync', () => {
  it('acepta booleano y lo incluye en el saneo', () => {
    expect(sanitizeRoomSettings({ hostOnlySync: true })).toEqual({
      settings: { hostOnlySync: true },
      errors: [],
    });
    expect(sanitizeRoomSettings({ hostOnlySync: false })).toEqual({
      settings: { hostOnlySync: false },
      errors: [],
    });
  });

  it('tipo no booleano produce error atómico', () => {
    const result = sanitizeRoomSettings({ hostOnlySync: 'yes' } as any);
    expect(result.settings).toEqual({});
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
