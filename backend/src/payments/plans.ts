/**
 * SUBAGENTE 3 (pagos): catálogo vendible (SKUs de checkout).
 *
 * Fuente de precio: `src/config/plans.ts` (contrato: se usa al existir).
 * `PREMIUM_ROOM` deriva monto/moneda en vivo de `getPremiumPlan()` para no
 * duplicar la verdad (hoy: 5000 COP). `durationDays` (días de acceso que
 * otorga la compra) es propio de pagos y vive aquí.
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
  description: string;
}

/** Días de acceso que otorga la compra premium (propio de pagos). */
export const PREMIUM_ACCESS_DAYS = 30;

export const PREMIUM_ROOM_PLAN_ID = 'PREMIUM_ROOM';

export function getPlan(planId: string): Plan | null {
  if (!planId || typeof planId !== 'string') return null;
  if (planId.trim().toUpperCase() !== PREMIUM_ROOM_PLAN_ID) return null;
  const premium = getPremiumPlan();
  return {
    id: PREMIUM_ROOM_PLAN_ID,
    name: `Sala Premium (${PREMIUM_ACCESS_DAYS} días)`,
    amount: premium.priceCop,
    currency: premium.currency,
    durationDays: PREMIUM_ACCESS_DAYS,
    description: 'Acceso premium ligado a una sala o a un usuario.',
  };
}

export function listPlans(): Plan[] {
  const plan = getPlan(PREMIUM_ROOM_PLAN_ID);
  return plan ? [plan] : [];
}

/** Compara montos en centavos (evita 4.99 !== 4.9900001). */
export function amountsEqual(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}
