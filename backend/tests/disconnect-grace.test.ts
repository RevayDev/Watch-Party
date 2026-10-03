import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DISCONNECT_GRACE_MS,
  cancelPendingGrace,
  clearAllPendingGraces,
  graceKey,
  hasPendingGrace,
  pendingGraceCount,
  schedulePendingGrace,
} from '../src/sockets/disconnect-grace.js';

beforeEach(() => {
  clearAllPendingGraces();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  clearAllPendingGraces();
});

describe('disconnect-grace (H3)', () => {
  it('la clave es `${roomId}:${userId}` normalizada', () => {
    expect(graceKey(' abc123 ', 'u-1')).toBe('ABC123:u-1');
  });

  it('programa y difiere la eliminación hasta 20s', () => {
    expect(DISCONNECT_GRACE_MS).toBe(20_000);
    const cb = vi.fn();
    schedulePendingGrace('ROOM1', 'u-1', cb);
    expect(hasPendingGrace('ROOM1', 'u-1')).toBe(true);
    expect(pendingGraceCount()).toBe(1);
    vi.advanceTimersByTime(19_999);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(hasPendingGrace('ROOM1', 'u-1')).toBe(false);
  });

  it('cancelar evita la eliminación (rejoin dentro de la ventana)', () => {
    const cb = vi.fn();
    schedulePendingGrace('ROOM1', 'u-1', cb);
    expect(cancelPendingGrace('ROOM1', 'u-1')).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(cb).not.toHaveBeenCalled();
    expect(pendingGraceCount()).toBe(0);
  });

  it('cancelar sin pendiente devuelve false', () => {
    expect(cancelPendingGrace('ROOM1', 'u-1')).toBe(false);
  });

  it('reprogramar reemplaza la anterior (una sola expiración)', () => {
    const first = vi.fn();
    const second = vi.fn();
    schedulePendingGrace('ROOM1', 'u-1', first);
    schedulePendingGrace('ROOM1', 'u-1', second);
    expect(pendingGraceCount()).toBe(1);
    vi.advanceTimersByTime(20_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('las gracias son independientes por identidad', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    schedulePendingGrace('ROOM1', 'u-1', cb1);
    schedulePendingGrace('ROOM1', 'u-2', cb2);
    cancelPendingGrace('ROOM1', 'u-1');
    vi.advanceTimersByTime(20_000);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});
