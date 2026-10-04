// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePresence } from '../src/hooks/usePresence';

afterEach(() => {
  vi.useRealTimers();
});

describe('usePresence: animación de salida', () => {
  it('abierto → shown sin closing', () => {
    const { result } = renderHook(() => usePresence(true));
    expect(result.current).toEqual({ shown: true, closing: false });
  });

  it('cerrado inicial → hidden', () => {
    const { result } = renderHook(() => usePresence(false));
    expect(result.current).toEqual({ shown: false, closing: false });
  });

  it('al cerrar pasa por closing y luego a hidden tras duration', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }: { open: boolean }) => usePresence(open, 160), {
      initialProps: { open: true },
    });

    rerender({ open: false });
    expect(result.current).toEqual({ shown: true, closing: true });

    act(() => {
      vi.advanceTimersByTime(159);
    });
    expect(result.current.shown).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual({ shown: false, closing: false });
  });

  it('reabrir durante closing cancela el ocultado', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }: { open: boolean }) => usePresence(open, 160), {
      initialProps: { open: true },
    });

    rerender({ open: false });
    expect(result.current.closing).toBe(true);

    rerender({ open: true });
    expect(result.current).toEqual({ shown: true, closing: false });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toEqual({ shown: true, closing: false });
  });
});
