// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { StatusPage } from '../src/features/status/StatusPage';

const HEALTH = {
  status: 'ok',
  service: 'watch-party-backend',
  uptime: 7322,
  database: 'connected',
  websocket: 'up',
  connections: 7,
  rooms: 3,
  timestamp: new Date().toISOString(),
};

const STATUS = {
  status: 'online',
  connectedUsers: 7,
  peakUsers: 12,
  activeRooms: 3,
  avgUsersPerRoom: 2.33,
  maxUsersPerRoom: 5,
  freeRooms: 3,
  premiumRooms: 0,
  uptime: 7322,
  timestamp: new Date().toISOString(),
};

function mockFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = url.endsWith('/api/health') ? HEALTH : STATUS;
    return { ok: true, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/status público', () => {
  it('pinta agregados (sin token, sin PII) con fallback de polling', async () => {
    const { calls } = mockFetch();
    await act(async () => {
      render(<StatusPage onBack={() => undefined} />);
    });

    expect(await screen.findByTestId('status-page')).toBeDefined();
    expect(await screen.findByText('7 conexiones')).toBeDefined();
    expect(screen.getByTestId('status-connected-users')).toHaveTextContent('7');
    expect(screen.getByTestId('status-rooms')).toHaveTextContent('3');
    expect(screen.getByTestId('status-database')).toHaveTextContent('connected');

    // Cero PII en lo renderizado
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/@|\bemail\b/i);

    // Ninguna petición lleva token de admin
    for (const c of calls) {
      const headers = (c.init?.headers ?? {}) as Record<string, string>;
      expect(headers['x-admin-token']).toBeUndefined();
      expect(JSON.stringify(headers)).not.toMatch(/Bearer/);
    }
    // Solo endpoints públicos, nada de /api/admin
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.url).not.toMatch(/\/api\/admin/);
    }
  });

  it('muestra modo polling cuando no hay SSE (jsdom sin EventSource)', async () => {
    mockFetch();
    await act(async () => {
      render(<StatusPage onBack={() => undefined} />);
    });
    expect(await screen.findByTestId('status-source')).toBeDefined();
    expect(await screen.findByText(/Actualizado cada 12 s/)).toBeDefined();
  });
});
