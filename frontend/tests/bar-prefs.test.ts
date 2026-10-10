// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBarPrefs } from '../src/features/room/hooks/useBarPrefs';
import { STORAGE_KEYS } from '../src/shared/constants';

/**
 * Estilo personal de la barra (por usuario, solo localStorage).
 */
describe('useBarPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults: etiquetas sí, distribuida', () => {
    const { result } = renderHook(() => useBarPrefs());
    expect(result.current.showLabels).toBe(true);
    expect(result.current.layout).toBe('spread');
  });

  it('apagar etiquetas persiste en localStorage', () => {
    const { result } = renderHook(() => useBarPrefs());
    act(() => {
      result.current.setShowLabels(false);
    });
    expect(result.current.showLabels).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.BAR_LABELS)).toBe('0');
  });

  it('cambiar a centrada persiste y se relee al montar', () => {
    const first = renderHook(() => useBarPrefs());
    act(() => {
      first.result.current.setLayout('centered');
    });
    expect(localStorage.getItem(STORAGE_KEYS.BAR_LAYOUT)).toBe('centered');
    const second = renderHook(() => useBarPrefs());
    expect(second.result.current.layout).toBe('centered');
    expect(second.result.current.showLabels).toBe(true);
  });

  it('valor inválido en storage cae a distribuida', () => {
    localStorage.setItem(STORAGE_KEYS.BAR_LAYOUT, 'raro');
    const { result } = renderHook(() => useBarPrefs());
    expect(result.current.layout).toBe('spread');
  });
});
