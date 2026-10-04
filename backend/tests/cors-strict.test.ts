import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { corsOptions, getAllowedOrigins, isOriginAllowed } from '../src/config/cors.js';

const savedEnv = { ...process.env };

type OriginCallback = (err: Error | null, allow?: boolean) => void;

function callOriginValidator(origin: string | undefined): { err: Error | null; allow?: boolean } {
  const validator = corsOptions.origin as (
    origin: string | undefined,
    cb: OriginCallback,
  ) => void;
  let out: { err: Error | null; allow?: boolean } = { err: null };
  validator(origin, (err, allow) => {
    out = { err, allow };
  });
  return out;
}

beforeEach(() => {
  process.env = { ...savedEnv };
  delete process.env.CLIENT_URL;
  delete process.env.ALLOWED_ORIGINS;
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe('CORS estricto: allowlist reducida (sin 3000/4000)', () => {
  it('en desarrollo la allowlist es CLIENT_URL + loopback 5173/4173', () => {
    process.env.NODE_ENV = 'development';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    const allowed = getAllowedOrigins() as string[];
    expect(allowed).toHaveLength(5);
    expect(allowed).toEqual([
      'https://mi-app.vercel.app',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ]);
  });

  it('3000/4000 ya no entran como allowlist (sin uso evidenciado como Origin)', () => {
    process.env.NODE_ENV = 'development';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    expect(isOriginAllowed('http://localhost:3000')).toBe(false);
    expect(isOriginAllowed('http://localhost:4000')).toBe(false);
    expect(isOriginAllowed('http://127.0.0.1:4000')).toBe(false);
    expect(isOriginAllowed('http://localhost:5174')).toBe(false);
  });

  it('ALLOWED_ORIGINS es el escape para puertos/orígenes de dev no estándar', () => {
    process.env.NODE_ENV = 'development';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    process.env.ALLOWED_ORIGINS = 'http://localhost:5174';
    expect(isOriginAllowed('http://localhost:5174')).toBe(true);
    expect(isOriginAllowed('http://localhost:3000')).toBe(false);
  });

  it('LAN se conserva SOLO en no-producción (dev en móvil: vite host:true + socket a <hostname>:4000)', () => {
    process.env.NODE_ENV = 'development';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    expect(isOriginAllowed('http://192.168.1.50:5173')).toBe(true);
    expect(isOriginAllowed('http://10.0.0.5:5173')).toBe(true);
    expect(isOriginAllowed('http://172.16.0.9:5173')).toBe(true);

    process.env.NODE_ENV = 'production';
    expect(isOriginAllowed('http://192.168.1.50:5173')).toBe(false);
    expect(isOriginAllowed('http://localhost:5173')).toBe(false);
    expect(isOriginAllowed('https://mi-app.vercel.app')).toBe(true);
  });

  it('ALLOWED_ORIGINS amplía la allowlist de producción (escape para previews/domínios extra)', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    process.env.ALLOWED_ORIGINS = 'https://preview-mi-app.vercel.app, https://otra.vercel.app/ ';
    expect(isOriginAllowed('https://preview-mi-app.vercel.app')).toBe(true);
    expect(isOriginAllowed('https://otra.vercel.app')).toBe(true);
    expect(isOriginAllowed('https://evil.com')).toBe(false);
  });

  it('el validador del contrato corsOptions acepta permitidos y deniega con Error', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    const ok = callOriginValidator('https://mi-app.vercel.app');
    expect(ok.err).toBeNull();
    expect(ok.allow).toBe(true);
    const denied = callOriginValidator('https://evil.com');
    expect(denied.err).toBeInstanceOf(Error);
    // Sin Origin (curl / server-to-server) se permite.
    const noOrigin = callOriginValidator(undefined);
    expect(noOrigin.err).toBeNull();
    expect(noOrigin.allow).toBe(true);
  });

  it('credentials:true se mantiene en Express y Socket.IO usa el mismo validador', () => {
    expect(corsOptions.credentials).toBe(true);
    expect(corsOptions.methods).toContain('GET');
    expect(corsOptions.allowedHeaders).toContain('Authorization');
  });
});
