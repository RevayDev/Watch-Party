import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { RoomService } from '../src/services/room.service.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { clearAllPendingGraces } from '../src/sockets/disconnect-grace.js';
import { registerModerationHandlers } from '../src/sockets/handlers/moderation.handler.js';
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
    to: (_room: string) => ({ emit: (_e: string, _p?: unknown) => {} }),
  };
  return { socket, handlers, emitted };
}

function makeIo() {
  const roomEmits: Array<{ room: string; event: string; payload: unknown }> = [];
  const directEmits: Array<{ target: string; event: string; payload: unknown }> = [];
  const io: any = {
    to: (target: string) => ({
      emit: (event: string, payload?: unknown) => {
        roomEmits.push({ room: target, event, payload });
        directEmits.push({ target, event, payload });
      },
    }),
    in: (_room: string) => ({ socketsLeave: (_r: string) => {} }),
    sockets: { adapter: { rooms: new Map<string, Set<string>>() } },
  };
  return { io, roomEmits, directEmits };
}

async function fire(handlers: Map<string, (...args: any[]) => unknown>, event: string, data: unknown) {
  await (handlers.get(event) as (...args: any[]) => unknown)(data);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function lastEmitted(emitted: Array<{ event: string; args: unknown[] }>, event: string) {
  return emitted.filter((e) => e.event === event).map((e) => e.args[0]);
}

beforeAll(() => {
  backupRoomsFile();
});

beforeEach(() => {
  activeUsers.clear();
  clearAllPendingGraces();
});

afterEach(async () => {
  activeUsers.clear();
  clearAllPendingGraces();
  vi.restoreAllMocks();
  while (created.length > 0) {
    const id = created.pop()!;
    await RoomService.deleteRoom(id, true).catch(() => false);
  }
});

afterAll(async () => {
  await restoreRoomsFile();
});

async function makeRoomWithMembers() {
  const { room, hostSecret } = await RoomService.createRoom({ hostName: 'Host' });
  created.push(room.roomId);
  await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-host');
  await RoomService.joinRoom(room.roomId, 'Cohost', 'Web', 'u-co');
  await RoomService.setParticipantRole(room.roomId, 'Cohost', 'cohost');
  await RoomService.joinRoom(room.roomId, 'Miembro', 'Web', 'u-mem');
  return { roomId: room.roomId, hostSecret };
}

describe('moderación: set-role solo host', () => {
  it('cohost haciendo set-role → denied (nuevo mensaje) y sin cambios', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-co');
    activeUsers.set('s-co', { socketId: 's-co', roomId, userName: 'Cohost', isHost: false, userId: 'u-co' });
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'set-role', { roomId, targetUserName: 'Miembro', role: 'cohost' });

    const denied = lastEmitted(sock.emitted, 'action-denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      event: 'set-role',
      message: 'Solo el anfitrión puede dar o quitar roles.',
    });
    expect(roomEmits.some((e) => e.event === 'participant-role-updated')).toBe(false);
    const stored = await RoomService.getRoomById(roomId);
    expect(stored?.participants.find((p) => p.name === 'Miembro')?.role).toBe('member');
  });

  it('host sí puede dar roles', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-host');
    activeUsers.set('s-host', { socketId: 's-host', roomId, userName: 'Host', isHost: true, userId: 'u-host' });
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'set-role', { roomId, targetUserName: 'Miembro', role: 'cohost' });

    expect(lastEmitted(sock.emitted, 'action-denied')).toHaveLength(0);
    expect(roomEmits.some((e) => e.event === 'participant-role-updated')).toBe(true);
    const stored = await RoomService.getRoomById(roomId);
    expect(stored?.participants.find((p) => p.name === 'Miembro')?.role).toBe('cohost');
  });
});

describe('moderación: cohost no puede expulsar al host', () => {
  it('cohost expulsando al host → denied y el host sigue', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io } = makeIo();
    const sock = makeSocket('s-co');
    activeUsers.set('s-co', { socketId: 's-co', roomId, userName: 'Cohost', isHost: false, userId: 'u-co' });
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'kick-user', { roomId, targetUserName: 'Host', kickedBy: 'Cohost' });

    const denied = lastEmitted(sock.emitted, 'action-denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ event: 'kick-user', message: 'No puedes expulsar al anfitrión.' });
    const stored = await RoomService.getRoomById(roomId);
    expect(stored?.participants.some((p) => p.name === 'Host')).toBe(true);
    expect(stored?.kickedUsers).toHaveLength(0);
  });

  it('cohost expulsando al host por userId (case-insensitive) → denied', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io } = makeIo();
    const sock = makeSocket('s-co');
    activeUsers.set('s-co', { socketId: 's-co', roomId, userName: 'Cohost', isHost: false, userId: 'u-co' });
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'kick-user', {
      roomId,
      targetUserName: 'hOsT',
      targetUserId: 'u-host',
      kickedBy: 'Cohost',
    });

    expect(lastEmitted(sock.emitted, 'action-denied')[0]).toMatchObject({ event: 'kick-user' });
    const stored = await RoomService.getRoomById(roomId);
    expect(stored?.participants.some((p) => p.userId === 'u-host')).toBe(true);
  });
});

describe('RoomService.transferHost', () => {
  it('transfiere roles, hostname y rota el secreto', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-host');
    await RoomService.joinRoom(room.roomId, 'Nuevo', 'Web', 'u-new');
    const before = await RoomService.getRoomById(room.roomId);
    const oldSecret = before?.hostSecret;

    const result = await RoomService.transferHost(room.roomId, { name: '  nuevo ' });

    expect(result.newHostName).toBe('Nuevo');
    expect(result.hostSecret).toBeTruthy();
    expect(result.hostSecret).not.toBe(oldSecret);
    expect(result.hostSecret).toMatch(/^[0-9a-f]{32}$/);
    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.hostName).toBe('Nuevo');
    expect(stored?.hostSecret).toBe(result.hostSecret);
    expect(stored?.participants.find((p) => p.name === 'Nuevo')).toMatchObject({
      isHost: true,
      role: 'host',
    });
    expect(stored?.participants.find((p) => p.name === 'Host')).toMatchObject({
      isHost: false,
      role: 'cohost',
    });
  });

  it('localiza por userId y con rotateSecret:false conserva el secreto', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-host');
    await RoomService.joinRoom(room.roomId, 'Nuevo', 'Web', 'u-new');
    const oldSecret = (await RoomService.getRoomById(room.roomId))?.hostSecret;

    const result = await RoomService.transferHost(
      room.roomId,
      { userId: 'u-new' },
      { rotateSecret: false }
    );

    expect(result.newHostName).toBe('Nuevo');
    expect(result.hostSecret).toBe(oldSecret);
    expect((await RoomService.getRoomById(room.roomId))?.hostSecret).toBe(oldSecret);
  });

  it('no-op si el objetivo no existe (sin mutar)', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-host');
    const before = await RoomService.getRoomById(room.roomId);
    const oldSecret = before?.hostSecret;
    const beforeJson = JSON.stringify(before?.participants);

    const result = await RoomService.transferHost(room.roomId, { name: 'Fantasmita' });

    expect(result).toMatchObject({ newHostName: null, hostSecret: null });
    const after = await RoomService.getRoomById(room.roomId);
    expect(after?.hostSecret).toBe(oldSecret);
    expect(JSON.stringify(after?.participants)).toBe(beforeJson);
  });

  it('no-op si el objetivo ya es host (sin mutar)', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-host');
    await RoomService.joinRoom(room.roomId, 'Otro', 'Web', 'u-otro');
    const oldSecret = (await RoomService.getRoomById(room.roomId))?.hostSecret;

    const result = await RoomService.transferHost(room.roomId, { name: 'host' });

    expect(result).toMatchObject({ newHostName: null, hostSecret: null });
    const after = await RoomService.getRoomById(room.roomId);
    expect(after?.hostSecret).toBe(oldSecret);
    expect(after?.hostName).toBe('Host');
    expect(after?.participants.find((p) => p.name === 'Host')).toMatchObject({
      isHost: true,
      role: 'host',
    });
  });
});

describe('socket transfer-host', () => {
  it('cohost NUNCA puede regalar la sala → denied', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-co');
    activeUsers.set('s-co', { socketId: 's-co', roomId, userName: 'Cohost', isHost: false, userId: 'u-co' });
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'transfer-host', { roomId, targetUserName: 'Miembro' });

    expect(lastEmitted(sock.emitted, 'action-denied')[0]).toMatchObject({
      event: 'transfer-host',
      message: 'Solo el anfitrión puede transferir la sala.',
    });
    expect(roomEmits.some((e) => e.event === 'host-changed')).toBe(false);
    expect((await RoomService.getRoomById(roomId))?.hostName).toBe('Host');
  });

  it('host transfiere: host-changed + flags + host-secret al nuevo host', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io, roomEmits, directEmits } = makeIo();
    activeUsers.set('s-host', { socketId: 's-host', roomId, userName: 'Host', isHost: true, userId: 'u-host' });
    activeUsers.set('s-mem', { socketId: 's-mem', roomId, userName: 'Miembro', isHost: false, userId: 'u-mem' });
    const sock = makeSocket('s-host');
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'transfer-host', { roomId, targetUserName: 'miembro' });

    expect(lastEmitted(sock.emitted, 'action-denied')).toHaveLength(0);
    const changed = roomEmits.find((e) => e.event === 'host-changed');
    expect(changed).toBeTruthy();
    expect((changed?.payload as any).newHostName).toBe('Miembro');
    expect((await RoomService.getRoomById(roomId))?.hostName).toBe('Miembro');
    expect(activeUsers.get('s-mem')?.isHost).toBe(true);
    expect(activeUsers.get('s-host')?.isHost).toBe(false);
    const secretEmit = directEmits.find((e) => e.target === 's-mem' && e.event === 'host-secret');
    expect(secretEmit).toBeTruthy();
    expect((secretEmit?.payload as any).hostSecret).toMatch(/^[0-9a-f]{32}$/);
  });

  it('objetivo inexistente → denied No se encontró al participante', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io } = makeIo();
    activeUsers.set('s-host', { socketId: 's-host', roomId, userName: 'Host', isHost: true, userId: 'u-host' });
    const sock = makeSocket('s-host');
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'transfer-host', { roomId, targetUserName: 'Nadie' });

    expect(lastEmitted(sock.emitted, 'action-denied')[0]).toMatchObject({
      event: 'transfer-host',
      message: 'No se encontró al participante.',
    });
  });

  it('sin socket del objetivo: no rota secreto + warn', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io, roomEmits, directEmits } = makeIo();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    activeUsers.set('s-host', { socketId: 's-host', roomId, userName: 'Host', isHost: true, userId: 'u-host' });
    // Miembro existe en la sala pero sin socket activo.
    const before = (await RoomService.getRoomById(roomId))?.hostSecret;
    const sock = makeSocket('s-host');
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'transfer-host', { roomId, targetUserName: 'Miembro' });

    expect(warn).toHaveBeenCalled();
    expect((await RoomService.getRoomById(roomId))?.hostSecret).toBe(before);
    expect(roomEmits.some((e) => e.event === 'host-changed')).toBe(true);
    expect(directEmits.some((e) => e.event === 'host-secret')).toBe(false);
  });
});
