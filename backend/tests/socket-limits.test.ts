import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  checkSocketRateLimit,
  checkSocketThrottle,
  isDuplicateSocketEvent,
  clearSocketLimits,
  __resetSocketLimitsForTests,
} from '../src/sockets/socket-limits.js';
import { registerJoinApprovalHandlers } from '../src/sockets/handlers/join-approval.handler.js';
import { RoomService } from '../src/services/room.service.js';
import { activeUsers } from '../src/sockets/socket-state.js';

beforeEach(() => {
  __resetSocketLimitsForTests();
  activeUsers.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('socket-limits: ventana por socket', () => {
  it('permite hasta max y luego bloquea hasta que la ventana expira', () => {
    const now = Date.now();
    expect(checkSocketRateLimit('s', 'k', 3, 10_000, now)).toBe(true);
    expect(checkSocketRateLimit('s', 'k', 3, 10_000, now)).toBe(true);
    expect(checkSocketRateLimit('s', 'k', 3, 10_000, now)).toBe(true);
    expect(checkSocketRateLimit('s', 'k', 3, 10_000, now)).toBe(false);
    // Ventana nueva: vuelve a permitir.
    expect(checkSocketRateLimit('s', 'k', 3, 10_000, now + 10_001)).toBe(true);
  });

  it('las ventanas son independientes por socket y por clave', () => {
    const now = Date.now();
    expect(checkSocketRateLimit('a', 'k', 1, 10_000, now)).toBe(true);
    expect(checkSocketRateLimit('a', 'k', 1, 10_000, now)).toBe(false);
    expect(checkSocketRateLimit('b', 'k', 1, 10_000, now)).toBe(true);
    expect(checkSocketRateLimit('a', 'otra', 1, 10_000, now)).toBe(true);
  });

  it('throttle exige el intervalo mínimo entre eventos', () => {
    const now = Date.now();
    expect(checkSocketThrottle('s', 2000, now)).toBe(true);
    expect(checkSocketThrottle('s', 2000, now + 500)).toBe(false);
    expect(checkSocketThrottle('s', 2000, now + 2000)).toBe(true);
  });

  it('dedup caza duplicados consecutivos idénticos y resetea con huella distinta', () => {
    const now = Date.now();
    expect(isDuplicateSocketEvent('s', 'ev', 'a|1', 500, now)).toBe(false);
    expect(isDuplicateSocketEvent('s', 'ev', 'a|1', 500, now + 100)).toBe(true);
    expect(isDuplicateSocketEvent('s', 'ev', 'b|2', 500, now + 100)).toBe(false);
    expect(isDuplicateSocketEvent('s', 'ev', 'a|1', 500, now + 600)).toBe(false);
  });

  it('clearSocketLimits libera solo ese socket', () => {
    const now = Date.now();
    checkSocketRateLimit('a', 'k', 1, 10_000, now);
    checkSocketRateLimit('b', 'k', 1, 10_000, now);
    clearSocketLimits('a');
    expect(checkSocketRateLimit('a', 'k', 1, 10_000, now)).toBe(true);
    expect(checkSocketRateLimit('b', 'k', 1, 10_000, now)).toBe(false);
  });
});

function makeSocket(id: string) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const emitted: Array<{ event: string; args: unknown[] }> = [];
  const socket: any = {
    id,
    on: (event: string, fn: (...args: any[]) => unknown) => handlers.set(event, fn),
    emit: (event: string, ...args: unknown[]) => emitted.push({ event, args }),
    join: () => {},
    leave: () => {},
    to: () => ({ emit: () => {} }),
  };
  return { socket, handlers, emitted };
}

function makeIo() {
  return {
    to: () => ({ emit: () => {} }),
    in: () => ({ socketsLeave: () => {} }),
    sockets: { adapter: { rooms: new Map() } },
  } as any;
}

describe('anti-raid: join-room', () => {
  it('payload vacío se ignora sin lanzar (join/close/leave)', async () => {
    const { socket, handlers } = makeSocket('s-guard');
    registerJoinApprovalHandlers(makeIo(), socket);

    await expect(
      (handlers.get('join-room') as any)(undefined)
    ).resolves.toBeUndefined();
    await expect(
      (handlers.get('close-room') as any)(undefined)
    ).resolves.toBeUndefined();
    await expect(
      (handlers.get('leave-room') as any)(undefined)
    ).resolves.toBeUndefined();
  });

  it('flood de joins de un socket: solo los primeros 15 llegan a DB', async () => {
    const { socket, handlers } = makeSocket('s-flood');
    registerJoinApprovalHandlers(makeIo(), socket);
    const spy = vi.spyOn(RoomService, 'getRoomById');

    const join = handlers.get('join-room') as any;
    for (let i = 0; i < 20; i++) {
      // Sala inexistente: cada intento permitido hace 2 lecturas y emite room-state.
      await join({ roomId: 'ZZZZZZ', userName: 'Flood' });
    }

    // 15 permitidos × 2 lecturas = 30; los 5 restantes se frenan antes de la DB.
    expect(spy.mock.calls.length).toBe(30);
    activeUsers.delete('s-flood');
  });
});
