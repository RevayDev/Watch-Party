import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getAllowedOrigins, isOriginAllowed } from '../src/config/cors.js';

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...savedEnv };
  delete process.env.CLIENT_URL;
  delete process.env.ALLOWED_ORIGINS;
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe('CORS: allowlist (CLIENT_URL + locales de desarrollo)', () => {
  it('en producción con CLIENT_URL usa allowlist estricta', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://mi-watch-party.vercel.app';
    const allowed = getAllowedOrigins();
    expect(allowed).toEqual(['https://mi-watch-party.vercel.app']);
    expect(isOriginAllowed('https://mi-watch-party.vercel.app')).toBe(true);
    expect(isOriginAllowed('http://localhost:5173')).toBe(false);
    expect(isOriginAllowed('https://evil.com')).toBe(false);
  });

  it('normaliza la barra final de CLIENT_URL', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app/';
    expect(isOriginAllowed('https://mi-app.vercel.app')).toBe(true);
  });

  it('en desarrollo incluye CLIENT_URL + localhost:5173 + 127.0.0.1:5173', () => {
    process.env.NODE_ENV = 'development';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    const allowed = getAllowedOrigins() as string[];
    expect(allowed).toContain('https://mi-app.vercel.app');
    expect(allowed).toContain('http://localhost:5173');
    expect(allowed).toContain('http://127.0.0.1:5173');
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:5173')).toBe(true);
    expect(isOriginAllowed('https://evil.com')).toBe(false);
  });

  it('sin Origin (curl / server-to-server) se permite', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    expect(isOriginAllowed(undefined)).toBe(true);
  });

  it('sin CLIENT_URL conserva la apertura de desarrollo y avisa con console.warn (una vez)', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CLIENT_URL;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const allowed = getAllowedOrigins() as string[];
    // Apertura actual conservada: locales de desarrollo siguen entrando.
    expect(allowed).toContain('http://localhost:5173');
    expect(allowed).toContain('http://127.0.0.1:5173');
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('CLIENT_URL');
    // Segunda llamada: no vuelve a avisar.
    getAllowedOrigins();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
