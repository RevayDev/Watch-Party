#!/usr/bin/env node
/**
 * SUBAGENTE 4 — Rampa progresiva de usuarios virtuales (HTTP).
 *
 * 10 → 25 → 50 → 100 conexiones concurrentes, 15 s por escalón, contra un
 * servidor LOCAL (por defecto http://127.0.0.1:4100; ver LOAD_TESTING.md).
 * NUNCA contra producción sin aviso explícito.
 *
 * Criterio de parada ("detener antes de tumbar"): se interrumpe la rampa si
 *   - tasa de errores+timeouts > 5 %, o
 *   - p99 > 5000 ms, o
 *   - /api/health deja de responder.
 * El último escalón sano es el resultado (no se insiste hasta caer el server).
 *
 * Métricas por escalón: conexiones, duración, req/s, latencia p50/p95≈/p99,
 * errores, timeouts + foto del servidor (heap MB, load1m, ws peak) vía
 * /api/admin/metrics cuando LOAD_ADMIN_TOKEN está definido.
 *
 * Uso:
 *   node tests/load/ramp.mjs [--base http://127.0.0.1:4100] [--steps 10,25,50,100] [--secs 15]
 */
import autocannon from 'autocannon';
import {
  DEFAULT_BASE_URL,
  waitForHealth,
  adminMetrics,
  approxP95,
  errorRate,
  fmtMb,
  printRow,
} from './lib.mjs';

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function runAutocannon({ url, connections, duration, requests }) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({ url, connections, duration, requests }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    // Sin tablas propias de autocannon: imprimimos filas compactas abajo.
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

const args = parseArgs();
const BASE = args.base || DEFAULT_BASE_URL;
const STEPS = (args.steps || '10,25,50,100').split(',').map(Number).filter((n) => n > 0);
const SECS = Number(args.secs || 15);

const REQUESTS = [
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/status' },
  { method: 'GET', path: '/api/demo/availability' },
];

const STOP_ERROR_RATE = 0.05;
const STOP_P99_MS = 5000;

console.log(`Rampa HTTP contra ${BASE} — escalones [${STEPS.join(', ')}] × ${SECS}s`);
await waitForHealth(BASE);
console.log('Servidor en pie (/api/health OK). Inicio de rampa.\n');

const widths = [8, 8, 10, 10, 10, 10, 10, 9, 10, 10, 10];
printRow(['conns', 'req/s', 'p50(ms)', 'p95≈(ms)', 'p99(ms)', 'errores', 'timeouts', 'errRate', 'non2xx', 'heapUsed', 'wsPeak'], widths);

const rows = [];
let stoppedEarly = false;
let stopReason = '';

for (const conns of STEPS) {
  const before = await adminMetrics(BASE);
  let result;
  try {
    result = await runAutocannon({ url: BASE, connections: conns, duration: SECS, requests: REQUESTS });
  } catch (err) {
    stoppedEarly = true;
    stopReason = `autocannon falló en ${conns} conns: ${err?.message || err}`;
    break;
  }
  const after = await adminMetrics(BASE);
  const rate = errorRate(result);
  const p95 = approxP95(result.latency);
  const row = {
    conns,
    rps: Math.round((result.requests?.average ?? 0) * 100) / 100,
    p50: result.latency?.p50 ?? null,
    p95,
    p99: result.latency?.p99 ?? null,
    errors: result.errors ?? 0,
    timeouts: result.timeouts ?? 0,
    non2xx: result.non2xx ?? 0,
    status4xx: result['4xx'] ?? 0,
    status5xx: result['5xx'] ?? 0,
    errRate: Math.round(rate * 10000) / 100,
    heapUsedMb: after?.system?.heapUsedMb ?? before?.system?.heapUsedMb ?? null,
    wsPeak: after?.traffic?.ws?.peakConnections ?? after?.sockets?.online ?? null,
    total: result.requests?.total ?? 0,
  };
  rows.push(row);
  printRow(
    [row.conns, row.rps, row.p50, row.p95, row.p99, row.errors, row.timeouts, `${row.errRate}%`, row.non2xx, fmtMb(row.heapUsedMb), row.wsPeak ?? 'n/a'],
    widths
  );

  if (rate > STOP_ERROR_RATE) {
    stoppedEarly = true;
    stopReason = `tasa de error ${(rate * 100).toFixed(2)}% > 5% en ${conns} conns — rampa detenida antes de tumbar el servidor`;
    break;
  }
  if (Number(result.latency?.p99 ?? 0) > STOP_P99_MS) {
    stoppedEarly = true;
    stopReason = `p99 ${result.latency.p99}ms > 5000ms en ${conns} conns — rampa detenida`;
    break;
  }
  try {
    await waitForHealth(BASE, { timeoutMs: 8000, intervalMs: 500 });
  } catch {
    stoppedEarly = true;
    stopReason = `/api/health dejó de responder tras el escalón de ${conns} conns — rampa detenida`;
    break;
  }
  // Respiro entre escalones para no acumular GC/backpressure del propio cliente.
  await new Promise((r) => setTimeout(r, 2000));
}

console.log('');
console.log('Nota: non2xx aquí son casi todo 429 del globalLimiter (600 req/min por IP, src/middleware/rate-limit.middleware.ts:71-75).');
console.log('Todo el tráfico sale de UNA IP (este cliente), así que el limitador recorta antes que el hardware: mide el techo anti-abuso, no el de CPU.');
if (stoppedEarly) {
  console.log(`⚠️  RAMPA DETENIDA: ${stopReason}`);
} else {
  console.log('✅ Rampa completa sin trips: el servidor local aguantó todos los escalones.');
}
const lastGood = rows.length > 0 ? rows[stoppedEarly && rows.length > 1 ? rows.length - 2 : rows.length - 1] : null;
if (stoppedEarly && lastGood) {
  console.log(`Último escalón sano: ${lastGood.conns} conns (${lastGood.rps} req/s, p50=${lastGood.p50}ms, p95≈${lastGood.p95}ms).`);
}
console.log(JSON.stringify({ base: BASE, steps: STEPS, secs: SECS, stoppedEarly, stopReason, rows }, null, 2));
