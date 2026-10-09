import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createRateLimiter,
  globalLimiter,
  createRoomLimiter,
  joinRoomLimiter,
  deleteRoomLimiter,
  uploadVideoLimiter,
  proxyLimiter,
} from '../src/middleware/rate-limit.middleware.js';
import {
  checkSocketRateLimit,
  checkSocketThrottle,
  isDuplicateSocketEvent,
  clearSocketLimits,
  __resetSocketLimitsForTests,
} from '../src/sockets/socket-limits.js';
import { registerChatReactionsHandlers } from '../src/sockets/handlers/chat-reactions.handler.js';
import { activeUsers } from '../src/sockets/socket-state.js';

const savedNodeEnv = process.env.NODE_ENV;

function mockHttp(ip = '9.9.9.9') {
  const req: any = { ip, socket: {} };
  const res: any = { statusCode: 200, body: undefined };
  res.setHeader = vi.fn();
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res;
  });
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => {
  // Los limitadores HTTP se desactivan en NODE_ENV=test: se fuerza otro
  // entorno para ejercitarlos y se restaura después.
  process.env.NODE_ENV = 'development';
  __resetSocketLimitsForTests();
  activeUsers.clear();
});

afterEach(() => {
  process.env.NODE_ENV = savedNodeEnv;
  vi.restoreAllMocks();
});

describe('HTTP rate-limit (contadores propios, sin dependencias nuevas)', () => {
  it('permite hasta max y responde 429 con Retry-After al exceder', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    const { req, res, next } = mockHttp();
    for (let i = 0; i < 3; i++) {
      limiter(req, res, next);
      expect(next).toHaveBeenCalledTimes(i + 1);
    }
    limiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    expect(res.body).toMatchObject({ retryAfter: expect.any(Number) });
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('la ventana se resetea con el tiempo ( IPs independientes)', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    const a = mockHttp('1.1.1.1');
    const b = mockHttp('2.2.2.2');
    limiter(a.req, a.res, a.next);
    expect(a.next).toHaveBeenCalledTimes(1);
    // Otra IP tiene su propio cupo.
    limiter(b.req, b.res, b.next);
    expect(b.next).toHaveBeenCalledTimes(1);
    // Misma IP dentro de la ventana: bloqueada.
    limiter(a.req, a.res, a.next);
    expect(a.res.status).toHaveBeenCalledWith(429);
  });

  it('expone los limitadores exigidos: global + estrictos por ruta sensible', () => {
    for (const limiter of [
      globalLimiter,
      createRoomLimiter,
      joinRoomLimiter,
      deleteRoomLimiter,
      uploadVideoLimiter,
      proxyLimiter,
    ]) {
      expect(typeof limiter).toBe('function');
    }
  });
});

describe('Socket rate-limit por socket (memoria, sin librerías)', () => {
  it('send-message: ~8/10s por socket (el excedente se ignora)', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 8; i++) {
      expect(checkSocketRateLimit('s1', 'send-message', 8, 10_000, t0 + i)).toBe(true);
    }
    expect(checkSocketRateLimit('s1', 'send-message', 8, 10_000, t0 + 100)).toBe(false);
    // Tras la ventana, vuelve a permitir.
    expect(checkSocketRateLimit('s1', 'send-message', 8, 10_000, t0 + 10_001)).toBe(true);
  });

  it('send-reaction: ~20/10s por socket e independiente por socket', () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 20; i++) {
      expect(checkSocketRateLimit('sA', 'send-reaction', 20, 10_000, t0 + i)).toBe(true);
    }
    expect(checkSocketRateLimit('sA', 'send-reaction', 20, 10_000, t0 + 200)).toBe(false);
    // Otro socket conserva su cupo.
    expect(checkSocketRateLimit('sB', 'send-reaction', 20, 10_000, t0 + 200)).toBe(true);
  });

  it('playback-heartbeat: mínimo 1/2s (excedente se ignora)', () => {
    const t0 = 3_000_000;
    expect(checkSocketThrottle('s1', 2000, t0)).toBe(true);
    expect(checkSocketThrottle('s1', 2000, t0 + 1999)).toBe(false);
    expect(checkSocketThrottle('s1', 2000, t0 + 2000)).toBe(true);
    // clearSocketLimits (disconnect) resetea el throttle.
    clearSocketLimits('s1');
    expect(checkSocketThrottle('s1', 2000, t0 + 2001)).toBe(true);
  });

  it('dedup: dos idénticos seguidos <500ms → uno; distinto → procesa', () => {
    const t0 = 4_000_000;
    expect(isDuplicateSocketEvent('s1', 'sync-video', 'R|play|10', 500, t0)).toBe(false);
    expect(isDuplicateSocketEvent('s1', 'sync-video', 'R|play|10', 500, t0 + 499)).toBe(true);
    // Fuera de la ventana vuelve a procesar.
    expect(isDuplicateSocketEvent('s1', 'sync-video', 'R|play|10', 500, t0 + 500)).toBe(false);
    // Huella distinta resetea la comparación.
    expect(isDuplicateSocketEvent('s1', 'sync-video', 'R|play|11', 500, t0 + 501)).toBe(false);
  });
});

describe('Socket rate-limit aplicado en handlers de chat', () => {
  function makeSocket(id: string) {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const socket: any = {
      id,
      on: (event: string, fn: (...args: any[]) => unknown) => {
        handlers.set(event, fn);
      },
      emit: (_event: string, ..._args: unknown[]) => {},
      join: (_room: string) => {},
      leave: (_room: string) => {},
      to: (_room: string) => ({ emit: (_e: string, _p?: unknown) => {} }),
    };
    return { socket, handlers };
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

  it('el 9.º mensaje en 10s se ignora sin emitir', () => {
    const { io, roomEmits } = makeIo();
    const { socket, handlers } = makeSocket('s-spam');
    activeUsers.set('s-spam', { socketId: 's-spam', roomId: 'ABC123', userName: 'Ana', isHost: false });
    registerChatReactionsHandlers(io, socket);
    const send = handlers.get('send-message') as (d: unknown) => void;
    for (let i = 0; i < 9; i++) {
      send({ roomId: 'ABC123', text: `msg ${i}`, userName: 'Ana' });
    }
    expect(roomEmits.filter((e) => e.event === 'chat-message')).toHaveLength(8);
  });

  it('la 21.ª reacción en 10s se ignora sin emitir', () => {
    const { io, roomEmits } = makeIo();
    const { socket, handlers } = makeSocket('s-react');
    activeUsers.set('s-react', { socketId: 's-react', roomId: 'ABC123', userName: 'Ana', isHost: false });
    registerChatReactionsHandlers(io, socket);
    const send = handlers.get('send-reaction') as (d: unknown) => void;
    for (let i = 0; i < 21; i++) {
      send({ roomId: 'ABC123', emoji: '❤️', userName: 'Ana' });
    }
    expect(roomEmits.filter((e) => e.event === 'reaction')).toHaveLength(20);
  });
});
