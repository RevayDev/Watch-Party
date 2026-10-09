import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getAllowedOrigins, isOriginAllowed, corsOptions, resetCorsWarningsForTests } from '../src/config/cors.js';

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...savedEnv };
  delete process.env.CLIENT_URL;
  delete process.env.ALLOWED_ORIGINS;
  resetCorsWarningsForTests();
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

  it('en desarrollo incluye CLIENT_URL + loopback 5173/4173', () => {
    process.env.NODE_ENV = 'development';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    const allowed = getAllowedOrigins() as string[];
    expect(allowed).toContain('https://mi-app.vercel.app');
    expect(allowed).toContain('http://localhost:5173');
    expect(allowed).toContain('http://127.0.0.1:5173');
    expect(allowed).toContain('http://localhost:4173');
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:5173')).toBe(true);
    expect(isOriginAllowed('http://localhost:4173')).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:4173')).toBe(true);
    expect(isOriginAllowed('https://evil.com')).toBe(false);
  });

  it('sin Origin (curl / server-to-server) se permite', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    expect(isOriginAllowed(undefined)).toBe(true);
  });

  it('previews de Vercel (*.vercel.app) entran en producción con comodín controlado', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    process.env.ALLOWED_ORIGINS = '*.vercel.app';
    expect(
      isOriginAllowed('https://mi-app-abc123-mi-equipo.vercel.app')
    ).toBe(true);
    expect(isOriginAllowed('https://mi-app.vercel.app')).toBe(true);
    // Spoofing y http no pasan
    expect(isOriginAllowed('http://mi-app-abc123.vercel.app')).toBe(false);
    expect(isOriginAllowed('https://vercel.app.evil.com')).toBe(false);
    expect(isOriginAllowed('https://evil-vercel.app')).toBe(false);
    expect(isOriginAllowed('https://evil.com')).toBe(false);
  });

  it('dominios custom www + apex entran vía ALLOWED_ORIGINS', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    process.env.ALLOWED_ORIGINS =
      'https://www.mi-dominio.com,https://mi-dominio.com';
    expect(isOriginAllowed('https://www.mi-dominio.com')).toBe(true);
    expect(isOriginAllowed('https://mi-dominio.com')).toBe(true);
    expect(isOriginAllowed('https://otro.com')).toBe(false);
  });

  it('LAN es flujo oficial de dev y se apaga con ALLOW_LAN_DEV=false', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CLIENT_URL;
    expect(isOriginAllowed('http://192.168.1.50:5173')).toBe(true);
    expect(isOriginAllowed('http://10.0.0.8:5173')).toBe(true);
    process.env.ALLOW_LAN_DEV = 'false';
    expect(isOriginAllowed('http://192.168.1.50:5173')).toBe(false);
    // En producción la LAN nunca entra
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://mi-app.vercel.app';
    delete process.env.ALLOW_LAN_DEV;
    expect(isOriginAllowed('http://192.168.1.50:5173')).toBe(false);
  });

  it('allowedHeaders cubre los headers reales del frontend', () => {
    const headers = (corsOptions.allowedHeaders as string[]).map((h) =>
      h.toLowerCase()
    );
    for (const h of [
      'x-leader-secret',
      'x-user-id',
      'x-user-name',
      'content-type',
      'range',
    ]) {
      expect(headers).toContain(h);
    }
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
