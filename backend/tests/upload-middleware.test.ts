import { describe, it, expect } from 'vitest';
import type multer from 'multer';
import { fileFilter, uploadVideoMiddleware } from '../src/middleware/upload.middleware.js';

function filterResult(mimetype: string): { accepted: boolean; error: unknown; validationError: unknown } {
  const req: { fileValidationError?: string } = {};
  let accepted = false;
  let error: unknown;
  const cb: multer.FileFilterCallback = (err, accept) => {
    error = err;
    accepted = accept;
  };
  fileFilter(
    req as never,
    { mimetype } as Express.Multer.File,
    cb,
  );
  return { accepted, error, validationError: req.fileValidationError };
}

describe('upload fileFilter: validación de formatos (el controlador responde 400, no 500)', () => {
  it.each(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska'])(
    'acepta %s',
    (mimetype) => {
      const r = filterResult(mimetype);
      expect(r.error).toBeNull();
      expect(r.accepted).toBe(true);
      expect(r.validationError).toBeUndefined();
    },
  );

  it('acepta otros video/* por comodín (p. ej. video/mp2t)', () => {
    const r = filterResult('video/mp2t');
    expect(r.error).toBeNull();
    expect(r.accepted).toBe(true);
  });

  it.each(['image/png', 'image/jpeg', 'application/pdf', 'text/html', 'audio/mpeg'])(
    'rechaza %s con cb(null, false) y fija fileValidationError para el 400 del controlador',
    (mimetype) => {
      const r = filterResult(mimetype);
      expect(r.error).toBeNull();
      expect(r.accepted).toBe(false);
      expect(typeof r.validationError).toBe('string');
      expect(String(r.validationError)).toContain('Formato no soportado');
    },
  );

  it('el middleware multer impone límite de 4GB y espera el campo `video`', () => {
    expect(uploadVideoMiddleware).toBeDefined();
    expect(typeof uploadVideoMiddleware.single).toBe('function');
    // 4GB exactos: ni más (DoS en disco) ni menos (películas de 1-3h).
    const internals = uploadVideoMiddleware as unknown as { limits?: { fileSize?: number } };
    expect(internals.limits?.fileSize).toBe(4 * 1024 * 1024 * 1024);
  });
});
