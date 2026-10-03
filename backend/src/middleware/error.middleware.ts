import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Multer rejection errors (file too large, too many files, etc.) are client
  // errors → 400. MulterError carries `code` (e.g. LIMIT_FILE_SIZE).
  const code = (err as unknown as { code?: string }).code;
  const isMulterError =
    err?.name === 'MulterError' || (typeof code === 'string' && code.startsWith('LIMIT_'));
  if (isMulterError) {
    res.status(400).json({ error: err.message || 'Error al subir el archivo' });
    return;
  }

  console.error('⚠️ Unhandled Server Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message || 'Something went wrong',
  });
}
