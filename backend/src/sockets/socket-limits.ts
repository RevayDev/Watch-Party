// Límites en memoria por socket (sin librerías nuevas):
// - `checkSocketRateLimit`: ventana deslizante por (socket, evento).
// - `checkSocketThrottle`: intervalo mínimo entre eventos del mismo socket.
// - `isDuplicateSocketEvent`: duplicados consecutivos idénticos del mismo
//   socket dentro de una ventana corta (se procesa uno).
// Todo el estado es efímero: se limpia con `clearSocketLimits(socketId)` al
// desconectar y expira de forma perezosa en cada acceso.

interface WindowRecord {
  count: number;
  resetTime: number;
}

interface DedupRecord {
  fingerprint: string;
  at: number;
}

// Clave: `${socketId}:${key}`. Los mapas conservan orden de inserción para
// podar los más antiguos si crecen sin control.
const rateWindows = new Map<string, WindowRecord>();
const throttles = new Map<string, number>();
const dedups = new Map<string, DedupRecord>();

const MAX_TRACKED_KEYS = 5000;

function pruneIfOversized(map: Map<string, unknown>): void {
  if (map.size <= MAX_TRACKED_KEYS) return;
  const excess = map.size - MAX_TRACKED_KEYS;
  let removed = 0;
  for (const key of map.keys()) {
    map.delete(key);
    removed += 1;
    if (removed >= excess) break;
  }
}

/**
 * Ventana deslizante por socket: permite hasta `max` eventos por `windowMs`.
 * Devuelve true si el evento puede procesarse (y lo cuenta), false si excede
 * (el excedente debe ignorarse en silencio, sin cambiar eventos existentes).
 */
export function checkSocketRateLimit(
  socketId: string,
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now()
): boolean {
  const mapKey = `${socketId}:${key}`;
  const record = rateWindows.get(mapKey);

  if (!record || now >= record.resetTime) {
    rateWindows.set(mapKey, { count: 1, resetTime: now + windowMs });
    pruneIfOversized(rateWindows);
    return true;
  }

  record.count += 1;
  return record.count <= max;
}

/**
 * Throttle por socket: exige al menos `minIntervalMs` entre eventos
 * procesados (p. ej. playback-heartbeat mínimo 1/2s; el excedente se ignora).
 * Devuelve true si el evento puede procesarse, false si debe ignorarse.
 */
export function checkSocketThrottle(
  socketId: string,
  minIntervalMs: number,
  now: number = Date.now()
): boolean {
  const last = throttles.get(socketId);
  if (last !== undefined && now - last < minIntervalMs) return false;
  throttles.set(socketId, now);
  pruneIfOversized(throttles);
  return true;
}

/**
 * Dedup de eventos consecutivos idénticos del mismo socket: si llega un
 * evento con la misma huella que el anterior en menos de `windowMs`
 * (defecto 500ms), devuelve true (duplicado: procesar solo uno).
 * Una huella distinta resetea la comparación.
 */
export function isDuplicateSocketEvent(
  socketId: string,
  event: string,
  fingerprint: string,
  windowMs = 500,
  now: number = Date.now()
): boolean {
  const mapKey = `${socketId}:${event}`;
  const prev = dedups.get(mapKey);
  if (prev && prev.fingerprint === fingerprint && now - prev.at < windowMs) {
    return true;
  }
  dedups.set(mapKey, { fingerprint, at: now });
  pruneIfOversized(dedups);
  return false;
}

/** Libera todo el estado de un socket (llamar al desconectar). */
export function clearSocketLimits(socketId: string): void {
  const prefix = `${socketId}:`;
  for (const key of rateWindows.keys()) {
    if (key.startsWith(prefix)) rateWindows.delete(key);
  }
  throttles.delete(socketId);
  const dedupPrefix = `${socketId}:`;
  for (const key of dedups.keys()) {
    if (key.startsWith(dedupPrefix)) dedups.delete(key);
  }
}

/** Solo para tests: vacía todo el estado global del módulo. */
export function __resetSocketLimitsForTests(): void {
  rateWindows.clear();
  throttles.clear();
  dedups.clear();
}
