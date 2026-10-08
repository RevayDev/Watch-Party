import { describe, it, expect } from 'vitest';
import { getPlan, listPlans, PREMIUM_ROOM_PLAN_ID } from '../src/payments/plans.js';

describe('catálogo de planes vendibles', () => {
  it('lista los tres niveles con capacidad y duración', () => {
    const plans = listPlans();
    expect(plans.map((p) => p.id)).toEqual(['INMEDIATA', 'ESTANDAR', 'PLUS']);
    expect(plans).toMatchObject([
      { maxUsers: 10, durationHours: 3 },
      { maxUsers: 5, durationHours: 2 },
      { maxUsers: 15, durationHours: 5 },
    ]);
    for (const p of plans) {
      expect(p.amount).toBeGreaterThan(0);
      expect(p.currency).toBe('COP');
    }
  });

  it('resuelve cada nivel por id (insensible a mayúsculas)', () => {
    expect(getPlan('inmediata')?.maxUsers).toBe(10);
    expect(getPlan('ESTANDAR')?.durationHours).toBe(2);
    expect(getPlan('plus')?.amount).toBe(8000);
    expect(getPlan('NOPE')).toBeNull();
    expect(getPlan('')).toBeNull();
  });

  it('mantiene el alias legacy PREMIUM_ROOM', () => {
    const legacy = getPlan(PREMIUM_ROOM_PLAN_ID);
    expect(legacy).not.toBeNull();
    expect(legacy?.id).toBe(PREMIUM_ROOM_PLAN_ID);
  });
});
