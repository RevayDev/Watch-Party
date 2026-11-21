import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function inspectService(port, kind) {
  const listening = await new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (value) => { socket.destroy(); done(value); };
    socket.setTimeout(1000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
  if (!listening) return 'free';
  try {
    const response = await fetch(`http://127.0.0.1:${port}${kind === 'backend' ? '/api/health' : '/'}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return 'occupied';
    if (kind === 'backend') {
      const body = await response.json();
      return body.ok === true && typeof body.uptimeSec === 'number' ? 'running' : 'occupied';
    }
    const html = await response.text();
    return html.includes('/@vite/client') && /Watch Party/i.test(html) ? 'running' : 'occupied';
  } catch { return 'occupied'; }
}

async function main() {
  const services = [
    { kind: 'backend', port: Number(process.env.PORT || 4000), command: 'npm run dev:backend' },
    { kind: 'frontend', port: 5173, command: 'npm run dev:frontend -- --strictPort' },
  ];
  const pending = [];
  for (const service of services) {
    const state = await inspectService(service.port, service.kind);
    if (state === 'occupied') throw new Error(`El puerto ${service.port} está ocupado por otro servicio. Ciérralo antes de iniciar Watch Party. No se ha detenido ningún proceso.`);
    if (state === 'running') console.log(`${service.kind} ya está activo: http://localhost:${service.port} (se reutiliza)`);
    else pending.push(service);
  }
  console.log('Abre http://localhost:5173 en este equipo. En otros dispositivos, usa la web con HTTPS para micrófono y cámara.');
  if (!pending.length) return;
  const child = spawn(process.execPath, [
    resolve(root, 'node_modules/concurrently/dist/bin/index.js'), '--kill-others', '-n', pending.map((service) => service.kind).join(','),
    ...(process.platform === 'win32' ? ['--shell', process.env.ComSpec || resolve(process.env.SystemRoot || 'C:/Windows', 'System32/cmd.exe')] : []),
    ...pending.map((service) => service.command),
  ], { cwd: root, stdio: 'inherit' });
  child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code) => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
