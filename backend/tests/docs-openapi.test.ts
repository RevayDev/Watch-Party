import { describe, it, expect, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { openapiSpec } from '../src/docs/openapi.js';

/**
 * La documentación OpenAPI vive junto al código (`src/docs/openapi.ts`):
 * este test levanta la app en un puerto efímero y verifica que cada path
 * documentado responde de verdad (así el doc no se pudre en silencio).
 */
let server: Server | null = null;
let base = '';

async function startApp(): Promise<string> {
  if (base) return base;
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return base;
}

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((err) => (err ? reject(err) : resolve()))
    );
    server = null;
    base = '';
  }
});

describe('docs OpenAPI (/api/docs)', () => {
  it('el spec es OpenAPI 3.x con los grupos principales', () => {
    expect(openapiSpec.openapi).toMatch(/^3\./);
    const paths = Object.keys((openapiSpec as any).paths);
    for (const p of [
      '/api/health',
      '/api/rooms',
      '/api/rooms/{roomId}',
      '/api/rooms/{roomId}/join',
      '/api/demo/availability',
      '/api/proxy',
    ]) {
      expect(paths).toContain(p);
    }
  });

  it('GET /api/docs/json devuelve el spec', async () => {
    const url = await startApp();
    const res = await fetch(`${url}/api/docs/json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.openapi).toMatch(/^3\./);
    expect(body.info.title).toContain('Watch Party');
  });

  it('GET /api/docs sirve la UI Swagger (HTML)', async () => {
    const url = await startApp();
    const res = await fetch(`${url}/api/docs/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/swagger/i);
  });

  it('cada path GET documentado sin parámetros responde (no 404 de ruta)', async () => {
    const url = await startApp();
    // Sin roomId real solo se exige que la RUTA exista (404 de negocio vale,
    // 404 de Express con "<!DOCTYPE" no).
    for (const p of ['/api/health', '/api/demo/availability']) {
      const res = await fetch(`${url}${p}`);
      expect(res.status).toBe(200);
    }
    const missing = await fetch(`${url}/api/rooms/ZZZZZZ`);
    expect(missing.status).toBe(404);
    const body = (await missing.json()) as any;
    expect(body.error).toBe('Room not found');
  });
});
