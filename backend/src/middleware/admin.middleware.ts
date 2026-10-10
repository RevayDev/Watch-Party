import type { Request, Response, NextFunction } from 'express';

/**
 * Autenticación del panel admin (docs/admin-panel-spotify.md §1.2).
 * Compara el secreto contra `ADMIN_TOKEN` del servidor (leído por petición
 * para que los tests puedan fijarlo sin recargar el módulo).
 *
 * Acepta `x-admin-token: <token>` o `Authorization: Bearer <token>`.
 * Sin token configurado en el servidor → 503 (el panel no existe).
 */
export function adminTokenOf(req: Request): string | null {
  const fromHeader = req.headers['x-admin-token'];
  const rawHeader = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  if (typeof rawHeader === 'string' && rawHeader.trim()) return rawHeader.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  return null;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = (process.env.ADMIN_TOKEN || '').trim();
  if (!expected) {
    res.status(503).json({ error: 'El panel de administración no está configurado en este servidor.' });
    return;
  }
  const provided = adminTokenOf(req);
  if (!provided || provided !== expected) {
    res.status(401).json({ error: 'Token de administrador inválido o ausente.' });
    return;
  }
  next();
}
