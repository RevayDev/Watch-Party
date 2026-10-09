#!/usr/bin/env node
/**
 * SUBAGENTE 4 — Orquestador local reproducible de pruebas de carga.
 *
 * Levanta el backend en un proceso hijo (tsx, puerto 4100, store en memoria
 * salvo MONGODB_URI explícito), espera /api/health y ejecuta:
 *   1. rampa HTTP progresiva (10→25→50→100),
 *   2. escenarios de salas 1×10 / 5×10 / 10×10,
 * primero con DEMO_MODE=true (cuota demo real: topes 5 salas / 5 usuarios)
 * y luego con DEMO_MODE=false (techo sin cuota: mide Node+Socket.IO).
 *
 * Uso:
 *   node tests/load/run-local.mjs [--port 4100] [--phase free|non-demo|all]
 *
 * Requiere: dependencias instaladas (npm install), puerto libre.
 * NO apunta a ningún entorno remoto: siempre 127.0.0.1.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForHealth } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.join(__dirname, '..', '..');

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs();
const PORT = args.port || '4100';
const PHASE = args.phase || 'all';
const BASE = `http://127.0.0.1:${PORT}`;

function runServer(extraEnv) {
  // node + tsx directo (en Windows `npx` es un shim .ps1/.cmd que spawn no
  // resuelve sin shell:true; así funciona en todas las plataformas).
  const tsxCli = path.join(BACKEND_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(process.execPath, [tsxCli, 'src/server.ts'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[srv] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[srv:err] ${d}`));
  return child;
}

function runScript(name, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [`tests/load/${name}`, `--base=${BASE}`, ...scriptArgs], {
      cwd: BACKEND_DIR,
      env: { ...process.env, LOAD_BASE_URL: BASE },
      stdio: 'inherit',
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${name} salió con código ${code}`))));
  });
}

async function phase(name, extraEnv) {
  console.log(`\n########## FASE ${name} ##########`);
  const srv = runServer(extraEnv);
  try {
    await waitForHealth(BASE, { timeoutMs: 45000 });
    // Orden: escenarios de salas PRIMERO (limitador por IP frío → los 429 que
    // salgan son cuota demo real, no artefacto), y la rampa HTTP DESPUÉS
    // (satura el globalLimiter single-IP por diseño; ver LOAD_TESTING.md).
    await runScript('rooms-scenarios.mjs', ['--scenario=all', '--observe=20']);
    console.log('\nEnfriando ventanas de rate-limit antes de la rampa HTTP…');
    await new Promise((r) => setTimeout(r, 70000));
    await runScript('ramp.mjs', ['--steps=10,25,50,100', '--secs=15']);
  } finally {
    srv.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 2000));
    if (!srv.killed) srv.kill('SIGKILL');
  }
}

if (PHASE === 'free' || PHASE === 'all') {
  // eslint-disable-next-line no-await-in-loop
  await phase('DEMO (DEMO_MODE=true: topes 5 salas / 5 usuarios)', { DEMO_MODE: 'true' });
}
if (PHASE === 'non-demo' || PHASE === 'all') {
  // eslint-disable-next-line no-await-in-loop
  await phase('TECHO non-demo (DEMO_MODE=false, sin cuota)', {
    DEMO_MODE: 'false',
  });
}
console.log('\nOrquestador terminado. Copia las tablas de arriba al reporte.');
