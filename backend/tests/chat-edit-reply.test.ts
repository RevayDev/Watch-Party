import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server as IOServer, Socket } from 'socket.io';
import { registerChatReactionsHandlers } from '../src/sockets/handlers/chat-reactions.handler.js';
import { RoomService } from '../src/services/room.service.js';
import { activeUsers, clearRoomMessageAuthors, type SocketUser } from '../src/sockets/socket-state.js';
import { __resetSocketLimitsForTests } from '../src/sockets/socket-limits.js';
import { setDemoModeOverride, resetDemoModeCache } from '../src/config/demo-mode.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

/**
 * chat: citas (replyTo) y edición solo-autor.
 * El registro de autores es efímero (sin persistencia) y se limpia al
 * cerrar la sala.
 */

interface EmitRecord {
  room: string;
  event: string;
  payload: unknown;
}

function makeIo() {
  const emitted: EmitRecord[] = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
  } as unknown as IOServer;
  return { io, emitted };
}

function makeSocket(id: string) {
  const handlers = new Map<string, (data?: any) => void>();
  const socket = {
    id,
    on: (event: string, cb: (data?: any) => void) => {
      handlers.set(event, cb);
    },
  } as unknown as Socket;
  return { socket, handlers };
}

function admit(socketId: string, roomId: string, name: string, userId?: string): void {
  const user: SocketUser = { socketId, roomId, userName: name, isLeader: false };
  if (userId) user.userId = userId;
  activeUsers.set(socketId, user);
}

let roomId: string;

beforeEach(async () => {
  backupRoomsFile();
  setDemoModeOverride(false);
  __resetSocketLimitsForTests();
  const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
  roomId = room.roomId;
});

afterEach(async () => {
  const rooms = await RoomService.listRooms();
  for (const r of rooms) {
    await RoomService.deleteRoom(r.roomId, true).catch(() => false);
  }
  setDemoModeOverride(undefined);
  resetDemoModeCache();
  await restoreRoomsFile();
  activeUsers.clear();
  clearRoomMessageAuthors(roomId);
});

function lastChatMessage(emitted: EmitRecord[]): any {
  const found = [...emitted].reverse().find((e) => e.event === 'chat-message');
  return found?.payload;
}

describe('chat send-message con cita', () => {
  it('reenvía replyTo validada y saneada', async () => {
    const { io, emitted } = makeIo();
    const { socket, handlers } = makeSocket('s1');
    registerChatReactionsHandlers(io, socket);
    admit('s1', roomId, 'Ana', 'u-1');
    await handlers.get('send-message')?.({
      roomId,
      text: 'Totalmente de acuerdo',
      replyTo: { id: 'abc123', user: '  Beto  ', text: '  ¿Vemos otra?  ' },
    });
    const payload = lastChatMessage(emitted);
    expect(payload).toMatchObject({
      user: 'Ana',
      text: 'Totalmente de acuerdo',
      replyTo: { id: 'abc123', user: 'Beto', text: '¿Vemos otra?' },
    });
  });

  it('cita inválida (sin user/texto) llega como null', async () => {
    const { io, emitted } = makeIo();
    const { socket, handlers } = makeSocket('s1');
    registerChatReactionsHandlers(io, socket);
    admit('s1', roomId, 'Ana', 'u-1');
    await handlers.get('send-message')?.({ roomId, text: 'Hola', replyTo: { user: '', text: '' } });
    expect(lastChatMessage(emitted)?.replyTo).toBeNull();
    await handlers.get('send-message')?.({ roomId, text: 'Hola2' });
    expect(lastChatMessage(emitted)?.replyTo).toBeNull();
  });
});

describe('chat edit-message (solo el autor)', () => {
  async function sendAs(socketId: string, name: string, text: string) {
    const { io, emitted } = makeIo();
    const { socket, handlers } = makeSocket(socketId);
    registerChatReactionsHandlers(io, socket);
    admit(socketId, roomId, name, `u-${socketId}`);
    await handlers.get('send-message')?.({ roomId, text });
    return { io, emitted, handlers };
  }

  it('el autor edita y se difunde message-edited saneado', async () => {
    const { emitted, handlers } = await sendAs('s1', 'Ana', 'Hola mundo');
    const sent = lastChatMessage(emitted);
    expect(sent?.text).toBe('Hola mundo');
    await handlers.get('edit-message')?.({ roomId, id: sent.id, text: '  Hola mundo editado  ' });
    const edited = [...emitted].reverse().find((e) => e.event === 'message-edited');
    expect(edited?.payload).toEqual({ id: sent.id, text: 'Hola mundo editado' });
  });

  it('otro usuario no puede editar mensaje ajeno', async () => {
    const shared = makeIo();
    const { socket: s1, handlers: h1 } = makeSocket('s1');
    registerChatReactionsHandlers(shared.io, s1);
    admit('s1', roomId, 'Ana', 'u-s1');
    await h1.get('send-message')?.({ roomId, text: 'Hola mundo' });
    const sent = lastChatMessage(shared.emitted);
    const { socket: s2, handlers: h2 } = makeSocket('s2');
    registerChatReactionsHandlers(shared.io, s2);
    admit('s2', roomId, 'Beto', 'u-s2');
    const before = shared.emitted.length;
    await h2.get('edit-message')?.({ roomId, id: sent.id, text: 'Hackeado' });
    expect(shared.emitted.length).toBe(before);
    expect(shared.emitted.some((e) => e.event === 'message-edited')).toBe(false);
  });

  it('id desconocido (sin registro) o texto vacío no emite nada', async () => {
    const { emitted, handlers } = await sendAs('s1', 'Ana', 'Hola');
    const before = emitted.length;
    await handlers.get('edit-message')?.({ roomId, id: 'noexiste', text: 'X' });
    await handlers.get('edit-message')?.({ roomId, id: 'noexiste', text: '   ' });
    expect(emitted.length).toBe(before);
  });
});
