import type { PaymentRecord } from './types';

/** Rangos del panel (calculados en cliente desde la lista de pagos). */
export type RevenueRange = 'today' | '7d' | '30d' | 'month' | 'all';

export const REVENUE_RANGE_LABELS: Record<RevenueRange, string> = {
  today: 'Hoy',
  '7d': '7d',
  '30d': '30d',
  month: 'Mes',
  all: 'Todo',
};

export interface RevenueSummary {
  today: number;
  week: number;
  month: number;
  total: number;
  currency: string;
}

export interface RevenueBucket {
  key: string;
  label: string;
  revenue: number;
  count: number;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function paymentDate(p: PaymentRecord): Date | null {
  const raw = p.completedAt ?? p.createdAt;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Solo los `completed` generan ingreso (pendientes/fallidos/reembolsados no suman). */
export function isRevenue(p: PaymentRecord): boolean {
  return p.status === 'completed';
}

/**
 * Ingresos hoy (día calendario) / semana (últimos 7 d) / mes (últimos 30 d) /
 * total. Calculado en cliente desde la lista del admin (sin agregados en API).
 */
export function summarizeRevenue(payments: PaymentRecord[], now: Date = new Date()): RevenueSummary {
  const dayStart = startOfDay(now).getTime();
  const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const monthStart = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  let today = 0;
  let week = 0;
  let month = 0;
  let total = 0;
  let currency = 'COP';
  for (const p of payments) {
    if (!isRevenue(p)) continue;
    currency = p.currency || currency;
    const d = paymentDate(p);
    if (!d) continue;
    const t = d.getTime();
    total += p.amount;
    if (t >= monthStart) month += p.amount;
    if (t >= weekStart) week += p.amount;
    if (t >= dayStart) today += p.amount;
  }
  return { today, week, month, total, currency };
}

/** `5000 COP` → `$ 5.000`. Sin `currency` válida cae a `COP`. */
export function formatMoney(amount: number, currency = 'COP'): string {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' });
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
}

function rangeStart(range: RevenueRange, now: Date): Date | null {
  if (range === 'today') return startOfDay(now);
  if (range === '7d') return new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  if (range === '30d') return new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}

/**
 * Serie por día (Hoy/7d/30d/mes) o por mes (Todo con >62 días de_span_).
 * Solo `completed`; días sin ventas salen en 0 (sin inventar datos).
 */
export function bucketizeRevenue(payments: PaymentRecord[], range: RevenueRange, now: Date = new Date()): RevenueBucket[] {
  const from = rangeStart(range, now);
  const rows = payments.filter(isRevenue);
  const dated = rows
    .map((p) => ({ p, d: paymentDate(p) }))
    .filter((r): r is { p: PaymentRecord; d: Date } => r.d !== null)
    .filter((r) => !from || r.d.getTime() >= startOfDay(from).getTime());

  if (dated.length === 0) return [];

  const minT = Math.min(...dated.map((r) => r.d.getTime()));
  const spanDays = (now.getTime() - minT) / (24 * 60 * 60 * 1000);
  const byMonth = range === 'all' && spanDays > 62;

  const map = new Map<string, RevenueBucket>();
  if (!byMonth && from) {
    // Rellena días vacíos del rango (ceros honestos, no datos inventados).
    const end = startOfDay(now);
    const cursor = new Date(startOfDay(from));
    if (range === 'month') {
      while (cursor <= end) {
        const k = dayKey(cursor);
        map.set(k, { key: k, label: dayLabel(cursor), revenue: 0, count: 0 });
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      const days = range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 0;
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(end);
        d.setDate(d.getDate() - i);
        const k = dayKey(d);
        map.set(k, { key: k, label: dayLabel(d), revenue: 0, count: 0 });
      }
    }
  }

  for (const { p, d } of dated) {
    const key = byMonth
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : dayKey(d);
    const label = byMonth ? monthLabel(d) : dayLabel(d);
    const bucket = map.get(key) ?? { key, label, revenue: 0, count: 0 };
    bucket.revenue += p.amount;
    bucket.count += 1;
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** `2026-10-05T12:00:00Z` → `05/10 12:00` (hora local, tablas del panel). */
export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
