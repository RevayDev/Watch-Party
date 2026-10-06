/**
 * SUBAGENTE 4 — Utilidades compartidas de los scripts de carga.
 * ESM puro (.mjs): se ejecuta con `node`, sin compilar.
 */
export const DEFAULT_BASE_URL = process.env.LOAD_BASE_URL || 'http://127.0.0.1:4100';

export async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text: text.slice(0, 500) };
}

export async function waitForHealth(baseUrl, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      const { status, json } = await fetchJson(`${baseUrl}/api/health`);
      if (status === 200 && json && (json.status === 'ok' || json.status === 'degraded')) return json;
    } catch {
      // reintenta hasta el timeout
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`El servidor no respondió en ${baseUrl}/api/health tras ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Foto del servidor vía endpoint admin (requiere LOAD_ADMIN_TOKEN). Null si no hay token. */
export async function adminMetrics(baseUrl) {
  const token = process.env.LOAD_ADMIN_TOKEN;
  if (!token) return null;
  try {
    const { status, json } = await fetchJson(`${baseUrl}/api/admin/metrics`, {
      headers: { 'x-admin-token': token },
    });
    if (status !== 200) return null;
    return json;
  } catch {
    return null;
  }
}

export function fmtMb(v) {
  return v === null || v === undefined ? 'n/a' : `${v}MB`;
}

/** p95 aproximado desde los percentiles que expone autocannon (p90/p97_5). */
export function approxP95(lat) {
  if (!lat) return null;
  const p90 = Number(lat.p90 ?? NaN);
  const p975 = Number(lat.p97_5 ?? NaN);
  if (Number.isFinite(p90) && Number.isFinite(p975)) return Math.round(((p90 + p975) / 2) * 100) / 100;
  if (Number.isFinite(p975)) return p975;
  return Number.isFinite(p90) ? p90 : null;
}

export function errorRate(result) {
  const total = Number(result?.requests?.total ?? 0);
  if (total <= 0) return 0;
  const bad = Number(result?.errors ?? 0) + Number(result?.timeouts ?? 0) + Number(result?.mismatches ?? 0);
  // autocannon también cuenta non-2xx en `requests.total`; los 429/4xx de cuota
  // demo se miden aparte en rooms-scenarios (aquí solo se pega a endpoints sin cuota).
  return bad / total;
}

/**
 * Clasifica un 429 por su mensaje (los cuerpos difieren):
 * - 'demo-quota' → cuota demo real (topes 5 salas / 5 usuarios, mensajes exactos
 *   de src/config/demo-mode.ts).
 * - 'rate-limit' → limitadores por IP (global 600/min, crear 15/min, unirse
 *   30/min; src/middleware/rate-limit.middleware.ts). Artefacto de que TODO el
 *   tráfico de carga sale de una sola IP: NO es capacidad del servidor.
 * - 'other' → resto.
 */
export function classify429(json, text = '') {
  const msg = String(json?.error ?? text ?? '');
  // OJO el orden: el mensaje de cuota demo de salas también contiene la
  // palabra "límite" ('La demo ha alcanzado el límite de 5 salas…'), así que
  // la cuota demo se comprueba ANTES que el limitador IP.
  if (/demo|está llena/i.test(msg)) return 'demo-quota';
  if (/límite|demasiadas solicitudes/i.test(msg)) return 'rate-limit';
  return 'other';
}

/** Pausa de enfriamiento para ventanas de rate-limit (60 s + margen). */
export async function cooldownLimiter(ms = 65000) {
  console.log(`  (enfriando rate-limit ${Math.round(ms / 1000)}s…)`);
  await new Promise((r) => setTimeout(r, ms));
}

export function printRow(cols, widths) {
  console.log(cols.map((c, i) => String(c).padEnd(widths[i])).join(' | '));
}
