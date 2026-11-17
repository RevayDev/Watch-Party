import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import youtubeRoutes from '../src/routes/youtube.routes';

const localFetch = globalThis.fetch;
let server: Server;
let endpoint: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/youtube', youtubeRoutes);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/youtube/search`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

it('devuelve 503 si falta la clave y conserva la opción de pegar un enlace', async () => {
  vi.stubEnv('YOUTUBE_API_KEY', undefined);
  const response = await localFetch(`${endpoint}?q=queen`);
  expect(response.status).toBe(503);
  expect((await response.json()).error).toMatch(/pegar un enlace/i);
});

it('pide videos insertables y devuelve pistas listas para la cola', async () => {
  vi.stubEnv('YOUTUBE_API_KEY', 'test-key');
  const upstream = vi.fn().mockResolvedValue(Response.json({
    items: [
      { id: { videoId: 'PW6ZSzdjrlo' }, snippet: { title: 'Bohemian Rhapsody', channelTitle: 'Queen' } },
      { id: { channelId: 'Queen' }, snippet: { title: 'Queen' } },
    ],
  }));
  vi.stubGlobal('fetch', upstream);
  const response = await localFetch(`${endpoint}?q=Queen%20%26%20karaoke`);

  expect(response.status).toBe(200);
  const [url, options] = upstream.mock.calls[0];
  const request = new URL(url);
  expect(request.origin).toBe('https://www.googleapis.com');
  expect(request.searchParams.get('q')).toBe('Queen & karaoke');
  expect(request.searchParams.get('videoEmbeddable')).toBe('true');
  expect(options.headers['X-Goog-Api-Key']).toBe('test-key');
  expect(await response.json()).toEqual({
    tracks: [{
      id: 'PW6ZSzdjrlo',
      name: 'Bohemian Rhapsody',
      artists: 'Queen',
      albumArt: 'https://img.youtube.com/vi/PW6ZSzdjrlo/mqdefault.jpg',
      uri: 'https://www.youtube.com/watch?v=PW6ZSzdjrlo',
      openUrl: 'https://www.youtube.com/watch?v=PW6ZSzdjrlo',
    }],
  });
});
