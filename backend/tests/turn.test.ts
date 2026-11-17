import { createHmac } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createTurnCredentials } from '../src/config/turn.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it('omite TURN si el servidor de relay no está configurado', () => {
  vi.stubEnv('TURN_SHARED_SECRET', undefined);
  vi.stubEnv('TURN_URLS', 'turn:relay.example:3478');
  expect(createTurnCredentials('socket')).toBeUndefined();
});

it('genera una credencial con caducidad para el socket, sin devolver el secreto', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  vi.stubEnv('TURN_SHARED_SECRET', 'secret');
  vi.stubEnv('TURN_URLS', 'turn:relay.example:3478, turns:relay.example:5349?transport=tcp, https://ignored.example');

  const username = `${Date.now() / 1000 + 86_400}:socket`;
  expect(createTurnCredentials('socket')).toEqual({
    urls: ['turn:relay.example:3478', 'turns:relay.example:5349?transport=tcp'],
    username,
    credential: createHmac('sha1', 'secret').update(username).digest('base64'),
  });
});
