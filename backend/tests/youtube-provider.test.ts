import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import youtubeRoutes from '../src/routes/youtube.routes.js';
import { describeYouTubeProvider, registerYouTubeProvider, revokeYouTubeProvider, PROVIDER_TTL_MS } from '../src/services/youtube-provider.service.js';
import { sanitizeRoomSettings } from '../src/domain/settings-policy.js';

const localFetch = globalThis.fetch;
let server: Server;
let endpoint: string;
const registered: Array<{ id: string; owner: string }> = [];
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/youtube', youtubeRoutes);
  server = createServer(app);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/youtube`;
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  registered.splice(0).forEach(({ id, owner }) => revokeYouTubeProvider(id, owner));
});
afterAll(async () => { await new Promise<void>((done) => server.close(() => done())); });

it('registers a private API key, exposes only a search reference and uses that key upstream', async () => {
  const apiKey = 'private-room-key-for-tests-only';
  const response = await localFetch(`${endpoint}/providers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'google', apiKey }) });
  expect(response.status).toBe(201);
  const registration = await response.json(); registered.push(registration);
  expect(JSON.stringify(registration)).not.toContain(apiKey);
  const described = await (await localFetch(`${endpoint}/providers/${registration.id}`)).json();
  expect(described).not.toHaveProperty('secret'); expect(described).not.toHaveProperty('owner');
  const upstream = vi.fn().mockResolvedValue(Response.json({ items: [] })); vi.stubGlobal('fetch', upstream);
  const search = await localFetch(`${endpoint}/search?q=music`, { headers: { Authorization: `Bearer ${registration.id}` } });
  expect(search.status).toBe(200);
  expect(upstream.mock.calls[0][1].headers['X-Goog-Api-Key']).toBe(apiKey);
  expect(sanitizeRoomSettings({ youtubeProvider: registration.id }).errors).toEqual([]);
  expect(sanitizeRoomSettings({ youtubeProvider: apiKey }).errors.length).toBeGreaterThan(0);
});

it('only forwards tokens to configured HTTPS endpoints and normalizes their results', async () => {
  expect(() => registerYouTubeProvider({ kind: 'endpoint', endpoint: 'http://127.0.0.1/private' })).toThrow();
  vi.stubEnv('YOUTUBE_SEARCH_PROVIDER_ORIGINS', 'https://search.example.com');
  expect(() => registerYouTubeProvider({ kind: 'endpoint', endpoint: 'https://search.example.com/search?key=secret' })).toThrow();
  const provider = registerYouTubeProvider({ kind: 'endpoint', endpoint: 'https://search.example.com/search', token: 'private-token' }); registered.push(provider);
  const upstream = vi.fn().mockResolvedValue(Response.json({ tracks: [{ id: 'PW6ZSzdjrlo', name: 'Song', openUrl: 'https://untrusted.example.com' }] })); vi.stubGlobal('fetch', upstream);
  const response = await localFetch(`${endpoint}/search?q=Queen`, { headers: { Authorization: `Bearer ${provider.id}` } });
  expect(response.status).toBe(200);
  expect(upstream.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer private-token' }, redirect: 'error' });
  expect((await response.json()).tracks[0].openUrl).toBe('https://www.youtube.com/watch?v=PW6ZSzdjrlo');
});

it('expires registrations and rejects revocation by participants without the private owner key', async () => {
  const provider = registerYouTubeProvider({ kind: 'google', apiKey: 'private-test-api-key-value' }); registered.push(provider);
  const denied = await localFetch(`${endpoint}/providers/${provider.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${provider.id}` } });
  expect(denied.status).toBe(403);
  expect(revokeYouTubeProvider(provider.id, 'é'.repeat(64))).toBe(false);
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + PROVIDER_TTL_MS + 1);
  expect(describeYouTubeProvider(provider.id)).toBeNull();
  const expired = await localFetch(`${endpoint}/search?q=music`, { headers: { Authorization: `Bearer ${provider.id}` } });
  expect(expired.status).toBe(410);
});
