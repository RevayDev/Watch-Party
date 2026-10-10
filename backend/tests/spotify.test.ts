import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { RoomService } from '../src/services/room.service.js';
import { parseSpotifyUrl, toEmbedUrl } from '../src/domain/spotify.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

/**
 * Spotify ("Potify") fase 1 — docs/admin-panel-spotify.md §2.
 * TDD: define el contrato antes de la implementación.
 *
 * - `parseSpotifyUrl` es puro (sin red): enlaces track/playlist/album/episode.
 * - `GET /api/spotify/resolve` valida un enlace sin auth.
 * - `/api/spotify/status|auth-url|callback|disconnect`: OAuth con token en el
 *   servidor (memoria efímera). Sin env → configured:false / 503.
 * - `POST /api/rooms/:roomId/video-url` acepta enlaces Spotify (sin probe de
 *   red) y los guarda con `sourceType: 'spotify'`.
 */

let server: Server | null = null;
let base = '';

async function startApp(): Promise<string> {
  if (base) return base;
  backupRoomsFile();
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return base;
}

async function stopApp(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((err) => (err ? reject(err) : resolve()))
    );
    server = null;
    base = '';
  }
  await restoreRoomsFile();
}

beforeAll(async () => {
  await startApp();
});

afterAll(async () => {
  await stopApp();
});

afterEach(async () => {
  const rooms = await RoomService.listRooms();
  for (const r of rooms) {
    await RoomService.deleteRoom(r.roomId, true).catch(() => false);
  }
});

describe('parseSpotifyUrl (puro, sin red)', () => {
  it('reconoce track', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQ?si=abc')).toEqual({
      kind: 'track',
      id: '4uLU6hMCjMI75M1A2tKUQ',
    });
  });

  it('reconoce playlist, album y episode', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')?.kind).toBe('playlist');
    expect(parseSpotifyUrl('https://open.spotify.com/album/6JWc4iAiJ9Fy6M5KY8Aa6v')?.kind).toBe('album');
    expect(parseSpotifyUrl('https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKy')?.kind).toBe('episode');
  });

  it('tolera locale /intl-es/ y embed', () => {
    expect(
      parseSpotifyUrl('https://open.spotify.com/intl-es/track/4uLU6hMCjMI75M1A2tKUQ')
    ).toEqual({ kind: 'track', id: '4uLU6hMCjMI75M1A2tKUQ' });
    expect(
      parseSpotifyUrl('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQ')
    ).toEqual({ kind: 'track', id: '4uLU6hMCjMI75M1A2tKUQ' });
  });

  it('rechaza lo que no es Spotify', () => {
    expect(parseSpotifyUrl('https://www.youtube.com/watch?v=abc')).toBeNull();
    expect(parseSpotifyUrl('https://open.spotify.com/user/alguien')).toBeNull();
    expect(parseSpotifyUrl('no-es-url')).toBeNull();
    expect(parseSpotifyUrl('')).toBeNull();
  });

  it('toEmbedUrl construye el reproductor embebido', () => {
    expect(toEmbedUrl({ kind: 'track', id: 'ABC123' })).toBe(
      'https://open.spotify.com/embed/track/ABC123'
    );
  });
});

describe('GET /api/spotify/resolve', () => {
  it('resuelve un enlace válido sin auth', async () => {
    const url = await startApp();
    const res = await fetch(
      `${url}/api/spotify/resolve?url=${encodeURIComponent('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQ')}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.kind).toBe('track');
    expect(body.embedUrl).toBe('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQ');
  });

  it('400 sin url o con url inválida', async () => {
    const url = await startApp();
    expect((await fetch(`${url}/api/spotify/resolve`)).status).toBe(400);
    const bad = await fetch(
      `${url}/api/spotify/resolve?url=${encodeURIComponent('https://example.com/x')}`
    );
    expect(bad.status).toBe(400);
  });
});

describe('Spotify OAuth básico (token en servidor)', () => {
  it('status sin configurar → configured:false', async () => {
    const url = await startApp();
    const res = await fetch(`${url}/api/spotify/status?roomId=ABC123`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.configured).toBe(false);
    expect(body.connected).toBe(false);
  });

  it('status sin roomId → 400', async () => {
    const url = await startApp();
    expect((await fetch(`${url}/api/spotify/status`)).status).toBe(400);
  });

  it('auth-url sin configurar → 503', async () => {
    const url = await startApp();
    const res = await fetch(`${url}/api/spotify/auth-url?roomId=ABC123`);
    expect(res.status).toBe(503);
  });

  it('callback sin code → 400', async () => {
    const url = await startApp();
    expect((await fetch(`${url}/api/spotify/callback?state=ABC123`)).status).toBe(400);
  });

  it('disconnect siempre deja connected:false', async () => {
    const url = await startApp();
    const res = await fetch(`${url}/api/spotify/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: 'ABC123' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).connected).toBe(false);
  });
});

describe('video-url acepta Spotify (sin probe de red)', () => {
  it('guarda sourceType spotify con embedUrl', async () => {
    const url = await startApp();
    const { room, leaderSecret } = await RoomService.createRoom({
      leaderName: 'DjLider',
      isTemporary: true,
    });
    const res = await fetch(`${url}/api/rooms/${room.roomId}/video-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-leader-secret': leaderSecret,
        'x-user-name': 'DjLider',
      },
      body: JSON.stringify({
        url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQ',
        title: 'Mi canción',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.video.sourceType).toBe('spotify');
    expect(body.video.directUrl).toBe(
      'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQ'
    );
    expect(body.video.originalName).toBe('Mi canción');
  });

  it('sin título usa un nombre por defecto legible', async () => {
    const url = await startApp();
    const { room, leaderSecret } = await RoomService.createRoom({
      leaderName: 'DjLider2',
      isTemporary: true,
    });
    const res = await fetch(`${url}/api/rooms/${room.roomId}/video-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-leader-secret': leaderSecret,
        'x-user-name': 'DjLider2',
      },
      body: JSON.stringify({
        url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.video.sourceType).toBe('spotify');
    expect(typeof body.video.originalName).toBe('string');
    expect(body.video.originalName.length).toBeGreaterThan(0);
  });

  it('enlace Spotify con tipo no soportado → 400', async () => {
    const url = await startApp();
    const { room, leaderSecret } = await RoomService.createRoom({
      leaderName: 'DjLider3',
      isTemporary: true,
    });
    const res = await fetch(`${url}/api/rooms/${room.roomId}/video-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-leader-secret': leaderSecret,
        'x-user-name': 'DjLider3',
      },
      body: JSON.stringify({ url: 'https://open.spotify.com/user/alguien' }),
    });
    expect(res.status).toBe(400);
  });
});
