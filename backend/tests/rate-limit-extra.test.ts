import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createRateLimiter,
  parseRateLimitEnv,
  checkoutLimiter,
  redeemLimiter,
  webhookLimiter,
} from '../src/middleware/rate-limit.middleware.js';

const savedNodeEnv = process.env.NODE_ENV;

interface MockHttp {
  req: { ip?: string; socket: { remoteAddress?: string } };
  res: {
    statusCode: number;
    body: unknown;
    headers: Record<string, unknown>;
    setHeader: (k: string, v: unknown) => void;
    status: (code: number) => MockHttp['res'];
    json: (payload: unknown) => MockHttp['res'];
  };
  next: () => void;
}

function mockHttp(ip?: string, remoteAddress?: string): MockHttp {
  const res: MockHttp['res'] = {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader: vi.fn((k: string, v: unknown) => {
      res.headers[k] = v;
    }),
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
  };
  return {
    req: { ...(ip !== undefined ? { ip } : {}), socket: { ...(remoteAddress ? { remoteAddress } : {}) } },
    res,
    next: vi.fn(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  // Los limitadores HTTP se desactivan con NODE_ENV=test: se fuerza otro
  // entorno para ejercitarlos (igual que rate-limit.test.ts).
  process.env.NODE_ENV = 'development';
});

afterEach(() => {
  process.env.NODE_ENV = savedNodeEnv;
  vi.restoreAllMocks();
});

describe('rate-limit HTTP: casos borde del paraguas anti-abuso', () => {
  it('en NODE_ENV=test no bloquea (bypass de infraestructura de test)', () => {
    process.env.NODE_ENV = 'test';
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    const first = mockHttp('5.5.5.5');
    limiter(first.req as never, first.res as never, first.next as never);
    const second = mockHttp('5.5.5.5');
    limiter(second.req as never, second.res as never, second.next as never);
    expect(second.next).toHaveBeenCalledTimes(1);
    expect(second.res.statusCode).toBe(200);
  });

  it('429 con forma {error, retryAfter} + cabecera Retry-After numérica', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, message: 'límite auth' });
    const a = mockHttp('6.6.6.6');
    limiter(a.req as never, a.res as never, a.next as never);
    limiter(a.req as never, a.res as never, a.next as never);
    const blocked = mockHttp('6.6.6.6');
    limiter(blocked.req as never, blocked.res as never, blocked.next as never);
    expect(blocked.res.statusCode).toBe(429);
    expect(blocked.res.body).toMatchObject({ error: 'límite auth', retryAfter: expect.any(Number) });
    expect(blocked.res.headers['Retry-After']).toEqual(expect.any(Number));
    expect(blocked.next).not.toHaveBeenCalled();
  });

  it('mensaje por defecto cuando no se configura (no filtra detalles internos)', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    const m = mockHttp('7.7.7.7');
    limiter(m.req as never, m.res as never, m.next as never);
    limiter(m.req as never, m.res as never, m.next as never);
    expect(m.res.body).toMatchObject({
      error: 'Demasiadas solicitudes, por favor inténtalo de nuevo más tarde.',
    });
  });

  it('sin req.ip usa socket.remoteAddress; sin ambos, comparte cubo `unknown`', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    const viaSocket = mockHttp(undefined, '8.8.8.8');
    limiter(viaSocket.req as never, viaSocket.res as never, viaSocket.next as never);
    expect(viaSocket.next).toHaveBeenCalledTimes(1);
    const viaSocketAgain = mockHttp(undefined, '8.8.8.8');
    limiter(viaSocketAgain.req as never, viaSocketAgain.res as never, viaSocketAgain.next as never);
    expect(viaSocketAgain.res.statusCode).toBe(429);

    const unknown1 = mockHttp();
    limiter(unknown1.req as never, unknown1.res as never, unknown1.next as never);
    expect(unknown1.next).toHaveBeenCalledTimes(1);
    const unknown2 = mockHttp();
    limiter(unknown2.req as never, unknown2.res as never, unknown2.next as never);
    expect(unknown2.res.statusCode).toBe(429);
  });

  it('al expirar la ventana el cupo se renueva', async () => {
    const limiter = createRateLimiter({ windowMs: 20, max: 1 });
    const m = mockHttp('9.9.9.9');
    limiter(m.req as never, m.res as never, m.next as never);
    expect(m.next).toHaveBeenCalledTimes(1);
    await sleep(60);
    const m2 = mockHttp('9.9.9.9');
    limiter(m2.req as never, m2.res as never, m2.next as never);
    expect(m2.next).toHaveBeenCalledTimes(1);
    expect(m2.res.statusCode).toBe(200);
  });
});

describe('rate-limit de pagos: parseo por entorno y limitadores', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('parseRateLimitEnv acepta "max/windowMs" y cae a defaults si es inválido', () => {
    process.env.X_TMP_LIMIT = '30/60000';
    expect(parseRateLimitEnv('X_TMP_LIMIT', 5, 1000)).toEqual({ windowMs: 60000, max: 30 });
    process.env.X_TMP_LIMIT = 'basura';
    expect(parseRateLimitEnv('X_TMP_LIMIT', 5, 1000)).toEqual({ windowMs: 1000, max: 5 });
    process.env.X_TMP_LIMIT = '0/60000';
    expect(parseRateLimitEnv('X_TMP_LIMIT', 5, 1000)).toEqual({ windowMs: 1000, max: 5 });
    delete process.env.X_TMP_LIMIT;
    expect(parseRateLimitEnv('X_TMP_LIMIT', 5, 1000)).toEqual({ windowMs: 1000, max: 5 });
  });

  it('checkout/redeem/webhook tienen limitadores definidos (no agresivos por defecto)', () => {
    for (const limiter of [checkoutLimiter, redeemLimiter, webhookLimiter]) {
      expect(typeof limiter).toBe('function');
      const m = mockHttp('10.20.30.40');
      limiter(m.req as never, m.res as never, m.next as never);
      expect(m.next).toHaveBeenCalledTimes(1);
      expect(m.res.statusCode).toBe(200);
    }
  });
});
