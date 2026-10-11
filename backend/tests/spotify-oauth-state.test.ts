import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { clearSpotifyTokens } from '../src/services/spotify.service.js';
import { clearSpotifyStates, expireSpotifyStatesForTests } from '../src/services/spotify-state.js';

/**
 * OAuth endurecido: `state` anti-CSRF de un solo uso ligado a la sala.
 * - El state solo vale una vez (reutilizarlo → 400 de sesión).
 * - Expirado (10 min) → 400 de sesión.
 * - El state liga la sala (mismatch/trucado → 400; la conexión queda en la
 *   sala del state, no en otra).
 * - Tokens jamás en respuestas (status / errores de callback).
 */

let server: Server | null = null;
let base = '';
const savedEnv = { ...process.env };
const origFetch = globalThis.fetch;

async function startApp(): Promise<string> {
  if (base) return base;
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return base;
}

/** Stub del token endpoint de Spotify (solo canje/refresh, resto pasa). */
function stubTokenSuccess(): void {
  globalThis.fetch = (async (url: unknown, init?: unknown) => {
    if (String(url).includes('accounts.spotify.com/api/token')) {
      return new Response(
        JSON.stringify({ access_token: 'AT-state', refresh_token: 'RT-state', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return origFetch(url as never, init as never);
  }) as typeof fetch;
}

function stateOf(authUrl: string): string {
  const state = new URL(authUrl).searchParams.get('state');
  expect(state).toBeTruthy();
  return state as string;
}

beforeAll(async () => {
  process.env.SPOTIFY_CLIENT_ID = 'test-client';
  process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
  process.env.SPOTIFY_REDIRECT_URI = 'http://localhost:4000/api/spotify/callback';
  process.env.CLIENT_URL = 'http://localhost:5173';
  delete process.env.SPOTIFY_TOKEN_KEY;
  await startApp();
});

afterAll(async () => {
  globalThis.fetch = origFetch;
  process.env = { ...savedEnv };
  clearSpotifyTokens();
  clearSpotifyStates();
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((err) => (err ? reject(err) : resolve()))
    );
    server = null;
    base = '';
  }
});

describe('OAuth state de un solo uso', () => {
  it('auth-url firma state base64url(roomId.nonce) y el callback lo consume una vez', async () => {
    stubTokenSuccess();
    try {
      const url = await startApp();
      const authRes = await fetch(`${url}/api/spotify/auth-url?roomId=statE1`);
      expect(authRes.status).toBe(200);
      const { authUrl } = (await authRes.json()) as { authUrl: string };
      const state = stateOf(authUrl);
      const decoded = Buffer.from(state, 'base64url').toString('utf-8');
      expect(decoded).toMatch(/^STATE1\.[0-9a-f]{32}$/);

      const cb = await fetch(
        `${url}/api/spotify/callback?code=C1&state=${encodeURIComponent(state)}`,
        { redirect: 'manual' }
      );
      expect(cb.status).toBe(302);
      const location = cb.headers.get('location') ?? '';
      expect(location).toContain('room=STATE1');
      expect(location).toContain('spotify=connected');

      // Reutilizar el mismo state → redirige con error (ya consumido).
      const replay = await fetch(
        `${url}/api/spotify/callback?code=C1&state=${encodeURIComponent(state)}`,
        { redirect: 'manual' }
      );
      expect(replay.status).toBe(302);
      const replayLoc = replay.headers.get('location') ?? '';
      expect(replayLoc).toContain('spotify=error');
      expect(replayLoc).toContain('reason=expired');
    } finally {
      globalThis.fetch = origFetch;
      clearSpotifyTokens();
      clearSpotifyStates();
    }
  });

  it('state expirado → redirige con error al cliente', async () => {
    stubTokenSuccess();
    try {
      const url = await startApp();
      const authRes = await fetch(`${url}/api/spotify/auth-url?roomId=EXPIRE1`);
      const { authUrl } = (await authRes.json()) as { authUrl: string };
      const state = stateOf(authUrl);
      expireSpotifyStatesForTests();
      const cb = await fetch(
        `${url}/api/spotify/callback?code=C2&state=${encodeURIComponent(state)}`,
        { redirect: 'manual' }
      );
      expect(cb.status).toBe(302);
      const location = cb.headers.get('location') ?? '';
      expect(location).toContain('room=EXPIRE1');
      expect(location).toContain('spotify=error');
      expect(location).toContain('reason=expired');
    } finally {
      globalThis.fetch = origFetch;
      clearSpotifyTokens();
      clearSpotifyStates();
    }
  });

  it('state con formato inválido o trucado (room mismatch) → redirige con error', async () => {
    const url = await startApp();
    for (const bad of ['no-es-base64!!!', Buffer.from('SINPUNTO', 'utf-8').toString('base64url')]) {
      const res = await fetch(`${url}/api/spotify/callback?code=C3&state=${encodeURIComponent(bad)}`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location') ?? '').toContain('spotify=error');
    }
    // Trucado: state válido de ROOM-A reescrito como ROOM-B (el nonce liga ROOM-A).
    stubTokenSuccess();
    try {
      const authRes = await fetch(`${url}/api/spotify/auth-url?roomId=ROOMAA`);
      const { authUrl } = (await authRes.json()) as { authUrl: string };
      const decoded = Buffer.from(stateOf(authUrl), 'base64url').toString('utf-8');
      const nonce = decoded.split('.')[1];
      const forged = Buffer.from(`ROOMB1.${nonce}`, 'utf-8').toString('base64url');
      const res = await fetch(`${url}/api/spotify/callback?code=C4&state=${encodeURIComponent(forged)}`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      const location = res.headers.get('location') ?? '';
      expect(location).toContain('spotify=error');
      // Vuelve a la sala que decía el state (aunque el nonce no valide).
      expect(location).toContain('room=ROOMB1');
    } finally {
      globalThis.fetch = origFetch;
      clearSpotifyTokens();
      clearSpotifyStates();
    }
  });

  it('el state liga la sala: conecta ROOMA, no ROOMB', async () => {
    stubTokenSuccess();
    try {
      const url = await startApp();
      const authRes = await fetch(`${url}/api/spotify/auth-url?roomId=ROOMAA`);
      const { authUrl } = (await authRes.json()) as { authUrl: string };
      const cb = await fetch(
        `${url}/api/spotify/callback?code=C5&state=${encodeURIComponent(stateOf(authUrl))}`,
        { redirect: 'manual' }
      );
      expect(cb.status).toBe(302);
      const a = (await (await fetch(`${url}/api/spotify/status?roomId=ROOMAA`)).json()) as Record<string, unknown>;
      const b = (await (await fetch(`${url}/api/spotify/status?roomId=ROOMB1`)).json()) as Record<string, unknown>;
      expect(a.connected).toBe(true);
      expect(b.connected).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
      clearSpotifyTokens();
      clearSpotifyStates();
    }
  });

  it('tokens jamás en respuestas de status ni en errores de callback', async () => {
    stubTokenSuccess();
    try {
      const url = await startApp();
      const authRes = await fetch(`${url}/api/spotify/auth-url?roomId=NOTOKEN`);
      const { authUrl } = (await authRes.json()) as { authUrl: string };
      await fetch(
        `${url}/api/spotify/callback?code=C6&state=${encodeURIComponent(stateOf(authUrl))}`,
        { redirect: 'manual' }
      );
      const statusRes = await fetch(`${url}/api/spotify/status?roomId=NOTOKEN`);
      const statusText = await statusRes.text();
      expect(statusText).not.toMatch(/AT-state|RT-state|access_token|refresh_token/);
      expect(Object.keys(JSON.parse(statusText) as object).sort()).toEqual(
        ['accountName', 'configured', 'connected', 'error', 'persistent', 'roomId']
      );
    } finally {
      globalThis.fetch = origFetch;
      clearSpotifyTokens();
      clearSpotifyStates();
    }
    // Error de callback (Spotify rechaza el código) sin tokens.
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      if (String(url).includes('accounts.spotify.com/api/token')) {
        return new Response('denied', { status: 400 });
      }
      return origFetch(url as never, init as never);
    }) as typeof fetch;
    try {
      const url = await startApp();
      const authRes = await fetch(`${url}/api/spotify/auth-url?roomId=NOTOKEN`);
      const { authUrl } = (await authRes.json()) as { authUrl: string };
      const bad = await fetch(
        `${url}/api/spotify/callback?code=MALO&state=${encodeURIComponent(stateOf(authUrl))}`,
        { redirect: 'manual' }
      );
      expect(bad.status).toBe(302);
      const badLoc = bad.headers.get('location') ?? '';
      expect(badLoc).toContain('spotify=error');
      expect(badLoc).toContain('reason=rejected');
      expect(badLoc).not.toMatch(/access_token|refresh_token/);
    } finally {
      globalThis.fetch = origFetch;
      clearSpotifyTokens();
      clearSpotifyStates();
    }
  });
});
