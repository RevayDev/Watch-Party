import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { errorHandler } from '../src/middleware/error.middleware.js';

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((payload: unknown) => {
    res.body = payload;
    return res;
  });
  return res;
}

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errorHandler: errores de subida (400) vs internos (500)', () => {
  it('MulterError (p. ej. LIMIT_FILE_SIZE) → 400 con el mensaje del error', () => {
    const res = mockRes();
    const err = Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' });
    errorHandler(err, {} as never, res as never, (() => {}) as never);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'File too large' });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('código LIMIT_* aunque el nombre no sea MulterError → 400', () => {
    const res = mockRes();
    const err = Object.assign(new Error('Too many files'), { code: 'LIMIT_FILE_COUNT' });
    errorHandler(err, {} as never, res as never, (() => {}) as never);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'Too many files' });
  });

  it('error genérico → 500 con forma {error, message} y log interno', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), {} as never, res as never, (() => {}) as never);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'Internal server error', message: 'boom' });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('error genérico sin mensaje → 500 con mensaje por defecto (sin filtrar nada)', () => {
    const res = mockRes();
    errorHandler(new Error(), {} as never, res as never, (() => {}) as never);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'Internal server error' });
  });
});
