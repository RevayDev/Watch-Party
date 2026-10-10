import { describe, it, expect } from 'vitest';
import { sanitizeRoomSettings } from '../src/domain/settings-policy.js';

describe('music settings-policy', () => {
  it('acepta la whitelist musical completa', () => {
    const { settings, errors } = sanitizeRoomSettings({
      musicEnabled: true,
      musicAllowSearch: false,
      musicCanAdd: 'moderator',
      musicQueueMode: 'votes',
      musicCanRemove: 'moderator',
      musicAllowReorder: true,
      musicRequireApproval: true,
      musicMaxPerUser: 10,
    });
    expect(errors).toEqual([]);
    expect(settings).toMatchObject({
      musicEnabled: true,
      musicAllowSearch: false,
      musicCanAdd: 'moderator',
      musicQueueMode: 'votes',
      musicCanRemove: 'moderator',
      musicAllowReorder: true,
      musicRequireApproval: true,
      musicMaxPerUser: 10,
    });
  });

  it('rechaza enums inválidos con mensaje claro', () => {
    expect(sanitizeRoomSettings({ musicCanAdd: 'todos' }).errors).toContain(
      '"musicCanAdd" debe ser uno de: anyone, moderator.'
    );
    expect(sanitizeRoomSettings({ musicQueueMode: 'random' }).errors).toContain(
      '"musicQueueMode" debe ser uno de: fifo, votes.'
    );
    expect(sanitizeRoomSettings({ musicCanRemove: 'cualquiera' }).errors).toContain(
      '"musicCanRemove" debe ser uno de: proposer, moderator.'
    );
  });

  it('rechaza booleanos no booleanos', () => {
    for (const key of ['musicEnabled', 'musicAllowSearch', 'musicAllowReorder', 'musicRequireApproval']) {
      const { errors } = sanitizeRoomSettings({ [key]: 'yes' });
      expect(errors).toContain(`"${key}" debe ser booleano (true/false).`);
    }
  });

  it('valida el rango de musicMaxPerUser (entero 1-20)', () => {
    for (const bad of [0, 21, 1.5, '5', NaN]) {
      const { errors } = sanitizeRoomSettings({ musicMaxPerUser: bad });
      expect(errors).toContain('"musicMaxPerUser" debe ser un entero entre 1 y 20.');
    }
    expect(sanitizeRoomSettings({ musicMaxPerUser: 1 }).errors).toEqual([]);
    expect(sanitizeRoomSettings({ musicMaxPerUser: 20 }).errors).toEqual([]);
  });

  it('es atómico: un error anula todo el payload', () => {
    const { settings, errors } = sanitizeRoomSettings({
      musicEnabled: true,
      musicCanAdd: 'invalido',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(settings).toEqual({});
  });

  it('sigue rechazando claves desconocidas', () => {
    const { errors } = sanitizeRoomSettings({ musicFoo: true });
    expect(errors).toContain('Ajuste desconocido: "musicFoo".');
  });
});
