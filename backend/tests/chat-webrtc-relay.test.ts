import { describe, it, expect, beforeEach } from 'vitest';
import { registerChatReactionsHandlers } from '../src/sockets/handlers/chat-reactions.handler.js';
import { registerWebrtcRelayHandlers } from '../src/sockets/handlers/webrtc-relay.handler.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { clearAllPendingGraces } from '../src/sockets/disconnect-grace.js';

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
        toEmitted.push({ room, event, payload });
      },
    }),
  };
  const toEmitted: Array<{ room: string; event: string; payload: unknown }> = [];
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

beforeEach(() => {
  activeUsers.clear();
  clearAllPendingGraces();
});

describe('chat: send-message', () => {
  it('mensaje válido se emite a la sala con texto recortado', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s1');
    registerChatReactionsHandlers(io, sock.socket);

    (sock.handlers.get('send-message') as any)({ roomId: 'abc123', text: '  hola  ', userName: 'Ana' });

    expect(roomEmits).toHaveLength(1);
    expect(roomEmits[0].room).toBe('ABC123');
    expect(roomEmits[0].event).toBe('chat-message');
    expect(roomEmits[0].payload).toMatchObject({ user: 'Ana', text: 'hola' });
  });

  it('sin userName usa "Anónimo"', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s1');
    registerChatReactionsHandlers(io, sock.socket);

    (sock.handlers.get('send-message') as any)({ roomId: 'ABC123', text: 'hola' });

    expect(roomEmits[0].payload).toMatchObject({ user: 'Anónimo' });
  });

  it('texto vacío o solo espacios se descarta sin emitir', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s1');
    registerChatReactionsHandlers(io, sock.socket);

    (sock.handlers.get('send-message') as any)({ roomId: 'ABC123', text: '   ', userName: 'Ana' });
    (sock.handlers.get('send-message') as any)({ roomId: 'ABC123', text: '', userName: 'Ana' });

    expect(roomEmits).toHaveLength(0);
  });

  it('sin roomId se descarta sin emitir', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s1');
    registerChatReactionsHandlers(io, sock.socket);

    (sock.handlers.get('send-message') as any)({ roomId: '', text: 'hola', userName: 'Ana' });

    expect(roomEmits).toHaveLength(0);
  });

  // Corregido: el payload sin `text` se descarta sin lanzar.
  it('payload sin text se descarta sin lanzar', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s1');
    registerChatReactionsHandlers(io, sock.socket);

    (sock.handlers.get('send-message') as any)({ roomId: 'ABC123', userName: 'Ana' });

    expect(roomEmits).toHaveLength(0);
  });
});

describe('chat: send-reaction', () => {
  it('reacción válida se emite a la sala', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s1');
    registerChatReactionsHandlers(io, sock.socket);

    (sock.handlers.get('send-reaction') as any)({ roomId: 'abc123', emoji: '❤️', userName: 'Ana' });

    expect(roomEmits).toHaveLength(1);
    expect(roomEmits[0]).toMatchObject({ room: 'ABC123', event: 'reaction' });
    expect(roomEmits[0].payload).toMatchObject({ emoji: '❤️', user: 'Ana' });
  });

  it('sin emoji o sin roomId se descarta', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s1');
    registerChatReactionsHandlers(io, sock.socket);

    (sock.handlers.get('send-reaction') as any)({ roomId: 'ABC123', emoji: '', userName: 'Ana' });
    (sock.handlers.get('send-reaction') as any)({ roomId: '', emoji: '❤️', userName: 'Ana' });

    expect(roomEmits).toHaveLength(0);
  });
});

describe('webrtc relay', () => {
  it('webrtc-offer se reenvía al target con el senderSocketId', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-caller');
    activeUsers.set('s-caller', { socketId: 's-caller', roomId: 'ROOM1', userName: 'Ana', isHost: false });
    activeUsers.set('s-target', { socketId: 's-target', roomId: 'ROOM1', userName: 'Bob', isHost: false });
    registerWebrtcRelayHandlers(io, sock.socket);

    (sock.handlers.get('webrtc-offer') as any)({
      targetSocketId: 's-target',
      offer: { sdp: 'x' },
      callerName: 'Ana',
      callerIsHost: false,
    });

    expect(roomEmits).toHaveLength(1);
    expect(roomEmits[0]).toMatchObject({ room: 's-target', event: 'webrtc-offer' });
    expect(roomEmits[0].payload).toMatchObject({ senderSocketId: 's-caller', callerName: 'Ana' });
  });

  it('answer e ice-candidate se reenvían al target', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-a');
    activeUsers.set('s-a', { socketId: 's-a', roomId: 'ROOM1', userName: 'Ana', isHost: false });
    activeUsers.set('s-b', { socketId: 's-b', roomId: 'ROOM1', userName: 'Bob', isHost: false });
    registerWebrtcRelayHandlers(io, sock.socket);

    (sock.handlers.get('webrtc-answer') as any)({ targetSocketId: 's-b', answer: { sdp: 'y' } });
    (sock.handlers.get('webrtc-ice-candidate') as any)({ targetSocketId: 's-b', candidate: { c: 1 } });

    expect(roomEmits.map((e) => e.event)).toEqual(['webrtc-answer', 'webrtc-ice-candidate']);
  });

  it('webrtc-offer entre salas distintas se descarta (anti-reflector)', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-x');
    activeUsers.set('s-x', { socketId: 's-x', roomId: 'ROOM1', userName: 'Ana', isHost: false });
    activeUsers.set('s-y', { socketId: 's-y', roomId: 'ROOM2', userName: 'Bob', isHost: false });
    registerWebrtcRelayHandlers(io, sock.socket);

    (sock.handlers.get('webrtc-offer') as any)({
      targetSocketId: 's-y',
      offer: { sdp: 'x' },
      callerName: 'Ana',
      callerIsHost: false,
    });

    expect(roomEmits).toHaveLength(0);
  });

  // Corregido: payload `undefined` se ignora sin lanzar.
  it('webrtc-offer con payload undefined se ignora sin lanzar', () => {
    const { io } = makeIo();
    const sock = makeSocket('s-a');
    registerWebrtcRelayHandlers(io, sock.socket);

    (sock.handlers.get('webrtc-offer') as any)(undefined);
  });

  it('peer-media-state sin roomId no emite', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-a');
    activeUsers.set('s-a', { socketId: 's-a', roomId: 'ABC123', userName: 'Ana', isHost: false });
    registerWebrtcRelayHandlers(io, sock.socket);

    (sock.handlers.get('peer-media-state') as any)({ userName: 'Ana', isCameraOn: true, isMicOn: true });

    expect(roomEmits).toHaveLength(0);
    expect(sock.toEmitted).toHaveLength(0);
  });

  it('peer-media-state válido se difunde a la sala', () => {
    const { io } = makeIo();
    const sock = makeSocket('s-a');
    activeUsers.set('s-a', { socketId: 's-a', roomId: 'ABC123', userName: 'Ana', isHost: false });
    registerWebrtcRelayHandlers(io, sock.socket);

    (sock.handlers.get('peer-media-state') as any)({
      roomId: 'abc123',
      userName: 'Ana',
      isCameraOn: true,
      isMicOn: false,
    });

    expect(sock.toEmitted).toHaveLength(1);
    expect(sock.toEmitted[0]).toMatchObject({ room: 'ABC123', event: 'peer-media-state' });
  });
});

describe('chat: typing', () => {
  it('typing válido se reenvía a la sala con user + timestamp', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-typing');
    registerChatReactionsHandlers(io, sock.socket);

    (sock.handlers.get('typing') as any)({ roomId: 'abc123', userName: 'Ana' });

    expect(roomEmits).toHaveLength(1);
    expect(roomEmits[0].room).toBe('ABC123');
    expect(roomEmits[0].event).toBe('typing');
    expect((roomEmits[0].payload as any).user).toBe('Ana');
    expect(typeof (roomEmits[0].payload as any).timestamp).toBe('number');
  });

  it('typing sin sala o sin usuario se descarta', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-typing');
    registerChatReactionsHandlers(io, sock.socket);

    (sock.handlers.get('typing') as any)(undefined);
    (sock.handlers.get('typing') as any)({ userName: 'Ana' });
    (sock.handlers.get('typing') as any)({ roomId: 'ABC123' });
    (sock.handlers.get('typing') as any)({ roomId: '   ', userName: 'Ana' });

    expect(roomEmits).toHaveLength(0);
  });

  it('typing con usuario vacío solo espacios no llega a emitir', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-typing');
    registerChatReactionsHandlers(io, sock.socket);

    (sock.handlers.get('typing') as any)({ roomId: 'ABC123', userName: '   ' });

    expect(roomEmits).toHaveLength(0);
  });

  it('resuelve el rate-limit: muchos typing seguidos se silencian en exceso', () => {
    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-typing');
    registerChatReactionsHandlers(io, sock.socket);

    for (let i = 0; i < 20; i++) {
      (sock.handlers.get('typing') as any)({ roomId: 'ABC123', userName: 'Ana' });
    }

    // El límite (10/10s) descarta el excedente en silencio: llegan varias pero
    // nunca las 20. La cifra exacta depende de la ventana temporal.
    expect(roomEmits.length).toBeLessThan(20);
    expect(roomEmits.length).toBeGreaterThan(0);
    expect(roomEmits.every((e) => e.event === 'typing')).toBe(true);
  });
});
