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
import { logAudit } from '../payments/audit.service.js';

export const ADMIN_TOKEN_ENV = 'ADMIN_TOKEN';

export const ADMIN_NOT_CONFIGURED_MESSAGE =
  'Administración no configurada: falta ADMIN_TOKEN en el servidor.';
export const ADMIN_UNAUTHORIZED_MESSAGE = 'No autorizado: se requiere token de administrador.';
export const ADMIN_BLOCKED_MESSAGE =
  'Demasiados intentos fallidos: acceso bloqueado temporalmente.';

/** Longitud mínima del secreto admin (fuerza bruta online). */
export const ADMIN_TOKEN_MIN_LENGTH = 32;

/**
 * Fortaleza del `ADMIN_TOKEN` para el arranque:
 * - ausente → `missing` (el admin responde 503; seguro por defecto).
 * - presente pero < 32 caracteres → `weak` (adivinable online).
 * - en producción, un secreto débil impide arrancar; en desarrollo solo avisa.
 */
export function checkAdminTokenStrength(): {
  status: 'ok' | 'missing' | 'weak';
  message: string;
} {
  const token = process.env[ADMIN_TOKEN_ENV];
  if (token === undefined || token.trim() === '') {
    return {
      status: 'missing',
      message: 'ADMIN_TOKEN no configurado: /api/admin responderá 503.',
    };
  }
  if (token.length < ADMIN_TOKEN_MIN_LENGTH) {
    return {
      status: 'weak',
      message: `ADMIN_TOKEN débil (${token.length}/${ADMIN_TOKEN_MIN_LENGTH} caracteres): usa un secreto largo y aleatorio.`,
    };
  }
  return { status: 'ok', message: 'ADMIN_TOKEN configurado con longitud suficiente.' };
}

/** Lee un entero de env con default seguro. */
function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Máximos configurables (rotables sin reinicio: se leen en vivo). */
export function adminAuthLimits(): {
  maxFails: number;
  blockMs: number;
  rateMax: number;
  rateWindowMs: number;
} {
  return {
    maxFails: parseIntEnv('ADMIN_AUTH_MAX_FAILS', 10),
    blockMs: parseIntEnv('ADMIN_AUTH_BLOCK_MINUTES', 15) * 60 * 1000,
    rateMax: parseIntEnv('ADMIN_RATE_MAX', 60),
    rateWindowMs: parseIntEnv('ADMIN_RATE_WINDOW_MS', 60 * 1000),
  };
}

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
    recordAdminFail(req);
    res.status(401).json({ error: ADMIN_UNAUTHORIZED_MESSAGE });
    return;
  }
  clearAdminFails(clientIp(req));
  next();
}

// ── Bloqueo temporal tras 401s consecutivos (anti-adivinación) ──────────────

interface FailRecord {
  fails: number;
  blockedUntil: number;
}

const failRecords = new Map<string, FailRecord>();

/** Solo para tests: limpia el registro de intentos fallidos. */
export function resetAdminFailRecordsForTests(): void {
  failRecords.clear();
}

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof firstForwarded === 'string' && firstForwarded.trim() !== '') {
    return firstForwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function pruneFailRecords(): void {
  if (failRecords.size < 1000) return;
  const now = Date.now();
  for (const [ip, rec] of failRecords.entries()) {
    if (rec.blockedUntil <= now && rec.fails === 0) failRecords.delete(ip);
  }
}

function recordAdminFail(req: Request): void {
  const ip = clientIp(req);
  const { maxFails, blockMs } = adminAuthLimits();
  const rec = failRecords.get(ip) ?? { fails: 0, blockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= maxFails) {
    rec.blockedUntil = Date.now() + blockMs;
  }
  failRecords.set(ip, rec);
  pruneFailRecords();
  // Auditoría best-effort: visible en la pestaña de auditoría del panel.
  // Nunca rompe la respuesta (logAudit ya es best-effort).
  const path = `${req.method} ${req.path}`;
  void logAudit('system', 'admin.auth-failed', `IP ${ip} · ${path} (${rec.fails} fallos)`);
}

function clearAdminFails(ip: string): void {
  failRecords.delete(ip);
}

/**
 * Middleware previo a `requireAdmin`: frena con 429 a las IPs bloqueadas
 * por exceso de 401s. Un login válido limpia el contador.
 */
export function adminRateLimit(req: Request, res: Response, next: NextFunction): void {
  const rec = failRecords.get(clientIp(req));
  if (rec && rec.blockedUntil > Date.now()) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rec.blockedUntil - Date.now()) / 1000));
    res.setHeader('Retry-After', retryAfterSeconds);
    res.status(429).json({ error: ADMIN_BLOCKED_MESSAGE, retryAfter: retryAfterSeconds });
    return;
  }
  next();
}
