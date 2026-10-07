import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiService } from '../src/services/api';

/**
 * Tests puros de ApiService con `fetch` mockeado (sin jsdom ni red).
 * `uploadVideo` usa XMLHttpRequest y se cubre aparte en `uploadVideo.test.ts`
 * con mock manual de XHR.
 */
function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  const json = vi.fn(async () => payload);
  const text = vi.fn(async () => JSON.stringify(payload));
  const res = { ok, status, json, headers: new Headers(), text } as unknown as Response;
  const fetchMock = vi.fn(async () => res);
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, res };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiService.createRoom', () => {
  it('POST /api/rooms con hostName e isTemporary', async () => {
    const { fetchMock } = mockFetchOnce({ roomId: 'ABC123', hostSecret: 's3cr3t', hostName: 'Ana' });
    const out = await ApiService.createRoom('Ana', false);
    expect(out.roomId).toBe('ABC123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/rooms');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ hostName: 'Ana', isTemporary: false });
  });

  it('propaga el error del backend', async () => {
    mockFetchOnce({ error: 'hostName is required' }, false, 400);
    await expect(ApiService.createRoom('')).rejects.toThrow('hostName is required');
  });

  it('usa mensaje genérico si el cuerpo no es JSON útil', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('bad json');
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(ApiService.createRoom('Ana')).rejects.toThrow('Error al crear la sala');
  });
});

describe('ApiService.getRoom / joinRoom', () => {
  it('getRoom construye la URL con el roomId', async () => {
    const { fetchMock } = mockFetchOnce({ roomId: 'ABC123' });
    await ApiService.getRoom('ABC123');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/rooms/ABC123');
  });

  it('getRoom lanza "Sala no encontrada" ante 404', async () => {
    mockFetchOnce({ error: 'Room not found' }, false, 404);
    await expect(ApiService.getRoom('ZZZZZZ')).rejects.toThrow('Room not found');
  });

  it('joinRoom envía userName por POST', async () => {
    const { fetchMock } = mockFetchOnce({ roomId: 'ABC123', pendingApproval: true });
    const out = await ApiService.joinRoom('ABC123', 'Invitado');
    expect(out.pendingApproval).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/rooms/ABC123/join');
    expect(JSON.parse(init.body as string)).toEqual({ userName: 'Invitado' });
  });
});

describe('ApiService.setVideoUrl', () => {
  it('envía url y title por POST', async () => {
    const { fetchMock } = mockFetchOnce({ message: 'ok' });
    await ApiService.setVideoUrl('ABC123', 'https://x/y.m3u8', 'Mi video');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/rooms/ABC123/video-url');
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://x/y.m3u8', title: 'Mi video' });
  });

  it('propaga errores de probe (enlace inválido)', async () => {
    mockFetchOnce({ error: 'El enlace no es válido (HTTP 404).' }, false, 400);
    await expect(ApiService.setVideoUrl('ABC123', 'https://x/bad.mp4')).rejects.toThrow(
      'El enlace no es válido (HTTP 404).'
    );
  });

  it('envía headers x-host-secret/x-user-id/x-user-name cuando hay sesión', async () => {
    const store = new Map<string, string>([
      ['watchparty_host_session', JSON.stringify({ roomId: 'ABC123', hostName: 'Ana', hostSecret: 's3cr3t' })],
      ['watchparty_user_id', 'u-1'],
      ['watchparty_last_username', 'Ana'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    });
    const { fetchMock } = mockFetchOnce({ message: 'ok' });
    await ApiService.setVideoUrl('ABC123', 'https://x/y.m3u8');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-host-secret']).toBe('s3cr3t');
    expect(headers['x-user-id']).toBe('u-1');
    expect(headers['x-user-name']).toBe('Ana');
  });

  it('no envía x-host-secret de otra sala', async () => {
    const store = new Map<string, string>([
      ['watchparty_host_session', JSON.stringify({ roomId: 'OTRA99', hostName: 'Ana', hostSecret: 's3cr3t' })],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    });
    const { fetchMock } = mockFetchOnce({ message: 'ok' });
    await ApiService.setVideoUrl('ABC123', 'https://x/y.m3u8');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers).not.toHaveProperty('x-host-secret');
  });
});
