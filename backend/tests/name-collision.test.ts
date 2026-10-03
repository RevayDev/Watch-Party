import { describe, it, expect } from 'vitest';
import { isNameTaken } from '../src/domain/room.entity.js';
import type { IParticipant } from '../src/types/room.types.js';

function p(name: string, userId?: string): IParticipant {
  return { name, userId, isHost: false, role: 'member', joinedAt: new Date() };
}

describe('isNameTaken (H8)', () => {
  it('nombre libre: no ocupado', () => {
    expect(isNameTaken([p('Ana', 'u-1')], 'u-2', 'Beto')).toBe(false);
    expect(isNameTaken([], 'u-2', 'Beto')).toBe(false);
  });

  it('rejoin con el mismo userId siempre permitido (aunque cambie el nombre)', () => {
    const participants = [p('Ana', 'u-1'), p('Beto', 'u-2')];
    expect(isNameTaken(participants, 'u-1', 'Ana')).toBe(false);
    expect(isNameTaken(participants, 'u-1', 'OtroNombre')).toBe(false);
    expect(isNameTaken(participants, 'u-1', 'BETO')).toBe(false);
  });

  it('nombre de otra identidad registrada (distinto userId): ocupado', () => {
    const participants = [p('Ana', 'u-1')];
    expect(isNameTaken(participants, 'u-2', 'ana')).toBe(true);
    expect(isNameTaken(participants, 'u-2', ' ANA ')).toBe(true);
  });

  it('legacy sin userId es reclamable: no bloquea a un userId nuevo', () => {
    const participants = [p('Ana')];
    expect(isNameTaken(participants, 'u-2', 'Ana')).toBe(false);
  });

  it('anónimo nuevo frente a nombre de identidad registrada: ocupado', () => {
    const participants = [p('Ana', 'u-1')];
    expect(isNameTaken(participants, undefined, 'Ana')).toBe(true);
  });

  it('dos anónimos con el mismo nombre se tratan como la misma persona (legacy)', () => {
    const participants = [p('Ana')];
    expect(isNameTaken(participants, undefined, 'ana')).toBe(false);
  });
});
