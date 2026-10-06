import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ADMIN_NOT_CONFIGURED_MESSAGE,
  ADMIN_UNAUTHORIZED_MESSAGE,
  extractAdminToken,
  isAdminConfigured,
  isValidAdminToken,
  requireAdmin,
} from '../src/middleware/requireAdmin.js';

const ENV_KEY = 'ADMIN_TOKEN';
let savedToken: string | undefined;

beforeEach(() => {
  savedToken = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  vi.restoreAllMocks();
});

function restoreEnv(): void {
  if (savedToken === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedToken;
}

function mockRes() {
  const res: { statusCode: number; body: unknown; status: (c: number) => unknown; json: (b: unknown) => unknown } = {
    statusCode: 200,
    body: undefined,
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

function mockReq(headers: Record<string, unknown> = {}) {
  return { headers };
}

describe('requireAdmin (base para /api/admin/*)', () => {
  it('sin ADMIN_TOKEN → 503 con mensaje claro (no 401)', () => {
    try {
      expect(isAdminConfigured()).toBe(false);
      const res = mockRes();
      const next = vi.fn();
      requireAdmin(mockReq() as never, res as never, next);
      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ error: ADMIN_NOT_CONFIGURED_MESSAGE });
      expect(next).not.toHaveBeenCalled();
    } finally {
      restoreEnv();
    }
  });

  it('ADMIN_TOKEN vacío/espacios también es "no configurado"', () => {
    process.env[ENV_KEY] = '   ';
    try {
      expect(isAdminConfigured()).toBe(false);
      const res = mockRes();
      requireAdmin(mockReq() as never, res as never, vi.fn());
      expect(res.statusCode).toBe(503);
    } finally {
      restoreEnv();
    }
  });

  it('con token configurado: sin credencial → 401', () => {
    process.env[ENV_KEY] = 'secreto';
    try {
      const res = mockRes();
      const next = vi.fn();
      requireAdmin(mockReq() as never, res as never, next);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: ADMIN_UNAUTHORIZED_MESSAGE });
      expect(next).not.toHaveBeenCalled();
    } finally {
      restoreEnv();
    }
  });

  it('token erróneo → 401; correcto por x-admin-token o Bearer → next()', () => {
    process.env[ENV_KEY] = 'secreto';
    try {
      const bad = mockRes();
      const nextBad = vi.fn();
      requireAdmin(mockReq({ 'x-admin-token': 'otro' }) as never, bad as never, nextBad);
      expect(bad.statusCode).toBe(401);
      expect(nextBad).not.toHaveBeenCalled();

      const viaHeader = mockRes();
      const nextHeader = vi.fn();
      requireAdmin(mockReq({ 'x-admin-token': 'secreto' }) as never, viaHeader as never, nextHeader);
      expect(nextHeader).toHaveBeenCalledTimes(1);

      const viaBearer = mockRes();
      const nextBearer = vi.fn();
      requireAdmin(
        mockReq({ authorization: 'Bearer secreto' }) as never,
        viaBearer as never,
        nextBearer
      );
      expect(nextBearer).toHaveBeenCalledTimes(1);
    } finally {
      restoreEnv();
    }
  });

  it('extractAdminToken: prioriza x-admin-token; Bearer case-insensitive', () => {
    expect(extractAdminToken(mockReq({}) as never)).toBeNull();
    expect(extractAdminToken(mockReq({ authorization: 'bearer abc' }) as never)).toBe('abc');
    expect(extractAdminToken(mockReq({ authorization: 'Token abc' }) as never)).toBeNull();
    expect(
      extractAdminToken(mockReq({ 'x-admin-token': 'h', authorization: 'Bearer b' }) as never)
    ).toBe('h');
  });

  it('comparación timing-safe: igual/diferente sin distinguir motivo', () => {
    expect(isValidAdminToken('a', 'a')).toBe(true);
    expect(isValidAdminToken('a', 'b')).toBe(false);
    expect(isValidAdminToken('corto', 'mucho-mas-largo-que-el-otro')).toBe(false);
  });
});
