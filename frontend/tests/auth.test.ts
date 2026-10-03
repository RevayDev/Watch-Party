import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildRestAuthHeaders,
  buildSocketAuth,
  getStoredHostSecret,
  getStoredUserId,
  getStoredUserName,
  resolveJoinRejectedFeedback,
  saveHostSession,
} from '../src/shared/utils';

/**
 * Tests puros de los helpers de auth (contrato con backend), sin jsdom:
 * se inyecta un mock mínimo de `localStorage` como en recentRooms.test.ts.
 */
function installStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const api = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  vi.stubGlobal('localStorage', api);
  return api;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  installStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getStoredHostSecret', () => {
  it('devuelve el secreto solo si la sesión es de esa sala', () => {
    installStorage({
      watchparty_host_session: JSON.stringify({ roomId: 'ABC123', hostName: 'Ana', hostSecret: 's3cr3t' }),
    });
    expect(getStoredHostSecret('ABC123')).toBe('s3cr3t');
    expect(getStoredHostSecret('abc123')).toBe('s3cr3t');
    expect(getStoredHostSecret('OTRA99')).toBeUndefined();
  });

  it('devuelve undefined sin sesión, con JSON corrupto o sin secreto', () => {
    expect(getStoredHostSecret('ABC123')).toBeUndefined();
    installStorage({ watchparty_host_session: 'no-json{{{' });
    expect(getStoredHostSecret('ABC123')).toBeUndefined();
    installStorage({
      watchparty_host_session: JSON.stringify({ roomId: 'ABC123', hostName: 'Ana' }),
    });
    expect(getStoredHostSecret('ABC123')).toBeUndefined();
  });

  it('devuelve undefined si localStorage no está disponible', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getStoredHostSecret('ABC123')).toBeUndefined();
  });
});

describe('buildSocketAuth', () => {
  it('incluye hostSecret + requester solo cuando hay valor', () => {
    installStorage({
      watchparty_host_session: JSON.stringify({ roomId: 'ABC123', hostName: 'Ana', hostSecret: 's3cr3t' }),
      watchparty_user_id: 'u-1',
    });
    expect(buildSocketAuth('ABC123', 'Ana')).toEqual({
      hostSecret: 's3cr3t',
      requesterUserId: 'u-1',
      requesterName: 'Ana',
    });
  });

  it('omite hostSecret de otra sala y requesterName vacío', () => {
    installStorage({
      watchparty_host_session: JSON.stringify({ roomId: 'OTRA99', hostName: 'Ana', hostSecret: 's3cr3t' }),
      watchparty_user_id: 'u-1',
    });
    expect(buildSocketAuth('ABC123', '   ')).toEqual({ requesterUserId: 'u-1' });
  });

  it('devuelve {} como invitado sin nada guardado', () => {
    expect(buildSocketAuth('ABC123', '')).toEqual({});
  });
});

describe('buildRestAuthHeaders', () => {
  it('envía x-host-secret / x-user-id / x-user-name cuando existen', () => {
    installStorage({
      watchparty_host_session: JSON.stringify({ roomId: 'ABC123', hostName: 'Ana', hostSecret: 's3cr3t' }),
      watchparty_user_id: 'u-1',
      watchparty_last_username: 'Ana',
    });
    expect(buildRestAuthHeaders('ABC123')).toEqual({
      'x-host-secret': 's3cr3t',
      'x-user-id': 'u-1',
      'x-user-name': 'Ana',
    });
  });

  it('no envía x-host-secret de otra sala', () => {
    installStorage({
      watchparty_host_session: JSON.stringify({ roomId: 'OTRA99', hostName: 'Ana', hostSecret: 's3cr3t' }),
    });
    const headers = buildRestAuthHeaders('ABC123');
    expect(headers).not.toHaveProperty('x-host-secret');
    expect(headers).not.toHaveProperty('x-user-id');
    expect(headers).not.toHaveProperty('x-user-name');
  });
});

describe('saveHostSession', () => {
  it('guarda roomId + hostName + hostSecret', () => {
    const api = installStorage();
    saveHostSession('ABC123', 'Ana', 's3cr3t');
    expect(JSON.parse(api.getItem('watchparty_host_session')!)).toEqual({
      roomId: 'ABC123',
      hostName: 'Ana',
      hostSecret: 's3cr3t',
    });
    expect(getStoredUserId()).toBeUndefined();
  });

  it('preserva el secreto existente si no se provee uno nuevo', () => {
    const api = installStorage({
      watchparty_host_session: JSON.stringify({ roomId: 'ABC123', hostName: 'Ana', hostSecret: 's3cr3t' }),
    });
    saveHostSession('ABC123', 'Ana Renombrada');
    expect(JSON.parse(api.getItem('watchparty_host_session')!)).toEqual({
      roomId: 'ABC123',
      hostName: 'Ana Renombrada',
      hostSecret: 's3cr3t',
    });
  });

  it('no arrastra el secreto de otra sala', () => {
    const api = installStorage({
      watchparty_host_session: JSON.stringify({ roomId: 'OTRA99', hostName: 'Ana', hostSecret: 's3cr3t' }),
    });
    saveHostSession('ABC123', 'Ana');
    expect(JSON.parse(api.getItem('watchparty_host_session')!)).toEqual({
      roomId: 'ABC123',
      hostName: 'Ana',
    });
  });
});

describe('getStoredUserId / getStoredUserName', () => {
  it('leen sus claves y devuelven undefined si faltan', () => {
    expect(getStoredUserId()).toBeUndefined();
    expect(getStoredUserName()).toBeUndefined();
    installStorage({ watchparty_user_id: 'u-7', watchparty_last_username: 'Beto' });
    expect(getStoredUserId()).toBe('u-7');
    expect(getStoredUserName()).toBe('Beto');
  });
});

describe('resolveJoinRejectedFeedback', () => {
  it("reason 'name-taken' usa el flujo de rechazo con mensaje propio", () => {
    const fb = resolveJoinRejectedFeedback('name-taken', undefined);
    expect(fb.type).toBe('warning');
    expect(fb.title).toBe('Nombre en uso');
    expect(fb.message).toMatch(/ya está en uso/);
  });

  it("respeta el mensaje del servidor cuando viene con 'name-taken'", () => {
    const fb = resolveJoinRejectedFeedback('name-taken', 'Nombre duplicado (server)');
    expect(fb.message).toBe('Nombre duplicado (server)');
    expect(fb.title).toBe('Nombre en uso');
  });

  it("mantiene el flujo existente para 'banned' y otros rechazos", () => {
    expect(resolveJoinRejectedFeedback('banned', undefined)).toEqual({
      type: 'error',
      title: 'Baneado',
      message: 'Has sido baneado de esta sala.',
    });
    const other = resolveJoinRejectedFeedback('rejected', undefined);
    expect(other).toEqual({
      type: 'warning',
      title: 'Solicitud rechazada',
      message: 'Tu solicitud para unirte fue rechazada.',
    });
    const custom = resolveJoinRejectedFeedback('rejected', 'Sala llena');
    expect(custom.message).toBe('Sala llena');
  });
});
