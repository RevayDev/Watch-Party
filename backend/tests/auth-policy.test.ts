import { describe, it, expect } from 'vitest';
import {
  findRequesterParticipant,
  isAuthorized,
  isModeratorParticipant,
  requireLeader,
  requireModerator,
} from '../src/domain/auth-policy.js';
import type { IParticipant, IRoom } from '../src/types/room.types.js';

function participant(overrides: Partial<IParticipant> & { name: string }): IParticipant {
  return {
    isLeader: false,
    role: 'member',
    joinedAt: new Date(),
    ...overrides,
  };
}

function room(): IRoom {
  const now = new Date();
  return {
    roomId: 'ABC123',
    leaderName: 'Anfitrion',
    leaderSecret: 'secreto-abc',
    status: 'waiting',
    participants: [
      participant({ name: 'Anfitrion', userId: 'u-leader', isLeader: true, role: 'leader' }),
      participant({ name: 'Coleader', userId: 'u-co', role: 'coleader' }),
      participant({ name: 'Miembro', userId: 'u-mem', role: 'member' }),
      participant({ name: 'Legacy', role: 'member' }),
    ],
    kickedUsers: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe('isModeratorParticipant', () => {
  it('leader (flag o rol) y coleader son moderadores; miembro no', () => {
    expect(isModeratorParticipant(participant({ name: 'H', isLeader: true }))).toBe(true);
    expect(isModeratorParticipant(participant({ name: 'H', role: 'leader' }))).toBe(true);
    expect(isModeratorParticipant(participant({ name: 'C', role: 'coleader' }))).toBe(true);
    expect(isModeratorParticipant(participant({ name: 'M', role: 'member' }))).toBe(false);
  });
});

describe('isAuthorized con leaderSecret', () => {
  it('el secreto válido autoriza leader y moderador sin identidad', () => {
    const r = room();
    expect(isAuthorized(r, { leaderSecret: 'secreto-abc' }, 'leader')).toBe(true);
    expect(isAuthorized(r, { leaderSecret: 'secreto-abc' }, 'moderator')).toBe(true);
  });

  it('el secreto inválido o vacío no autoriza por sí solo', () => {
    const r = room();
    expect(isAuthorized(r, { leaderSecret: 'otro' }, 'leader')).toBe(false);
    expect(isAuthorized(r, { leaderSecret: '' }, 'moderator')).toBe(false);
  });
});

describe('isAuthorized por rol del servidor', () => {
  it('leader por userId: autorizado en ambos niveles', () => {
    const r = room();
    expect(requireLeader(r, { requesterUserId: 'u-leader' })).toBe(true);
    expect(requireModerator(r, { requesterUserId: 'u-leader' })).toBe(true);
  });

  it('coleader por userId: moderador sí, leader no', () => {
    const r = room();
    expect(requireModerator(r, { requesterUserId: 'u-co' })).toBe(true);
    expect(requireLeader(r, { requesterUserId: 'u-co' })).toBe(false);
  });

  it('miembro por userId: denegado en ambos niveles', () => {
    const r = room();
    expect(requireModerator(r, { requesterUserId: 'u-mem' })).toBe(false);
    expect(requireLeader(r, { requesterUserId: 'u-mem' })).toBe(false);
  });

  it('fallback por nombre (sin userId) respeta mayúsculas y rol', () => {
    const r = room();
    expect(requireModerator(r, { requesterName: 'coleader' })).toBe(true);
    expect(requireLeader(r, { requesterName: 'ANFITRION' })).toBe(true);
    expect(requireModerator(r, { requesterName: 'miembro' })).toBe(false);
  });

  it('un userId desconocido NO cae al nombre (anti-suplantación)', () => {
    const r = room();
    expect(requireModerator(r, { requesterUserId: 'u-falso', requesterName: 'Coleader' })).toBe(false);
  });

  it('sala inexistente nunca autoriza', () => {
    expect(isAuthorized(null, { leaderSecret: 'secreto-abc' }, 'leader')).toBe(false);
    expect(isAuthorized(undefined, { requesterUserId: 'u-leader' }, 'moderator')).toBe(false);
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
