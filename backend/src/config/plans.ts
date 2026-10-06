/**
 * PLANES CENTRALES — modelo de producto free/premium (rama `demo-free`).
 *
 * - Fuente única de verdad para los límites por plan. La demo (`demo-mode.ts`)
 *   sigue mandando en runtime HOY; estos planes son el contrato hacia el que
 *   migrarán las cuotas (fase posterior: pagos/testing los consumirán).
 * - Valores FREE alineados con la demo: `maxUsers` = `DEMO_MAX_USERS_PER_ROOM`
 *   (5 real) y `maxDurationMin` = `DEMO_TIMER_MAX_MINUTES` (480 real). Si la
 *   demo cambia, los defaults FREE la siguen (import directo, sin duplicar).
 * - Override por variables de entorno (leídas EN VIVO en cada `getPlans()`,
 *   sin caché: sin hot-path aún y así los tests no necesitan reset):
 *     FREE_ROOM_MAX_USERS | FREE_ROOM_MAX_DURATION_MIN |
 *     PREMIUM_ROOM_MAX_USERS | PREMIUM_ROOM_PRICE_COP
 *   Valores inválidos (no numéricos, <=0) → se ignora el override y se usa el
 *   default (nunca revienta el arranque).
 * - SIN UI de administración en runtime (fase posterior): no hay endpoint que
 *   mute estos valores en caliente; solo env + redespliegue. Cuando exista
 *   `/api/admin/*` (con `requireAdmin`) se decidirá si los planes son
 *   editables o siguen siendo solo-env.
 */

import { DEMO_MAX_USERS_PER_ROOM, DEMO_TIMER_MAX_MINUTES } from './demo-mode.js';

export type PlanId = 'free' | 'premium';

export interface FreePlan {
  id: 'free';
  maxUsers: number;
  maxDurationMin: number;
}

export interface PremiumPlan {
  id: 'premium';
  maxUsers: number;
  priceCop: number;
  currency: 'COP';
}

/** Defaults (los FREE referencian las constantes demo: ver cabecera). */
export const FREE_PLAN_DEFAULTS = {
  maxUsers: DEMO_MAX_USERS_PER_ROOM,
  maxDurationMin: DEMO_TIMER_MAX_MINUTES,
} as const;

export const PREMIUM_PLAN_DEFAULTS = {
  maxUsers: 10,
  priceCop: 5000,
  currency: 'COP',
} as const;

/** Lee un entero positivo del env; `undefined`/inválido → `fallback`. */
export function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** Plan gratuito con overrides de env aplicados. */
export function getFreePlan(): FreePlan {
  return {
    id: 'free',
    maxUsers: parsePositiveIntEnv(process.env.FREE_ROOM_MAX_USERS, FREE_PLAN_DEFAULTS.maxUsers),
    maxDurationMin: parsePositiveIntEnv(
      process.env.FREE_ROOM_MAX_DURATION_MIN,
      FREE_PLAN_DEFAULTS.maxDurationMin
    ),
  };
}

/** Plan premium con overrides de env aplicados (`currency` fija: COP). */
export function getPremiumPlan(): PremiumPlan {
  return {
    id: 'premium',
    maxUsers: parsePositiveIntEnv(process.env.PREMIUM_ROOM_MAX_USERS, PREMIUM_PLAN_DEFAULTS.maxUsers),
    priceCop: parsePositiveIntEnv(process.env.PREMIUM_ROOM_PRICE_COP, PREMIUM_PLAN_DEFAULTS.priceCop),
    currency: 'COP',
  };
}

/** Ambos planes (objeto indexado por `PlanId`). */
export function getPlans(): Record<PlanId, FreePlan | PremiumPlan> {
  return { free: getFreePlan(), premium: getPremiumPlan() };
}
