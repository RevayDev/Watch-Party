import { describe, it, expect } from 'vitest';
import {
  findRequesterParticipant,
  isAuthorized,
  isModeratorParticipant,
  requireHost,
  requireModerator,
} from '../src/domain/auth-policy.js';
import type { IParticipant, IRoom } from '../src/types/room.types.js';

function participant(overrides: Partial<IParticipant> & { name: string }): IParticipant {
  return {
    isHost: false,
    role: 'member',
    joinedAt: new Date(),
    ...overrides,
  };
}

function room(): IRoom {
  const now = new Date();
  return {
    roomId: 'ABC123',
    hostName: 'Anfitrion',
    hostSecret: 'secreto-abc',
    status: 'waiting',
    participants: [
      participant({ name: 'Anfitrion', userId: 'u-host', isHost: true, role: 'host' }),
      participant({ name: 'Cohost', userId: 'u-co', role: 'cohost' }),
      participant({ name: 'Miembro', userId: 'u-mem', role: 'member' }),
      participant({ name: 'Legacy', role: 'member' }),
    ],
    kickedUsers: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe('isModeratorParticipant', () => {
  it('host (flag o rol) y cohost son moderadores; miembro no', () => {
    expect(isModeratorParticipant(participant({ name: 'H', isHost: true }))).toBe(true);
    expect(isModeratorParticipant(participant({ name: 'H', role: 'host' }))).toBe(true);
    expect(isModeratorParticipant(participant({ name: 'C', role: 'cohost' }))).toBe(true);
    expect(isModeratorParticipant(participant({ name: 'M', role: 'member' }))).toBe(false);
  });
});

describe('isAuthorized con hostSecret', () => {
  it('el secreto válido autoriza host y moderador sin identidad', () => {
    const r = room();
    expect(isAuthorized(r, { hostSecret: 'secreto-abc' }, 'host')).toBe(true);
    expect(isAuthorized(r, { hostSecret: 'secreto-abc' }, 'moderator')).toBe(true);
  });

  it('el secreto inválido o vacío no autoriza por sí solo', () => {
    const r = room();
    expect(isAuthorized(r, { hostSecret: 'otro' }, 'host')).toBe(false);
    expect(isAuthorized(r, { hostSecret: '' }, 'moderator')).toBe(false);
  });
});

describe('isAuthorized por rol del servidor', () => {
  it('host por userId: autorizado en ambos niveles', () => {
    const r = room();
    expect(requireHost(r, { requesterUserId: 'u-host' })).toBe(true);
    expect(requireModerator(r, { requesterUserId: 'u-host' })).toBe(true);
  });

  it('cohost por userId: moderador sí, host no', () => {
    const r = room();
    expect(requireModerator(r, { requesterUserId: 'u-co' })).toBe(true);
    expect(requireHost(r, { requesterUserId: 'u-co' })).toBe(false);
  });

  it('miembro por userId: denegado en ambos niveles', () => {
    const r = room();
    expect(requireModerator(r, { requesterUserId: 'u-mem' })).toBe(false);
    expect(requireHost(r, { requesterUserId: 'u-mem' })).toBe(false);
  });

  it('fallback por nombre (sin userId) respeta mayúsculas y rol', () => {
    const r = room();
    expect(requireModerator(r, { requesterName: 'cohost' })).toBe(true);
    expect(requireHost(r, { requesterName: 'ANFITRION' })).toBe(true);
    expect(requireModerator(r, { requesterName: 'miembro' })).toBe(false);
  });

  it('un userId desconocido NO cae al nombre (anti-suplantación)', () => {
    const r = room();
    expect(requireModerator(r, { requesterUserId: 'u-falso', requesterName: 'Cohost' })).toBe(false);
  });

  it('sala inexistente nunca autoriza', () => {
    expect(isAuthorized(null, { hostSecret: 'secreto-abc' }, 'host')).toBe(false);
    expect(isAuthorized(undefined, { requesterUserId: 'u-host' }, 'moderator')).toBe(false);
  });
});

describe('findRequesterParticipant', () => {
  it('prefiere userId y devuelve undefined si es desconocido', () => {
    const r = room();
    expect(findRequesterParticipant(r, { requesterUserId: 'u-mem' })?.name).toBe('Miembro');
    expect(findRequesterParticipant(r, { requesterUserId: 'nadie' })).toBeUndefined();
  });

  it('sin userId busca por nombre insensible a mayúsculas', () => {
    const r = room();
    expect(findRequesterParticipant(r, { requesterName: 'legacy' })?.name).toBe('Legacy');
    expect(findRequesterParticipant(r, {})).toBeUndefined();
  });
});
