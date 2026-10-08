/**
 * METRICS — observabilidad en memoria (sin dependencias, sin persistencia).
 *
 * - Contadores por ruta HTTP (`METHOD path`): peticiones, errores (>=400) y
 *   latencia (avg + p95 sobre una muestra acotada por ruta).
 * - Buckets por minuto en anillo de 60 (una hora de historia): peticiones y
 *   errores. Se agregan, nada infinito: el anillo se reutiliza y las muestras
 *   de latencia están acotadas (`MAX_SAMPLES_PER_ROUTE`).
 * - WebSocket: connects/disconnects acumulados + pico histórico de conexiones
 *   simultáneas (`peakConnections`). El "actual" en vivo lo expone el dueño
 *   del estado (`activeUsers.size`); aquí se guarda el pico y los totales.
 * - Sistema: uptime (s), CPU/RAM vía `node:os` + `process`, todo tras
 *   try/catch → `null` si no disponible (nunca revienta).
 * - `metricsMiddleware`: mide duración real (evento `finish`) y cuenta
 *   errores por status. EXCLUYE `/api/health` (probes de infra: Render lo
 *   pega constantemente y contaminaría) y `/api/status/stream` (SSE de larga
 *   duración distorsionaría latencia y conteos). `/api/status` (polling del
 *   frontend) SÍ se cuenta: es tráfico real y su volumen interesa.
 * - El mapa de rutas está acotado (`MAX_ROUTES`): el exceso agrega en la
 *   clave `OTHER` (evita crecimiento infinito con paths variables).
 */

import os from 'node:os';
import type { NextFunction, Request, Response } from 'express';

/** Rutas excluidas del cómputo (ver cabecera para el porqué). */
export const METRICS_EXCLUDED_PATHS = ['/api/health', '/api/status/stream'] as const;

/** Minutos de historia en el anillo. */
export const METRICS_RING_MINUTES = 60;
/** Muestras de latencia retenidas por ruta (p95 aproximado y acotado). */
export const MAX_SAMPLES_PER_ROUTE = 240;
/** Claves de ruta distintas retenidas; el resto agrega en `OTHER`. */
export const MAX_ROUTES = 200;
export const OTHER_ROUTE_KEY = 'OTHER';

interface RouteStats {
  count: number;
  errors: number;
  totalMs: number;
  samples: number[];
}

interface MinuteBucket {
  /** Minuto época (ms truncados al minuto) que ocupa este slot; -1 = vacío. */
  minuteStart: number;
  requests: number;
  errors: number;
}

interface MetricsState {
  routes: Map<string, RouteStats>;
  buckets: MinuteBucket[];
  wsConnects: number;
  wsDisconnects: number;
  peakConnections: number;
  activeRooms: number;
}

const startTime = Date.now();

function emptyBuckets(): MinuteBucket[] {
  return Array.from({ length: METRICS_RING_MINUTES }, () => ({
    minuteStart: -1,
    requests: 0,
    errors: 0,
  }));
}

const state: MetricsState = {
  routes: new Map(),
  buckets: emptyBuckets(),
  wsConnects: 0,
  wsDisconnects: 0,
  peakConnections: 0,
  activeRooms: 0,
};

/** Solo tests: devuelve todo a cero (contadores, anillo, pico, muestras). */
export function resetMetrics(): void {
  state.routes.clear();
  state.buckets = emptyBuckets();
  state.wsConnects = 0;
  state.wsDisconnects = 0;
  state.peakConnections = 0;
  state.activeRooms = 0;
}

function minuteStartOf(now: number): number {
  return now - (now % 60_000);
}

function bucketFor(now: number): MinuteBucket {
  const minuteStart = minuteStartOf(now);
  const slot = state.buckets[Math.floor(minuteStart / 60_000) % METRICS_RING_MINUTES];
  if (slot.minuteStart !== minuteStart) {
    slot.minuteStart = minuteStart;
    slot.requests = 0;
    slot.errors = 0;
  }
  return slot;
}

function statsFor(key: string): RouteStats {
  const existing = state.routes.get(key);
  if (existing) return existing;
  if (state.routes.size >= MAX_ROUTES) {
    let other = state.routes.get(OTHER_ROUTE_KEY);
    if (!other) {
      other = { count: 0, errors: 0, totalMs: 0, samples: [] };
      state.routes.set(OTHER_ROUTE_KEY, other);
    }
    return other;
  }
  const stats: RouteStats = { count: 0, errors: 0, totalMs: 0, samples: [] };
  state.routes.set(key, stats);
  return stats;
}

export function isMetricsExcluded(reqPath: string): boolean {
  return (METRICS_EXCLUDED_PATHS as readonly string[]).includes(reqPath);
}

/** Registra una petición HTTP ya finalizada (el middleware lo llama en `finish`). */
export function recordHttpRequest(routeKey: string, durationMs: number, statusCode: number): void {
  const now = Date.now();
  const failed = statusCode >= 400;
  const stats = statsFor(routeKey);
  stats.count += 1;
  stats.totalMs += durationMs;
  if (failed) stats.errors += 1;
  stats.samples.push(durationMs);
  if (stats.samples.length > MAX_SAMPLES_PER_ROUTE) stats.samples.shift();
  const bucket = bucketFor(now);
  bucket.requests += 1;
  if (failed) bucket.errors += 1;
}

/**
 * Middleware Express: cronometra cada request y lo agrega al finalizar.
 * Excluye `METRICS_EXCLUDED_PATHS` (pasa de largo con `next()`).
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isMetricsExcluded(req.path)) {
    next();
    return;
  }
  const started = Date.now();
  const routeKey = `${req.method} ${req.path}`;
  res.on('finish', () => {
    try {
      recordHttpRequest(routeKey, Date.now() - started, res.statusCode);
    } catch {
      // Las métricas jamás rompen una petición real.
    }
  });
  next();
}

/** Llamar en cada `io.on('connection')`. `currentConnections` = total en vivo. */
export function recordWsConnect(currentConnections: number): void {
  state.wsConnects += 1;
  updatePeakConnections(currentConnections);
}

/** Actualiza solo el pico (sin contar conexión): para `activeUsers.size`. */
export function updatePeakConnections(current: number): void {
  if (current > state.peakConnections) state.peakConnections = current;
}

/** Llamar en cada `disconnect`. */
export function recordWsDisconnect(): void {
  state.wsDisconnects += 1;
}

/** Los endpoints de estado actualizan el gauge tras contar salas vivas. */
export function setActiveRooms(count: number): void {
  state.activeRooms = count;
}

export interface SystemMetrics {
  uptimeSec: number;
  cpuLoad1m: number | null;
  totalMemMb: number | null;
  freeMemMb: number | null;
  heapUsedMb: number | null;
  heapTotalMb: number | null;
}

/** CPU/RAM: `node:os` + `process` tras try/catch → `null` si no disponible. */
export function getSystemMetrics(): SystemMetrics {
  const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
  const sys: SystemMetrics = {
    uptimeSec,
    cpuLoad1m: null,
    totalMemMb: null,
    freeMemMb: null,
    heapUsedMb: null,
    heapTotalMb: null,
  };
  try {
    const load = os.loadavg();
    if (Array.isArray(load) && typeof load[0] === 'number') sys.cpuLoad1m = load[0];
  } catch { /* → null */ }
  try {
    sys.totalMemMb = Math.round(os.totalmem() / 1_048_576);
    sys.freeMemMb = Math.round(os.freemem() / 1_048_576);
  } catch { /* → null */ }
  try {
    const mem = process.memoryUsage();
    sys.heapUsedMb = Math.round(mem.heapUsed / 1_048_576);
    sys.heapTotalMb = Math.round(mem.heapTotal / 1_048_576);
  } catch { /* → null */ }
  return sys;
}

export interface RouteAggregate {
  route: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/** Agregados por ruta (avg/p95 calculados sobre la muestra acotada). */
export function getRouteAggregates(): RouteAggregate[] {
  const out: RouteAggregate[] = [];
  for (const [route, s] of state.routes) {
    const sorted = [...s.samples].sort((a, b) => a - b);
    out.push({
      route,
      count: s.count,
      errors: s.errors,
      avgMs: s.count > 0 ? Math.round((s.totalMs / s.count) * 100) / 100 : 0,
      p95Ms: Math.round(percentile(sorted, 0.95) * 100) / 100,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

export interface MinuteBucketSnapshot {
  minuteStart: string | null;
  requests: number;
  errors: number;
}

/** Anillo de 60 minutos: solo slots con datos (orden cronológico). */
export function getMinuteBuckets(): MinuteBucketSnapshot[] {
  return state.buckets
    .filter((b) => b.minuteStart !== -1)
    .sort((a, b) => a.minuteStart - b.minuteStart)
    .map((b) => ({
      minuteStart: new Date(b.minuteStart).toISOString(),
      requests: b.requests,
      errors: b.errors,
    }));
}

export interface MetricsSnapshot {
  http: { totalRequests: number; totalErrors: number; routes: RouteAggregate[] };
  perMinute: MinuteBucketSnapshot[];
  ws: { connects: number; disconnects: number; peakConnections: number };
  rooms: { active: number };
  system: SystemMetrics;
}

/** Foto completa interna (para futuros `/api/admin/*`; NO pública). */
export function getMetricsSnapshot(): MetricsSnapshot {
  let totalRequests = 0;
  let totalErrors = 0;
  for (const s of state.routes.values()) {
    totalRequests += s.count;
    totalErrors += s.errors;
  }
  return {
    http: { totalRequests, totalErrors, routes: getRouteAggregates() },
    perMinute: getMinuteBuckets(),
    ws: {
      connects: state.wsConnects,
      disconnects: state.wsDisconnects,
      peakConnections: state.peakConnections,
    },
    rooms: { active: state.activeRooms },
    system: getSystemMetrics(),
  };
}
