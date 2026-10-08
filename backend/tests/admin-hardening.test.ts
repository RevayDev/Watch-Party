/**
 * Endurecimiento del `/api/admin` (ADMIN_HARDENING_PLAN.md):
 * bloqueo tras 401s, auditoría de fallos y secreto fuerte al arrancar.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  requireAdmin,
  adminRateLimit,
  checkAdminTokenStrength,
  resetAdminFailRecordsForTests,
  ADMIN_BLOCKED_MESSAGE,
} from '../src/middleware/requireAdmin.js';
import { listAuditLogs } from '../src/payments/audit.service.js';

const STRONG_TOKEN = '0123456789abcdef0123456789abcdef'; // 32 caracteres

const savedEnv = { ...process.env };

interface MockRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, unknown>;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  setHeader: (k: string, v: unknown) => void;
}

function mockReq(ip: string, token?: string) {
  return {
    ip,
    socket: {},
    method: 'GET',
    path: '/api/admin/summary',
    headers: token ? ({ 'x-admin-token': token } as Record<string, string>) : {},
  } as never;
}

function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader: (k: string, v: unknown) => {
      res.headers[k] = v;
    },
    status: (code: number) => {
      res.statusCode = code;
      return res;
    },
    json: (payload: unknown) => {
      res.body = payload;
      return res;
    },
  };
  return res;
}

/** Simula la cadena Express: adminRateLimit -> requireAdmin. */
function attempt(ip: string, token?: string): MockRes {
  const res = mockRes();
  let continued = false;
  adminRateLimit(mockReq(ip, token), res, () => {
    continued = true;
  });
  if (!continued) return res;
  const res2 = mockRes();
  let nextCalled = false;
  requireAdmin(mockReq(ip, token), res2, () => {
    nextCalled = true;
  });
  return nextCalled ? { ...res2, statusCode: 200 } : res2;
}

beforeEach(() => {
  process.env = { ...savedEnv };
  process.env.ADMIN_TOKEN = STRONG_TOKEN;
  delete process.env.ADMIN_AUTH_MAX_FAILS;
  delete process.env.ADMIN_AUTH_BLOCK_MINUTES;
  resetAdminFailRecordsForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...savedEnv };
  resetAdminFailRecordsForTests();
});

describe('bloqueo tras 401s consecutivos', () => {
  it('10 tokens malos → 401; el 11º → 429 con Retry-After', () => {
    for (let i = 0; i < 10; i++) {
      expect(attempt('9.9.9.9', 'malo').statusCode).toBe(401);
    }
    const blocked = attempt('9.9.9.9', 'malo');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toMatchObject({ error: ADMIN_BLOCKED_MESSAGE });
    expect(blocked.headers['Retry-After']).toBeDefined();
  });

  it('un login válido limpia el contador de la IP', () => {
    for (let i = 0; i < 9; i++) {
      expect(attempt('9.9.9.9', 'malo').statusCode).toBe(401);
    }
    expect(attempt('9.9.9.9', STRONG_TOKEN).statusCode).toBe(200);
    // El contador se reinició: 9 fallos más no bloquean.
    for (let i = 0; i < 9; i++) {
      expect(attempt('9.9.9.9', 'malo').statusCode).toBe(401);
    }
    expect(attempt('9.9.9.9', 'malo').statusCode).toBe(401);
  });

  it('el bloqueo es por IP: otra IP no afectada', () => {
    for (let i = 0; i < 10; i++) {
      attempt('9.9.9.9', 'malo');
    }
    expect(attempt('9.9.9.9', 'malo').statusCode).toBe(429);
    expect(attempt('8.8.8.8', 'malo').statusCode).toBe(401);
  });

  it('respeta ADMIN_AUTH_MAX_FAILS configurable', () => {
    process.env.ADMIN_AUTH_MAX_FAILS = '3';
    for (let i = 0; i < 3; i++) {
      expect(attempt('7.7.7.7', 'malo').statusCode).toBe(401);
    }
    expect(attempt('7.7.7.7', 'malo').statusCode).toBe(429);
  });
});

describe('auditoría de intentos fallidos', () => {
  it('los 401 aparecen en el audit log con IP y ruta', async () => {
    attempt('9.9.9.10', 'malo');
    await new Promise((r) => setTimeout(r, 50));
    const entries = await listAuditLogs({ action: 'admin.auth-failed', limit: 50 });
    const mine = entries.filter((e) => (e.detail ?? '').includes('9.9.9.10'));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].detail).toContain('/api/admin/summary');
  });
});

describe('fortaleza del secreto al arrancar', () => {
  it('ausente → missing (el admin responde 503, sin bloquear arranque)', () => {
    delete process.env.ADMIN_TOKEN;
    expect(checkAdminTokenStrength().status).toBe('missing');
  });

  it('corto (<32) → weak', () => {
    process.env.ADMIN_TOKEN = 'corto';
    const check = checkAdminTokenStrength();
    expect(check.status).toBe('weak');
    expect(check.message).toContain('32');
  });

  it('31 caracteres → weak; 32 → ok', () => {
    process.env.ADMIN_TOKEN = 'x'.repeat(31);
    expect(checkAdminTokenStrength().status).toBe('weak');
    process.env.ADMIN_TOKEN = 'x'.repeat(32);
    expect(checkAdminTokenStrength().status).toBe('ok');
  });
});
