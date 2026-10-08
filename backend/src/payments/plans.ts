/**
 * Catálogo vendible (SKUs de checkout).
 *
 * Niveles (precios provisorios en COP, fáciles de ajustar abajo):
 * - INMEDIATA: 10 personas, 3 horas — $5.000
 * - ESTANDAR:    5 personas, 2 horas — $3.000
 * - PLUS:       15 personas, 5 horas — $8.000
 *
 * Moneda/precio del plan legacy derivan en vivo de `getPremiumPlan()` para no
 * duplicar la verdad. `durationDays` (días de acceso que otorga) se conserva
 * por compatibilidad.
 *
 * RIESGO DOCUMENTADO: PayPal no liquida COP en su API real; con
 * credenciales PayPal de verdad habría que vender en USD (SKU separado) o
 * usar el futuro proveedor de tarjeta para Colombia. En modo stub el flujo
 * funciona igual (la firma cubre monto+moneda).
 */

import { getPremiumPlan } from '../config/plans.js';

export interface Plan {
  id: string;
  name: string;
  /** Precio en unidades mayores (ej. 5000 = 5000 COP). */
  amount: number;
  /** ISO 4217 (heredado del plan central). */
  currency: string;
  /** Días de acceso premium que otorga. */
  durationDays: number;
  /** Capacidad máxima de la sala del plan. */
  maxUsers: number;
  /** Duración de la sala del plan, en horas. */
  durationHours: number;
  /** Texto corto para la tarjeta de compra. */
  tagline: string;
  description: string;
}

/** Días de acceso que otorga la compra premium (propio de pagos). */
export const PREMIUM_ACCESS_DAYS = 30;

export const PREMIUM_ROOM_PLAN_ID = 'PREMIUM_ROOM';

export const PLAN_INMEDIATA_ID = 'INMEDIATA';
export const PLAN_ESTANDAR_ID = 'ESTANDAR';
export const PLAN_PLUS_ID = 'PLUS';

function buildTierPlan(entry: {
  id: string;
  name: string;
  amount: number;
  maxUsers: number;
  durationHours: number;
  tagline: string;
}): Plan {
  const premium = getPremiumPlan();
  return {
    id: entry.id,
    name: entry.name,
    amount: entry.amount,
    currency: premium.currency,
    durationDays: PREMIUM_ACCESS_DAYS,
    maxUsers: entry.maxUsers,
    durationHours: entry.durationHours,
    tagline: entry.tagline,
    description: `Acceso premium: hasta ${entry.maxUsers} personas por ${entry.durationHours} horas.`,
  };
}

const TIER_CATALOG: Plan[] = [
  buildTierPlan({
    id: PLAN_INMEDIATA_ID,
    name: 'Sala Inmediata',
    amount: 5000,
    maxUsers: 10,
    durationHours: 3,
    tagline: 'Para ver ya mismo, con todo el grupo.',
  }),
  buildTierPlan({
    id: PLAN_ESTANDAR_ID,
    name: 'Sala Estándar',
    amount: 3000,
    maxUsers: 5,
    durationHours: 2,
    tagline: 'La clásica para noches de película.',
  }),
  buildTierPlan({
    id: PLAN_PLUS_ID,
    name: 'Sala Plus',
    amount: 8000,
    maxUsers: 15,
    durationHours: 5,
    tagline: 'Maratones largas con mucha gente.',
  }),
];

function legacyPremiumPlan(): Plan {
  const premium = getPremiumPlan();
  return {
    id: PREMIUM_ROOM_PLAN_ID,
    name: `Sala Premium (${PREMIUM_ACCESS_DAYS} días)`,
    amount: premium.priceCop,
    currency: premium.currency,
    durationDays: PREMIUM_ACCESS_DAYS,
    maxUsers: premium.maxUsers,
    durationHours: 24 * PREMIUM_ACCESS_DAYS,
    tagline: 'Acceso premium ligado a una sala o a un usuario.',
    description: 'Acceso premium ligado a una sala o a un usuario.',
  };
}

export function getPlan(planId: string): Plan | null {
  if (!planId || typeof planId !== 'string') return null;
  const clean = planId.trim().toUpperCase();
  if (clean === PREMIUM_ROOM_PLAN_ID) return legacyPremiumPlan();
  return TIER_CATALOG.find((p) => p.id === clean) ?? null;
}

export function listPlans(): Plan[] {
  return [...TIER_CATALOG];
}

/** Compara montos en centavos (evita 4.99 !== 4.9900001). */
export function amountsEqual(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}
