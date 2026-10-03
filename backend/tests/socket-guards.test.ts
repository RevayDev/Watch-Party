import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { RoomService } from '../src/services/room.service.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { clearAllPendingGraces, hasPendingGrace } from '../src/sockets/disconnect-grace.js';
import { registerJoinApprovalHandlers } from '../src/sockets/handlers/join-approval.handler.js';
import { registerModerationHandlers } from '../src/sockets/handlers/moderation.handler.js';
import { registerSettingsHandlers } from '../src/sockets/handlers/settings.handler.js';
import { registerSyncPlaybackHandlers } from '../src/sockets/handlers/sync-playback.handler.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

const created: string[] = [];

function makeSocket(id: string) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const emitted: Array<{ event: string; args: unknown[] }> = [];
  const joined: string[] = [];
  const toEmitted: Array<{ room: string; event: string; payload: unknown }> = [];
  const socket: any = {
    id,
    on: (event: string, fn: (...args: any[]) => unknown) => {
      handlers.set(event, fn);
    },
    emit: (event: string, ...args: unknown[]) => {
      emitted.push({ event, args });
    },
    join: (room: string) => {
      joined.push(room);
    },
    leave: (_room: string) => {},
    to: (room: string) => ({
      emit: (event: string, payload?: unknown) => {
        toEmitted.push({ room, event, payload });
      },
    }),
  };
  return { socket, handlers, emitted, joined, toEmitted };
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
  // Vacía la cadena de microtareas de los handlers async (RoomService en memoria).
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

describe('socket guards: moderación (requireModerator)', () => {
  it('miembro no puede mutar: action-denied y sin force-mute', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-mem');
    activeUsers.set('s-mem', { socketId: 's-mem', roomId, userName: 'Miembro', isHost: false, userId: 'u-mem' });
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'moderate-mute-user', { roomId, targetUserName: 'Cohost' });

    const denied = lastEmitted(sock.emitted, 'action-denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ event: 'moderate-mute-user' });
    expect(roomEmits.some((e) => e.event === 'force-mute-user')).toBe(false);
  });

  it('cohost sí puede mutar (rol del servidor)', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-co');
    activeUsers.set('s-co', { socketId: 's-co', roomId, userName: 'Cohost', isHost: false, userId: 'u-co' });
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'moderate-mute-user', { roomId, targetUserName: 'Miembro' });

    expect(lastEmitted(sock.emitted, 'action-denied')).toHaveLength(0);
    expect(roomEmits.some((e) => e.event === 'force-mute-user')).toBe(true);
  });

  it('hostSecret válido autoriza aunque el socket sea anónimo', async () => {
    const { roomId, hostSecret } = await makeRoomWithMembers();
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-x');
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'moderate-mute-all', { roomId, hostSecret });

    expect(lastEmitted(sock.emitted, 'action-denied')).toHaveLength(0);
    expect(roomEmits.some((e) => e.event === 'force-mute-all')).toBe(true);
  });

  it('kick de miembro a otro: denegado y el objetivo sigue en sala', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io } = makeIo();
    const sock = makeSocket('s-mem');
    activeUsers.set('s-mem', { socketId: 's-mem', roomId, userName: 'Miembro', isHost: false, userId: 'u-mem' });
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'kick-user', {
      roomId,
      targetUserName: 'Cohost',
      kickedBy: 'Miembro',
    });

    expect(lastEmitted(sock.emitted, 'action-denied')[0]).toMatchObject({ event: 'kick-user' });
    const stored = await RoomService.getRoomById(roomId);
    expect(stored?.participants.some((p) => p.name === 'Cohost')).toBe(true);
    expect(stored?.kickedUsers).toHaveLength(0);
  });

  it('rename propio permitido; rename de otro por miembro denegado', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-mem');
    activeUsers.set('s-mem', { socketId: 's-mem', roomId, userName: 'Miembro', isHost: false, userId: 'u-mem' });
    registerModerationHandlers(io, sock.socket);

    await fire(sock.handlers, 'rename-participant', {
      roomId,
      oldName: 'Miembro',
      newName: 'Miembro2',
      targetUserId: 'u-mem',
    });
    expect(roomEmits.some((e) => e.event === 'participant-renamed')).toBe(true);

    await fire(sock.handlers, 'rename-participant', {
      roomId,
      oldName: 'Cohost',
      newName: 'Hackeado',
    });
    const denied = lastEmitted(sock.emitted, 'action-denied');
    expect(denied[denied.length - 1]).toMatchObject({ event: 'rename-participant' });
    const stored = await RoomService.getRoomById(roomId);
    expect(stored?.participants.some((p) => p.name === 'Hackeado')).toBe(false);
  });
});

describe('socket guards: close-room y settings (solo host)', () => {
  it('miembro no puede cerrar: action-denied y la sala sigue', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io } = makeIo();
    const sock = makeSocket('s-mem');
    activeUsers.set('s-mem', { socketId: 's-mem', roomId, userName: 'Miembro', isHost: false, userId: 'u-mem' });
    registerJoinApprovalHandlers(io, sock.socket);

    await fire(sock.handlers, 'close-room', { roomId });

    expect(lastEmitted(sock.emitted, 'action-denied')[0]).toMatchObject({ event: 'close-room' });
    expect(await RoomService.getRoomById(roomId)).not.toBeNull();
  });

  it('cohost no puede cerrar (solo host), pero el host con secreto sí', async () => {
    const { roomId, hostSecret } = await makeRoomWithMembers();
    const { io } = makeIo();
    const co = makeSocket('s-co');
    activeUsers.set('s-co', { socketId: 's-co', roomId, userName: 'Cohost', isHost: false, userId: 'u-co' });
    registerJoinApprovalHandlers(io, co.socket);
    await fire(co.handlers, 'close-room', { roomId });
    expect(lastEmitted(co.emitted, 'action-denied')[0]).toMatchObject({ event: 'close-room' });
    expect(await RoomService.getRoomById(roomId)).not.toBeNull();

    const anon = makeSocket('s-anon');
    registerJoinApprovalHandlers(io, anon.socket);
    await fire(anon.handlers, 'close-room', { roomId, hostSecret });
    expect(await RoomService.getRoomById(roomId)).toBeNull();
    created.pop();
  });

  it('settings inválidos del host → settings-error y nada aplicado', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io } = makeIo();
    const sock = makeSocket('s-host');
    activeUsers.set('s-host', { socketId: 's-host', roomId, userName: 'Host', isHost: true, userId: 'u-host' });
    registerSettingsHandlers(io, sock.socket);

    await fire(sock.handlers, 'update-room-settings', {
      roomId,
      settings: { muteOnEntry: 'yes', extra: 1 },
    });

    const errors = lastEmitted(sock.emitted, 'settings-error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as any).message).toContain('muteOnEntry');
    const stored = await RoomService.getRoomById(roomId);
    expect(stored?.settings?.muteOnEntry).toBe(false);
  });

  it('settings de no-host → action-denied (aunque el socket diga isHost)', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-mem');
    // Cliente que miente con isHost=true en el directorio: el servidor manda.
    activeUsers.set('s-mem', { socketId: 's-mem', roomId, userName: 'Miembro', isHost: true, userId: 'u-mem' });
    registerSettingsHandlers(io, sock.socket);

    await fire(sock.handlers, 'update-room-settings', { roomId, settings: { muteOnEntry: true } });

    expect(lastEmitted(sock.emitted, 'action-denied')[0]).toMatchObject({
      event: 'update-room-settings',
    });
    expect(roomEmits.some((e) => e.event === 'room-settings-updated')).toBe(false);
  });
});

describe('socket join-room: colisión de nombres (H8)', () => {
  it('nombre de otra identidad → join-rejected name-taken, sin agregar', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Ana', 'Web', 'u-ana');

    const { io } = makeIo();
    const sock = makeSocket('s-new');
    registerJoinApprovalHandlers(io, sock.socket);

    await fire(sock.handlers, 'join-room', { roomId: room.roomId, userName: 'ana', userId: 'u-otro' });

    const rejected = lastEmitted(sock.emitted, 'join-rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: 'name-taken' });
    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.participants.filter((p) => p.name.toLowerCase() === 'ana')).toHaveLength(1);
  });

  it('rejoin con mismo userId no colisiona', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Ana', 'Web', 'u-ana');

    const { io } = makeIo();
    const sock = makeSocket('s-re');
    registerJoinApprovalHandlers(io, sock.socket);

    await fire(sock.handlers, 'join-room', { roomId: room.roomId, userName: 'Ana2', userId: 'u-ana' });

    expect(lastEmitted(sock.emitted, 'join-rejected')).toHaveLength(0);
    expect(lastEmitted(sock.emitted, 'room-state')).toHaveLength(1);
  });
});

describe('socket disconnect: gracia de refresh (H3)', () => {
  it('con userId difiere la eliminación; user-left no se emite aún', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Ana', 'Web', 'u-ana');

    const { io } = makeIo();
    const sock = makeSocket('s-ana');
    activeUsers.set('s-ana', {
      socketId: 's-ana',
      roomId: room.roomId,
      userName: 'Ana',
      isHost: false,
      userId: 'u-ana',
    });
    registerJoinApprovalHandlers(io, sock.socket);

    await fire(sock.handlers, 'disconnect', undefined);

    expect(hasPendingGrace(room.roomId, 'u-ana')).toBe(true);
    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.participants.some((p) => p.userId === 'u-ana')).toBe(true);
    expect(sock.toEmitted.some((e) => e.event === 'user-left')).toBe(false);
  });

  it('sin userId la eliminación sigue inmediata', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Anon', 'Web');

    const { io } = makeIo();
    const sock = makeSocket('s-anon');
    activeUsers.set('s-anon', {
      socketId: 's-anon',
      roomId: room.roomId,
      userName: 'Anon',
      isHost: false,
    });
    registerJoinApprovalHandlers(io, sock.socket);

    await fire(sock.handlers, 'disconnect', undefined);

    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.participants.some((p) => p.name === 'Anon')).toBe(false);
    expect(sock.toEmitted.some((e) => e.event === 'user-left')).toBe(true);
  });

  it('rejoin dentro de la ventana cancela la gracia y conserva el rol', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Ayudante', 'Web', 'u-ay');
    await RoomService.setParticipantRole(room.roomId, 'Ayudante', 'cohost');

    const { io } = makeIo();
    const sock = makeSocket('s-ay');
    activeUsers.set('s-ay', {
      socketId: 's-ay',
      roomId: room.roomId,
      userName: 'Ayudante',
      isHost: false,
      userId: 'u-ay',
    });
    registerJoinApprovalHandlers(io, sock.socket);
    await fire(sock.handlers, 'disconnect', undefined);
    expect(hasPendingGrace(room.roomId, 'u-ay')).toBe(true);

    const re = makeSocket('s-ay2');
    registerJoinApprovalHandlers(io, re.socket);
    await fire(re.handlers, 'join-room', { roomId: room.roomId, userName: 'Ayudante', userId: 'u-ay' });

    expect(hasPendingGrace(room.roomId, 'u-ay')).toBe(false);
    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.participants.find((p) => p.userId === 'u-ay')?.role).toBe('cohost');
  });

  it('approve-join de no-moderador se deniega sin efectos', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.updateSettings(room.roomId, { requireApproval: true });
    await RoomService.joinRoom(room.roomId, 'Miembro', 'Web', 'u-mem');
    await RoomService.addJoinRequest(room.roomId, { socketId: 's-w', userId: 'u-w', name: 'Espera' });

    const { io } = makeIo();
    const sock = makeSocket('s-mem');
    activeUsers.set('s-mem', {
      socketId: 's-mem',
      roomId: room.roomId,
      userName: 'Miembro',
      isHost: false,
      userId: 'u-mem',
    });
    registerJoinApprovalHandlers(io, sock.socket);

    await fire(sock.handlers, 'approve-join', { roomId: room.roomId, userId: 'u-w' });

    expect(lastEmitted(sock.emitted, 'action-denied')[0]).toMatchObject({ event: 'approve-join' });
    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.joinRequests?.some((j) => j.userId === 'u-w')).toBe(true);
    expect(stored?.participants.some((p) => p.userId === 'u-w')).toBe(false);
  });

  it('sync-video: miembro no puede controlar play/pause/seek (action-denied)', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io } = makeIo();
    const sock = makeSocket('s-mem');
    activeUsers.set('s-mem', { socketId: 's-mem', roomId, userName: 'Miembro', isHost: false, userId: 'u-mem' });
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'sync-video', { roomId, action: 'play', currentTime: 10 });

    const denied = lastEmitted(sock.emitted, 'action-denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ event: 'sync-video' });
  });

  it('sync-video: host o cohost sí pueden emitir play/pause/seek', async () => {
    const { roomId } = await makeRoomWithMembers();
    const { io } = makeIo();
    const sock = makeSocket('s-co');
    activeUsers.set('s-co', { socketId: 's-co', roomId, userName: 'Cohost', isHost: false, userId: 'u-co' });
    registerSyncPlaybackHandlers(io, sock.socket);

    await fire(sock.handlers, 'sync-video', { roomId, action: 'play', currentTime: 15 });

    expect(lastEmitted(sock.emitted, 'action-denied')).toHaveLength(0);
    expect(sock.toEmitted.some((e) => e.event === 'sync-video')).toBe(true);
  });
});
