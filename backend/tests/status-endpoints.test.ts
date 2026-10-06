import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { getMetricsSnapshot, resetMetrics } from '../src/services/metrics.service.js';

/**
 * SUBAGENTE 1 — contrato HTTP de observabilidad.
 * Sin supertest (no instalado): app real en puerto efímero + fetch global.
 * `activeUsers` se siembra/limpia por test; el conteo de salas es de solo
 * lectura (tolera data/rooms.json local: se asertan relaciones, no ceros).
 */

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetMetrics();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  activeUsers.clear();
});

function seedPresence(): void {
  activeUsers.set('s1', { socketId: 's1', roomId: 'ROOM-A', userName: 'u1', isHost: true });
  activeUsers.set('s2', { socketId: 's2', roomId: 'ROOM-A', userName: 'u2', isHost: false });
  activeUsers.set('s3', { socketId: 's3', roomId: 'ROOM-B', userName: 'u3', isHost: false });
}

describe('GET /api/health (ampliado, retrocompatible)', () => {
  it('conserva status/service/timestamp y añade uptime/database/websocket/connections/rooms', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toMatch(/^(ok|degraded)$/);
    expect(body.service).toBe('watch-party-backend');
    expect(typeof body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(body.timestamp as string))).toBe(false);
    expect(typeof body.uptime).toBe('number');
    expect(body.database).toMatch(/^(connected|connecting|disconnected|disconnecting)$/);
    expect(body.websocket).toBe('up');
    expect(typeof body.connections).toBe('number');
    expect(body.rooms === null || typeof body.rooms === 'number').toBe(true);
  });

  it('refleja la presencia socket en `connections`', async () => {
    seedPresence();
    const body = (await (await fetch(`${baseUrl}/api/health`)).json()) as { connections: number };
    expect(body.connections).toBe(3);
  });
});

describe('GET /api/status (solo agregados públicos)', () => {
  it('payload exacto sin PII y relaciones coherentes', async () => {
    seedPresence();
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(
      [
        'activeRooms',
        'avgUsersPerRoom',
        'connectedUsers',
        'freeRooms',
        'maxUsersPerRoom',
        'peakUsers',
        'premiumRooms',
        'status',
        'timestamp',
        'uptime',
      ].sort()
    );
    expect(body.status).toMatch(/^(online|degraded)$/);
    expect(body.connectedUsers).toBe(3);
    expect(body.peakUsers).toBeGreaterThanOrEqual(3);
    expect(body.maxUsersPerRoom).toBe(2);
    expect(body.avgUsersPerRoom).toBe(1.5);
    expect(body.freeRooms).toBe(body.activeRooms);
    expect(body.premiumRooms).toBe(0);
    expect(typeof body.uptime).toBe('number');

    const raw = JSON.stringify(body).toLowerCase();
    for (const leak of ['u1', 'u2', 'room-a', 'email', '@', '192.168.', 'hostsecret', 'pricecop']) {
      expect(raw.includes(leak)).toBe(false);
    }
  });

  it('sin presencia: ceros coherentes', async () => {
    const body = (await (await fetch(`${baseUrl}/api/status`)).json()) as {
      connectedUsers: number;
      avgUsersPerRoom: number;
      maxUsersPerRoom: number;
    };
    expect(body.connectedUsers).toBe(0);
    expect(body.avgUsersPerRoom).toBe(0);
    expect(body.maxUsersPerRoom).toBe(0);
  });
});

describe('GET /api/status/stream (SSE)', () => {
  it('emite eventos `data:` con el mismo contrato que /api/status', async () => {
    seedPresence();
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/status/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    let text = '';
    const deadline = Date.now() + 5000;
    try {
      while (!text.includes('data: ') && Date.now() < deadline) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        text += new TextDecoder().decode(chunk.value);
      }
    } finally {
      controller.abort();
      try {
        await reader?.cancel();
      } catch { /* cierre best-effort */ }
    }
    expect(text.startsWith('data: ')).toBe(true);
    const payload = JSON.parse(text.replace(/^data: /, '').trim()) as Record<string, unknown>;
    expect(payload.connectedUsers).toBe(3);
    expect(payload.status).toMatch(/^(online|degraded)$/);
  });
});

describe('métricas y polling', () => {
  it('/api/status SÍ se cuenta; /api/health y el stream NO', async () => {
    resetMetrics();
    await fetch(`${baseUrl}/api/status`);
    await fetch(`${baseUrl}/api/health`);
    // Da tiempo al `finish` de registrar (mismo tick en la práctica).
    await new Promise((resolve) => setTimeout(resolve, 50));
    const routes = getMetricsSnapshot().http.routes.map((r) => r.route);
    expect(routes).toContain('GET /api/status');
    expect(routes).not.toContain('GET /api/health');
    expect(routes).not.toContain('GET /api/status/stream');
  });
});
