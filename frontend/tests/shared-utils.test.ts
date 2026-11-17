import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatRelativeTime,
  getAvatarColor,
  getInitials,
  formatRemaining,
} from '../src/shared/utils';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatRelativeTime', () => {
  it('ahora mismo para diferencias menores a un minuto o futuras', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    const now = Date.now();
    expect(formatRelativeTime(now)).toBe('ahora mismo');
    expect(formatRelativeTime(now - 30_000)).toBe('ahora mismo');
    expect(formatRelativeTime(now + 60_000)).toBe('ahora mismo');
  });

  it('minutos, horas, ayer y días', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    const now = Date.now();
    expect(formatRelativeTime(now - 5 * 60_000)).toBe('hace 5 min');
    expect(formatRelativeTime(now - 59 * 60_000)).toBe('hace 59 min');
    expect(formatRelativeTime(now - 3 * 3_600_000)).toBe('hace 3 h');
    expect(formatRelativeTime(now - 26 * 3_600_000)).toBe('ayer');
    expect(formatRelativeTime(now - 3 * 86_400_000)).toBe('hace 3 días');
  });

  it('más de una semana muestra fecha corta', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    const out = formatRelativeTime(Date.now() - 10 * 86_400_000);
    expect(typeof out).toBe('string');
    expect(out).not.toMatch(/^hace/);
  });
});

describe('getAvatarColor', () => {
  it('es determinista y devuelve un gradiente conocido', () => {
    const a = getAvatarColor('Roberto');
    expect(getAvatarColor('Roberto')).toBe(a);
    expect(a).toMatch(/^linear-gradient\(135deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
  });

  it('nombres distintos pueden mapear a colores distintos (no colisiona trivialmente)', () => {
    const colors = new Set(['Ana', 'Beto', 'Carlos', 'Diana', 'Elena', 'Fabio', 'Gina'].map(getAvatarColor));
    expect(colors.size).toBeGreaterThan(1);
  });

  it('no lanza con string vacío', () => {
    expect(() => getAvatarColor('')).not.toThrow();
  });
});

describe('getInitials', () => {
  it.each([
    ['Roberto Carlos', 'RC'],
    ['ana maría', 'AM'],
    ['ana  maría', 'AM'],
    ['ana\tmaría', 'AM'],
    ['  Ana  ', 'AN'],
    ['Ana', 'AN'],
    ['X', 'X'],
    ['Al', 'AL'],
    ['abc def ghi', 'AD'],
    ['', ''],
    ['   ', ''],
  ])('"%s" -> "%s"', (input, expected) => {
    expect(getInitials(input)).toBe(expected);
  });
});

describe('formatRemaining', () => {
  it.each([
    [0, '0:00'],
    [5_000, '0:05'],
    [65_000, '1:05'],
    [3_600_000, '1:00:00'],
    [3_723_000, '1:02:03'],
    [-1_000, '0:00'],
  ])('%i ms -> "%s"', (ms, expected) => {
    expect(formatRemaining(ms)).toBe(expected);
  });
});
