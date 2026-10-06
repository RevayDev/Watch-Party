/**
 * requireAdmin — base de autenticación para futuros `/api/admin/*`.
 *
 * - Acepta el token por `x-admin-token: <token>` o
 *   `Authorization: Bearer <token>` (ambos, sin preferencia).
 * - Compara contra `ADMIN_TOKEN` del env con `crypto.timingSafeEqual` sobre
 *   hashes SHA-256 (longitud fija: evita la excepción por longitudes
 *   distintas y el timing-oracle sobre el secreto en claro).
 * - Sin `ADMIN_TOKEN` configurado → `503` con mensaje claro (no es un 401:
 *   el problema es de configuración del servidor, no de credenciales).
 * - Token ausente o inválido → `401` (sin detallar cuál de los dos falló).
 * - El env se lee EN VIVO en cada petición (sin caché): permite rotar el
 *   token sin reiniciar y evita carreras en tests.
 * - Alcance de ESTA fase: solo el middleware + tests. Las rutas
 *   `/api/admin/*` las crean pagos/testing SOBRE este middleware.
 */

import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const ADMIN_TOKEN_ENV = 'ADMIN_TOKEN';

export const ADMIN_NOT_CONFIGURED_MESSAGE =
  'Administración no configurada: falta ADMIN_TOKEN en el servidor.';
export const ADMIN_UNAUTHORIZED_MESSAGE = 'No autorizado: se requiere token de administrador.';

/** ¿Hay token admin configurado? (env no vacío). */
export function isAdminConfigured(): boolean {
  const token = process.env[ADMIN_TOKEN_ENV];
  return token !== undefined && token.trim() !== '';
}

/** Extrae el token candidato de `x-admin-token` o `Authorization: Bearer`. */
export function extractAdminToken(req: Request): string | null {
  const header = req.headers['x-admin-token'];
  const rawHeader = Array.isArray(header) ? header[0] : header;
  if (typeof rawHeader === 'string' && rawHeader.trim() !== '') {
    return rawHeader.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match && match[1].trim() !== '') return match[1].trim();
  }
  return null;
}

function sha256Hex(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

/** Comparación timing-safe (hashes de longitud fija, nunca el secreto). */
export function isValidAdminToken(candidate: string, expected: string): boolean {
  const a = sha256Hex(candidate);
  const b = sha256Hex(expected);
  return crypto.timingSafeEqual(a, b);
}

/**
 * Guard Express para `/api/admin/*`.
 * 503 sin token configurado · 401 sin token válido · `next()` si OK.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env[ADMIN_TOKEN_ENV];
  if (expected === undefined || expected.trim() === '') {
    res.status(503).json({ error: ADMIN_NOT_CONFIGURED_MESSAGE });
    return;
  }
  const candidate = extractAdminToken(req);
  if (candidate === null || !isValidAdminToken(candidate, expected)) {
    res.status(401).json({ error: ADMIN_UNAUTHORIZED_MESSAGE });
    return;
  }
  next();
}
