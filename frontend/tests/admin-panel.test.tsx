// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AdminPanel } from '../src/features/admin/AdminPanel';

/**
 * Panel Admin UI (docs/admin-panel-spotify.md §1).
 * TDD: define el contrato antes de la implementación.
 * fetch global mockeado por URL+método; el token vive en sessionStorage
 * (nunca en el código).
 */

const TOKEN_KEY = 'wp_admin_token';

interface MockRoute {
  method: string;
  match: (url: string) => boolean;
  status: number;
  body: unknown;
}

let routes: MockRoute[] = [];
const calls: Array<{ url: string; method: string; headers: any; body: any }> = [];

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase();
    let parsedBody: any = null;
    try {
      parsedBody = init?.body ? JSON.parse(init.body as string) : null;
    } catch {
      parsedBody = init?.body ?? null;
    }
    calls.push({ url, method, headers: init?.headers ?? {}, body: parsedBody });
    const route = routes.find((r) => r.method === method && r.match(url));
    const status = route?.status ?? 404;
    const body = route?.body ?? { error: 'no mock' };
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
}

const roomsList = {
  total: 1,
  rooms: [
    {
      roomId: 'ABC123',
      name: 'Sala demo',
      status: 'active',
      isTemporary: true,
      participantCount: 2,
      participants: [
        { name: 'Ana', role: 'leader', isLeader: true },
        { name: 'Troll', role: 'member', isLeader: false },
      ],
      video: null,
      timerEndsAt: null,
      joinRequestsCount: 0,
      kickedCount: 0,
      createdAt: new Date().toISOString(),
    },
  ],
};

const roomDetail = {
  roomId: 'ABC123',
  leaderName: 'Ana',
  status: 'active',
  isTemporary: true,
  participants: [
    { name: 'Ana', role: 'leader', isLeader: true, joinedAt: new Date().toISOString() },
    { name: 'Troll', role: 'member', isLeader: false, joinedAt: new Date().toISOString() },
  ],
  video: null,
  settings: { reactionsEnabled: true, visualEffects: true },
  joinRequests: [],
  kickedUsers: [{ name: 'Spammer', banned: true }],
  createdAt: new Date().toISOString(),
};

function baseRoutes(): MockRoute[] {
  return [
    {
      method: 'GET',
      match: (u) => u.endsWith('/api/admin/rooms'),
      status: 200,
      body: roomsList,
    },
    {
      method: 'GET',
      match: (u) => u.endsWith('/api/admin/rooms/ABC123'),
      status: 200,
      body: roomDetail,
    },
  ];
}

beforeEach(() => {
  routes = baseRoutes();
  calls.length = 0;
  sessionStorage.clear();
  vi.stubGlobal('fetch', mockFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function login(token = 'secreto') {
  render(<AdminPanel />);
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(/token de administrador/i), {
      target: { value: token },
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /entrar/i }));
  });
}

describe('AdminPanel (gate)', () => {
  it('pide el token antes de mostrar nada', () => {
    render(<AdminPanel />);
    expect(screen.getByText(/panel admin/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/token de administrador/i)).toBeDefined();
    expect(screen.queryByText('ABC123')).toBeNull();
  });

  it('muestra error con token inválido (401)', async () => {
    routes = [
      { method: 'GET', match: (u) => u.endsWith('/api/admin/rooms'), status: 401, body: { error: 'Token de administrador inválido.' } },
    ];
    await login('mal');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });

  it('lista las salas con token válido y manda x-admin-token', async () => {
    await login();
    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeDefined();
    });
    expect(screen.getByText(/2 participantes/i)).toBeDefined();
    const listCall = calls.find((c) => c.url.endsWith('/api/admin/rooms'));
    expect(listCall?.headers['x-admin-token']).toBe('secreto');
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('secreto');
  });
});

describe('AdminPanel (detalle y acciones)', () => {
  it('muestra participantes y expulsa con POST kick', async () => {
    routes.push({
      method: 'POST',
      match: (u) => u.endsWith('/api/admin/rooms/ABC123/kick'),
      status: 200,
      body: { message: 'ok', participants: [], kickedUsers: [] },
    });
    await login();
    await waitFor(() => expect(screen.getByText('ABC123')).toBeDefined());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ver/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('Troll')).toBeDefined();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /expulsar/i }));
    });
    await waitFor(() => {
      const kick = calls.find((c) => c.url.endsWith('/kick'));
      expect(kick).toBeDefined();
      expect(kick?.body.targetUserName).toBe('Troll');
    });
  });

  it('cierra la sala con DELETE y confirmación', async () => {
    routes.push({
      method: 'DELETE',
      match: (u) => u.endsWith('/api/admin/rooms/ABC123'),
      status: 200,
      body: { message: 'Sala cerrada', roomId: 'ABC123' },
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await login();
    await waitFor(() => expect(screen.getByText('ABC123')).toBeDefined());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    });
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/api/admin/rooms/ABC123'))).toBe(true);
    });
    confirmSpy.mockRestore();
  });

  it('guarda ajustes con PATCH settings', async () => {
    routes.push({
      method: 'PATCH',
      match: (u) => u.endsWith('/api/admin/rooms/ABC123/settings'),
      status: 200,
      body: { message: 'ok', settings: { reactionsEnabled: false } },
    });
    await login();
    await waitFor(() => expect(screen.getByText('ABC123')).toBeDefined());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ver/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /guardar ajustes/i })).toBeDefined();
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/reacciones/i));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /guardar ajustes/i }));
    });
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch?.body.settings.reactionsEnabled).toBe(false);
    });
  });

  it('desbanea desde la lista de expulsados', async () => {
    routes.push({
      method: 'POST',
      match: (u) => u.endsWith('/api/admin/rooms/ABC123/unban'),
      status: 200,
      body: { message: 'ok', kickedUsers: [] },
    });
    await login();
    await waitFor(() => expect(screen.getByText('ABC123')).toBeDefined());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ver/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('Spammer')).toBeDefined();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /desbanear/i }));
    });
    await waitFor(() => {
      const unban = calls.find((c) => c.url.endsWith('/unban'));
      expect(unban?.body.targetUserName).toBe('Spammer');
    });
  });
});
