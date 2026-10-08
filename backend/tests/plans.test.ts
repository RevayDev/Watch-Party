import { describe, it, expect, afterEach } from 'vitest';
import {
  FREE_PLAN_DEFAULTS,
  PREMIUM_PLAN_DEFAULTS,
  getFreePlan,
  getPlans,
  getPremiumPlan,
  parsePositiveIntEnv,
} from '../src/config/plans.js';
import {
  DEMO_MAX_USERS_PER_ROOM,
  DEMO_TIMER_MAX_MINUTES,
} from '../src/config/demo-mode.js';

const ENV_KEYS = [
  'FREE_ROOM_MAX_USERS',
  'FREE_ROOM_MAX_DURATION_MIN',
  'PREMIUM_ROOM_MAX_USERS',
  'PREMIUM_ROOM_PRICE_COP',
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv.get(key);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

describe('plans centrales (config/plans.ts)', () => {
  it('FREE por defecto sigue a la demo real (5 usuarios, 480 min)', () => {
    expect(DEMO_MAX_USERS_PER_ROOM).toBe(5);
    expect(DEMO_TIMER_MAX_MINUTES).toBe(480);
    expect(FREE_PLAN_DEFAULTS.maxUsers).toBe(DEMO_MAX_USERS_PER_ROOM);
    expect(FREE_PLAN_DEFAULTS.maxDurationMin).toBe(DEMO_TIMER_MAX_MINUTES);
    expect(getFreePlan()).toEqual({ id: 'free', maxUsers: 5, maxDurationMin: 480 });
  });

  it('PREMIUM por defecto: 10 usuarios, 5000 COP', () => {
    expect(getPremiumPlan()).toEqual({
      id: 'premium',
      maxUsers: 10,
      priceCop: 5000,
      currency: 'COP',
    });
    expect(PREMIUM_PLAN_DEFAULTS).toMatchObject({ maxUsers: 10, priceCop: 5000 });
  });

  it('overrides por env aplicados a ambos planes', () => {
    process.env.FREE_ROOM_MAX_USERS = '8';
    process.env.FREE_ROOM_MAX_DURATION_MIN = '60';
    process.env.PREMIUM_ROOM_MAX_USERS = '25';
    process.env.PREMIUM_ROOM_PRICE_COP = '9999';
    expect(getFreePlan()).toEqual({ id: 'free', maxUsers: 8, maxDurationMin: 60 });
    expect(getPremiumPlan()).toMatchObject({ maxUsers: 25, priceCop: 9999, currency: 'COP' });
    expect(getPlans().free).toEqual(getFreePlan());
    expect(getPlans().premium).toEqual(getPremiumPlan());
  });

  it('env inválido (texto, 0, negativo, vacío) → default, nunca revienta', () => {
    for (const bad of ['abc', '0', '-3', '4.5', '', '   ']) {
      process.env.FREE_ROOM_MAX_USERS = bad;
      process.env.PREMIUM_ROOM_PRICE_COP = bad;
      expect(getFreePlan().maxUsers).toBe(FREE_PLAN_DEFAULTS.maxUsers);
      expect(getPremiumPlan().priceCop).toBe(PREMIUM_PLAN_DEFAULTS.priceCop);
    }
  });

  it('parsePositiveIntEnv: pura y predecible', () => {
    expect(parsePositiveIntEnv(undefined, 7)).toBe(7);
    expect(parsePositiveIntEnv('12', 7)).toBe(12);
    expect(parsePositiveIntEnv(' 12 ', 7)).toBe(12);
    expect(parsePositiveIntEnv('0', 7)).toBe(7);
    expect(parsePositiveIntEnv('x', 7)).toBe(7);
  });
});
