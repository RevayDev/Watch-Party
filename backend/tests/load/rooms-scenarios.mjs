#!/usr/bin/env node
/**
 * SUBAGENTE 4 — Escenarios de salas × usuarios (REST + WebSocket real).
 *
 * Escenarios: 1×10, 5×10 y 10×10 (salas × usuarios/sala), cada uno con:
 *  - creación de R salas vía POST /api/rooms (cuenta 429 de cuota demo),
 *  - join de U usuarios/sala vía POST /api/rooms/:id/join,
 *  - N sockets socket.io-client por sala: join-room + heartbeat cada 5 s +
 *    3 × sync-video, ventana de observación 20 s,
 *  - medición: joins OK/429, WS conectados, errores de conexión, desconexiones
 *    observadas, latencia de join (p50/p95 medidas en cliente),
 *  - limpieza: leave-room + DELETE de cada sala (con su hostSecret).
 *
 * DEMO vs NON-DEMO: con DEMO_MODE=true el servidor impone 5 salas y
 * 5 usuarios/sala — los escenarios ×10 registrarán 429/room-full
 * ESPERADOS (no es un fallo: es la cuota demo medida). Con DEMO_MODE=false
 * NO hay límite de usuarios, así que 10×10 mide Node+Socket.IO puro.
 *
 * Uso:
 *   node tests/load/rooms-scenarios.mjs [--base URL] [--scenario 1x10] [--observe 20]
 *   node tests/load/rooms-scenarios.mjs --scenario all
 */
import { io as ioClient } from 'socket.io-client';
import { DEFAULT_BASE_URL, fetchJson, waitForHealth, adminMetrics, printRow, classify429, cooldownLimiter } from './lib.mjs';

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a === 'all') out.scenario = 'all';
  }
  return out;
}

const args = parseArgs();
const BASE = args.base || DEFAULT_BASE_URL;
const OBSERVE_SECS = Number(args.observe || 20);
const COOLDOWN_MS = Number(args['cooldown-ms'] || 65000);
const SCENARIOS = args.scenario === 'all' || !args.scenario
  ? ['1x10', '5x10', '10x10']
  : [args.scenario];

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Math.round(sorted[idx] * 100) / 100;
}

async function createRoom(hostName) {
  const t0 = Date.now();
  const { status, json } = await fetchJson(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostName }),
  });
  return { status, json, ms: Date.now() - t0 };
}

/**
 * Reintento UNA vez tras enfriar la ventana (60 s) cuando el 429 es del
 * limitador por IP (artefacto single-IP del banco de carga). Los 429 de
 * cuota demo NO se reintentan: son el resultado a medir.
 */
async function withLimiterRetry(fn, label) {
  let r = await fn();
  if (r.status === 429 && classify429(r.json, '') === 'rate-limit') {
    console.log(`  ${label}: 429 del limitador IP (no de cuota) → cooldown + 1 reintento`);
    await cooldownLimiter(COOLDOWN_MS);
    r = await fn();
  }
  return r;
}

async function joinRoom(roomId, userName, userId) {
  const t0 = Date.now();
  const { status, json } = await fetchJson(`${BASE}/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify({ userName, userId }),
  });
  return { status, json, ms: Date.now() - t0 };
}

function connectUserSocket(roomId, userName, userId, stats) {
  return new Promise((resolve) => {
    const socket = ioClient(BASE, { transports: ['websocket'], reconnection: false, timeout: 8000 });
    const timer = setTimeout(() => {
      stats.wsErrors += 1;
      try { socket.close(); } catch { /* noop */ }
      resolve(null);
    }, 10000);
    socket.on('connect', () => {
      clearTimeout(timer);
      stats.wsConnected += 1;
      socket.emit('join-room', { roomId, userName, userId });
      const hb = setInterval(() => {
        socket.emit('playback-heartbeat', { roomId, currentTime: Math.random() * 100, isPlaying: true });
      }, 5000);
      // Tráfico de sincronización típico: 3 seeks/plays por usuario.
      let n = 0;
      const sync = setInterval(() => {
        n += 1;
        socket.emit('sync-video', { roomId, action: n % 2 ? 'play' : 'pause', currentTime: n * 10 });
        if (n >= 3) clearInterval(sync);
      }, 1500);
      socket.on('join-rejected', () => { stats.wsRejected += 1; });
      socket.on('disconnect', (reason) => {
        stats.wsDisconnects += 1;
        stats.wsDisconnectReasons[reason] = (stats.wsDisconnectReasons[reason] || 0) + 1;
        clearInterval(hb);
        clearInterval(sync);
      });
      resolve(socket);
    });
    socket.on('connect_error', () => {
      clearTimeout(timer);
      stats.wsErrors += 1;
      resolve(null);
    });
  });
}

async function runScenario(spec) {
  const [rStr, uStr] = spec.split('x');
  const R = Number(rStr);
  const U = Number(uStr);
  console.log(`\n=== Escenario ${spec}: ${R} sala(s) × ${U} usuario(s) ===`);
  const metricsBefore = await adminMetrics(BASE);

  const stats = {
    spec, rooms: R, usersPerRoom: U,
    roomsCreated: 0, rooms429Demo: 0, rooms429Limit: 0,
    joinsOk: 0, joins429Demo: 0, joins429Limit: 0, joinsOther: 0, joinMs: [],
    wsConnected: 0, wsErrors: 0, wsRejected: 0, wsDisconnects: 0, wsDisconnectReasons: {},
  };
  const rooms = []; // { roomId, hostSecret, sockets[] }

  for (let r = 0; r < R; r++) {
    const hostName = `LoadHost-${spec}-${r}`;
    // eslint-disable-next-line no-await-in-loop
    const created = await withLimiterRetry(() => createRoom(hostName), `create sala ${r}`);
    if (created.status === 201) {
      stats.roomsCreated += 1;
      rooms.push({ roomId: created.json.roomId, hostSecret: created.json.hostSecret, sockets: [] });
    } else if (created.status === 429) {
      if (classify429(created.json, '') === 'demo-quota') stats.rooms429Demo += 1;
      else stats.rooms429Limit += 1;
    } else {
      console.log(`  create sala ${r}: HTTP ${created.status} (inesperado)`);
    }
  }
  console.log(`  salas creadas: ${stats.roomsCreated}/${R} (429 demo: ${stats.rooms429Demo}, 429 limiter: ${stats.rooms429Limit})`);

  for (const room of rooms) {
    const perRoomSockets = [];
    for (let u = 0; u < U; u++) {
      const name = `LoadUser-${u}`;
      const uid = `load-${spec}-${room.roomId}-${u}`;
      // eslint-disable-next-line no-await-in-loop
      const j = await withLimiterRetry(() => joinRoom(room.roomId, name, uid), `join ${name}`);
      if (j.status === 200) {
        stats.joinsOk += 1;
        stats.joinMs.push(j.ms);
        perRoomSockets.push({ name, uid });
      } else if (j.status === 429) {
        if (classify429(j.json, '') === 'demo-quota') stats.joins429Demo += 1;
        else stats.joins429Limit += 1;
      } else {
        stats.joinsOther += 1;
      }
    }
    // Conecta por WS solo a los que entraron por REST (comportamiento realista).
    for (const s of perRoomSockets) {
      const sock = await connectUserSocket(room.roomId, s.name, s.uid, stats);
      if (sock) room.sockets.push(sock);
    }
  }
  stats.joinMs.sort((a, b) => a - b);
  console.log(`  joins: ok=${stats.joinsOk} 429demo=${stats.joins429Demo} 429limit=${stats.joins429Limit} otros=${stats.joinsOther} ` +
    `p50=${percentile(stats.joinMs, 0.5)}ms p95=${percentile(stats.joinMs, 0.95)}ms`);
  console.log(`  WS: conectados=${stats.wsConnected} errores=${stats.wsErrors} ` +
    `rechazados=${stats.wsRejected} desconexiones(ventana)=${stats.wsDisconnects}`);

  console.log(`  observando ${OBSERVE_SECS}s con tráfico de sync/heartbeat…`);
  await new Promise((r) => setTimeout(r, OBSERVE_SECS * 1000));
  const wsDisconnectsDuringObserve = stats.wsDisconnects;

  const metricsAfter = await adminMetrics(BASE);
  const health = await fetchJson(`${BASE}/api/health`).catch(() => null);
  console.log(`  tras ventana: WS desconexiones espontáneas=${wsDisconnectsDuringObserve} ` +
    `peakServidor=${metricsAfter?.traffic?.ws?.peakConnections ?? 'n/a'} ` +
    `conexionesVivas=${health?.json?.connections ?? 'n/a'} ` +
    `heap=${metricsAfter?.system?.heapUsedMb ?? 'n/a'}MB`);

  // Limpieza: cerrar sockets y borrar salas (libera cuota demo).
  for (const room of rooms) {
    for (const s of room.sockets) {
      try { s.emit('leave-room', { roomId: room.roomId, userName: 'x' }); s.close(); } catch { /* noop */ }
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
  let roomsDeleted = 0;
  for (const room of rooms) {
    const { status } = await fetchJson(`${BASE}/api/rooms/${room.roomId}`, {
      method: 'DELETE',
      headers: { 'x-host-secret': room.hostSecret },
    });
    if (status === 200) roomsDeleted += 1;
  }
  console.log(`  limpieza: sockets cerrados, salas borradas ${roomsDeleted}/${rooms.length}`);

  return {
    ...stats,
    wsDisconnectsDuringObserve,
    wsDisconnectsOnCleanup: stats.wsDisconnects - wsDisconnectsDuringObserve,
    joinP50ms: percentile(stats.joinMs, 0.5),
    joinP95ms: percentile(stats.joinMs, 0.95),
    heapBeforeMb: metricsBefore?.system?.heapUsedMb ?? null,
    heapAfterMb: metricsAfter?.system?.heapUsedMb ?? null,
    wsPeak: metricsAfter?.traffic?.ws?.peakConnections ?? null,
    serverConnectionsAfter: health?.json?.connections ?? null,
    roomsDeleted,
  };
}

console.log(`Escenarios de salas contra ${BASE} (observación ${OBSERVE_SECS}s c/u)`);
await waitForHealth(BASE);
console.log('Servidor en pie. Inicio.');

const widths = [8, 7, 7, 7, 7, 7, 8, 8, 10, 10, 10, 12];
printRow(['escen', 'salas', '429demo', 'joinOK', 'j429demo', 'j429lim', 'wsConn', 'wsErr', 'wsDisc', 'joinP50', 'joinP95', 'heap±MB'], widths);
const all = [];
for (const spec of SCENARIOS) {
  // eslint-disable-next-line no-await-in-loop
  const row = await runScenario(spec);
  all.push(row);
  printRow(
    [row.spec, `${row.roomsCreated}/${row.rooms}`, row.rooms429Demo, row.joinsOk, row.joins429Demo, row.joins429Limit,
      row.wsConnected, row.wsErrors, row.wsDisconnectsDuringObserve,
      row.joinP50ms ?? 'n/a', row.joinP95ms ?? 'n/a',
      row.heapBeforeMb !== null ? `${row.heapBeforeMb}→${row.heapAfterMb ?? '?'}` : 'n/a'],
    widths
  );
  // Respiro entre escenarios (GC + cierre de sockets pendientes).
  // eslint-disable-next-line no-await-in-loop
  await new Promise((r) => setTimeout(r, 3000));
}

console.log('\nJSON resumen:');
console.log(JSON.stringify({ base: BASE, observeSecs: OBSERVE_SECS, results: all }, null, 2));
