import { describe, it, expect } from 'vitest';
import { sanitizeRoomSettings } from '../src/domain/settings-policy.js';

describe('sanitizeRoomSettings: whitelist + errores estrictos', () => {
  it('pasa intactos los ajustes válidos conocidos (sin errores)', () => {
    expect(
      sanitizeRoomSettings({
        muteOnEntry: true,
        cameraOffOnEntry: false,
        allowMicReactivation: true,
        allowCamReactivation: false,
        isTemporary: true,
        requireApproval: true,
        name: 'Noche de cine',
        description: 'Terror',
        timerMinutes: 90,
        timerEndsAt: '2026-10-03T20:00:00.000Z',
      })
    ).toEqual({
      settings: {
        muteOnEntry: true,
        cameraOffOnEntry: false,
        allowMicReactivation: true,
        allowCamReactivation: false,
        isTemporary: true,
        requireApproval: true,
        name: 'Noche de cine',
        description: 'Terror',
        timerMinutes: 90,
        timerEndsAt: '2026-10-03T20:00:00.000Z',
      },
      errors: [],
    });
  });

  it('las claves desconocidas producen error y no se aplica nada (atómico)', () => {
    const result = sanitizeRoomSettings({ evil: true, name: 'Ok' } as any);
    expect(result.settings).toEqual({});
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('evil');
  });

  it('los booleanos con tipo incorrecto producen error y no se aplica nada', () => {
    const result = sanitizeRoomSettings({ muteOnEntry: 'yes', requireApproval: 1 } as any);
    expect(result.settings).toEqual({});
    expect(result.errors).toHaveLength(2);
  });

  it('timerEndsAt inválido produce error (ya no se normaliza en silencio)', () => {
    const bad = sanitizeRoomSettings({ timerEndsAt: 'no-es-fecha' });
    expect(bad.settings).toEqual({});
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toContain('timerEndsAt');
  });

  it('el borrado explícito del timer (null / "") sigue siendo válido', () => {
    expect(sanitizeRoomSettings({ timerEndsAt: null })).toEqual({
      settings: { timerEndsAt: null },
      errors: [],
    });
    expect(sanitizeRoomSettings({ timerEndsAt: '' })).toEqual({
      settings: { timerEndsAt: null },
      errors: [],
    });
  });

  it('normaliza fechas válidas a ISO', () => {
    expect(sanitizeRoomSettings({ timerEndsAt: '2026-10-03T20:00:00Z' })).toEqual({
      settings: { timerEndsAt: '2026-10-03T20:00:00.000Z' },
      errors: [],
    });
  });

  it('acepta timerMinutes numérico finito >= 0 o null, y el resto es error', () => {
    expect(sanitizeRoomSettings({ timerMinutes: 45 })).toMatchObject({ errors: [] });
    expect(sanitizeRoomSettings({ timerMinutes: null })).toMatchObject({ errors: [] });
    expect(sanitizeRoomSettings({ timerMinutes: 0 })).toMatchObject({ errors: [] });
    for (const bad of [NaN, -5, '45', Infinity]) {
      const result = sanitizeRoomSettings({ timerMinutes: bad } as any);
      expect(result.settings).toEqual({});
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('name/description no textuales producen error', () => {
    const result = sanitizeRoomSettings({ name: 123 } as any);
    expect(result.settings).toEqual({});
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('una entrada no objeto produce error', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      const result = sanitizeRoomSettings(bad as any);
      expect(result.settings).toEqual({});
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('solo incluye las claves presentes en la entrada (merge parcial seguro)', () => {
    expect(sanitizeRoomSettings({ muteOnEntry: true })).toEqual({
      settings: { muteOnEntry: true },
      errors: [],
    });
  });

  it('errores múltiples se acumulan y el resultado es vacío (todo o nada)', () => {
    const result = sanitizeRoomSettings({ muteOnEntry: 'yes', timerMinutes: -1, extra: 1 } as any);
    expect(result.settings).toEqual({});
    expect(result.errors.length).toBe(3);
  });
});
