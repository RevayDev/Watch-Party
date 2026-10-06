import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiService } from '../src/services/api';
import {
  DEMO_MAX_ROOMS,
  DEMO_ROOM_FULL_MESSAGE,
  DEMO_ROOM_LIMIT_MESSAGE,
  DEMO_UPLOAD_DISABLED_MESSAGE,
  formatDemoAvailability,
  parseDemoModeValue,
} from '../src/shared/demo';
import { resolveJoinRejectedFeedback } from '../src/shared/utils';

/**
 * Demo gratuita (`demo-free`): flag, conteos y textos EXACTOS del backend.
 * Sin jsdom ni red: `fetch` mockeado y funciones puras.
 */
function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  const json = vi.fn(async () => payload);
  const res = { ok, status, json, headers: new Headers() } as unknown as Response;
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

describe('parseDemoModeValue (VITE_DEMO_MODE, default true en demo-free)', () => {
  it('ausente o vacío = demo activada', () => {
    expect(parseDemoModeValue(undefined)).toBe(true);
    expect(parseDemoModeValue('')).toBe(true);
    expect(parseDemoModeValue('   ')).toBe(true);
  });

  it.each(['false', 'FALSE', ' False ', '0', 'no', 'NO', 'off', 'OFF', 'disabled', 'Disabled'])(
    '"%s" desactiva la demo (vuelve al original)',
    (raw) => {
      expect(parseDemoModeValue(raw)).toBe(false);
    },
  );

  it.each(['true', 'TRUE', '1', 'yes', 'on', 'anything-else'])(
    '"%s" mantiene la demo activada',
    (raw) => {
      expect(parseDemoModeValue(raw)).toBe(true);
    },
  );
});

describe('constantes demo = texto EXACTO del backend (contrato)', () => {
  it('tope de salas', () => {
    expect(DEMO_ROOM_LIMIT_MESSAGE).toBe(
      'La demo ha alcanzado el límite de 5 salas. Intenta nuevamente más tarde.',
    );
    expect(DEMO_MAX_ROOMS).toBe(5);
  });

  it('sala llena', () => {
    expect(DEMO_ROOM_FULL_MESSAGE).toBe('Esta sala está llena.');
  });

  it('subida deshabilitada', () => {
    expect(DEMO_UPLOAD_DISABLED_MESSAGE).toBe(
      'La subida de archivos está deshabilitada en la demo. Usa un enlace de video (por ejemplo, Google Drive) en su lugar.',
    );
  });
});

describe('formatDemoAvailability', () => {
  it('"X de 5 salas en uso / Y disponibles"', () => {
    expect(formatDemoAvailability({ roomsUsed: 2, roomsTotal: 5, roomsAvailable: 3 })).toBe(
      '2 de 5 salas en uso / 3 disponibles',
    );
    expect(formatDemoAvailability({ roomsUsed: 5, roomsTotal: 5, roomsAvailable: 0 })).toBe(
      '5 de 5 salas en uso / 0 disponibles',
    );
  });
});

describe('ApiService.getDemoAvailability', () => {
  it('GET /api/demo/availability con solo conteos', async () => {
    const { fetchMock } = mockFetchOnce({ roomsUsed: 2, roomsTotal: 5, roomsAvailable: 3 });
    const out = await ApiService.getDemoAvailability();
    expect(out).toEqual({ roomsUsed: 2, roomsTotal: 5, roomsAvailable: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit?];
    expect(url).toBe('/api/demo/availability');
  });

  it('propaga el error del backend y usa genérico sin JSON útil', async () => {
    mockFetchOnce({ error: 'Rate limited' }, false, 429);
    await expect(ApiService.getDemoAvailability()).rejects.toThrow('Rate limited');

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('bad json');
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(ApiService.getDemoAvailability()).rejects.toThrow(
      'No se pudo consultar la disponibilidad de la demo',
    );
  });
});

describe('mensajes de error: se muestra err.message del backend tal cual', () => {
  it('crear sala llena → 429 con el texto EXACTO del límite', async () => {
    mockFetchOnce({ error: DEMO_ROOM_LIMIT_MESSAGE }, false, 429);
    await expect(ApiService.createRoom('Ana', true)).rejects.toThrow(DEMO_ROOM_LIMIT_MESSAGE);
  });

  it('unirse a sala llena → 429 "Esta sala está llena."', async () => {
    mockFetchOnce({ error: DEMO_ROOM_FULL_MESSAGE }, false, 429);
    await expect(ApiService.joinRoom('ABC123', 'Beto')).rejects.toThrow(DEMO_ROOM_FULL_MESSAGE);
  });
});

describe('resolveJoinRejectedFeedback con room-full (socket join-rejected)', () => {
  it("reason 'room-full' usa el mensaje EXACTO del backend cuando existe", () => {
    const fb = resolveJoinRejectedFeedback('room-full', 'Esta sala está llena.');
    expect(fb).toEqual({
      type: 'warning',
      title: 'Sala llena',
      message: 'Esta sala está llena.',
    });
  });

  it("reason 'room-full' sin mensaje usa el fallback del contrato", () => {
    expect(resolveJoinRejectedFeedback('room-full')).toEqual({
      type: 'warning',
      title: 'Sala llena',
      message: 'Esta sala está llena.',
    });
  });

  it('no cambia los casos preexistentes (banned / name-taken / genérico)', () => {
    expect(resolveJoinRejectedFeedback('banned').title).toBe('Baneado');
    expect(resolveJoinRejectedFeedback('name-taken').title).toBe('Nombre en uso');
    expect(resolveJoinRejectedFeedback('other').title).toBe('Solicitud rechazada');
    expect(resolveJoinRejectedFeedback().title).toBe('Solicitud rechazada');
  });
});
