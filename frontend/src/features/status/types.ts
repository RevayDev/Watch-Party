/**
 * Tipos públicos de observabilidad (contrato backend, solo agregados, cero PII).
 * - `GET /api/health` → HealthPayload
 * - `GET /api/status` (+ SSE `/api/status/stream`) → StatusPayload (10 claves exactas)
 */

/** `GET /api/health`: liveness ampliado. `rooms` es null si el conteo falla. */
export interface HealthPayload {
  status: 'ok' | 'degraded';
  service: string;
  /** Uptime en segundos. */
  uptime: number;
  database: 'connected' | 'connecting' | 'disconnected' | 'disconnecting';
  websocket: 'up';
  connections: number;
  rooms: number | null;
  timestamp: string;
}

/**
 * `GET /api/status`: SOLO agregados públicos (sin nombres, emails, IPs,
 * códigos de sala ni pagos). Exactamente 10 claves.
 */
export interface StatusPayload {
  status: 'online' | 'degraded';
  connectedUsers: number;
  peakUsers: number;
  activeRooms: number;
  avgUsersPerRoom: number;
  maxUsersPerRoom: number;
  freeRooms: number;
  premiumRooms: number;
  uptime: number;
  timestamp: string;
}

/** Guarda contra payloads parciales del SSE/polling antes de pintar. */
export function isStatusPayload(value: unknown): value is StatusPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v['status'] === 'online' || v['status'] === 'degraded') &&
    typeof v['connectedUsers'] === 'number' &&
    typeof v['peakUsers'] === 'number' &&
    typeof v['activeRooms'] === 'number' &&
    typeof v['avgUsersPerRoom'] === 'number' &&
    typeof v['maxUsersPerRoom'] === 'number' &&
    typeof v['freeRooms'] === 'number' &&
    typeof v['premiumRooms'] === 'number' &&
    typeof v['uptime'] === 'number' &&
    typeof v['timestamp'] === 'string'
  );
}

/** `3600` → `1 h 00 min`; `90` → `1 min`; `45` → `45 s`. */
export function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}
