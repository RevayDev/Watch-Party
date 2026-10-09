import type { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
}

interface ClientRecord {
  count: number;
  resetTime: number;
}

/**
 * Rate Limiter en memoria simple y ligero sin dependencias externas pesadas.
 * Controla peticiones por IP en una ventana de tiempo deslizante.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, message = 'Demasiadas solicitudes, por favor inténtalo de nuevo más tarde.' } = options;
  const hits = new Map<string, ClientRecord>();

  // Limpieza periódica cada 2 minutos
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, Math.max(windowMs, 60000)).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Si estamos en entorno de testing o sin IP, no bloquear
    if (process.env.NODE_ENV === 'test') {
      next();
      return;
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = hits.get(ip);

    if (!record || now > record.resetTime) {
      hits.set(ip, {
        count: 1,
        resetTime: now + windowMs,
      });
      next();
      return;
    }

    record.count += 1;

    if (record.count > max) {
      const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      res.status(429).json({
        error: message,
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    next();
  };
}

// ── Limitadores específicos ────────────────────────────────────────────────
// Global generoso: paraguas anti-abuso para toda la API (las rutas sensibles
// tienen sus propios límites más estrictos debajo).
export const globalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 600,
  message: 'Demasiadas solicitudes a la API, por favor inténtalo de nuevo más tarde.',
});

// Creación de salas: máximo 15 salas por minuto por IP
export const createRoomLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: 'Has alcanzado el límite de creación de salas por minuto.',
});

// Unirse a una sala: máximo 30 intentos por minuto por IP
export const joinRoomLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Has alcanzado el límite de intentos de unión a salas por minuto.',
});

// Subida de video y fijar URL: máximo 10 por minuto por IP
export const uploadVideoLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Has alcanzado el límite de subida o cambio de video por minuto.',
});

// Eliminar una sala: máximo 20 intentos por minuto por IP
export const deleteRoomLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Has alcanzado el límite de eliminación de salas por minuto.',
});

// ── Límite configurable por variables de entorno ────────────────────────────
// Formato: "max/windowMs" (ej. "30/60000" = 30 peticiones por minuto).
// Si la variable no existe o es inválida se usa el default indicado.
export function parseRateLimitEnv(
  name: string,
  defaultMax: number,
  defaultWindowMs: number
): { windowMs: number; max: number } {
  const raw = (process.env[name] || '').trim();
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(raw);
  if (!match) return { windowMs: defaultWindowMs, max: defaultMax };
  const max = Number.parseInt(match[1], 10);
  const windowMs = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(max) || max <= 0) return { windowMs: defaultWindowMs, max: defaultMax };
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) return { windowMs: defaultWindowMs, max: defaultMax };
  return { windowMs, max };
}

// Proxy de streaming: máximo 120 peticiones por minuto por IP
export const proxyLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Límite de solicitudes de streaming/proxy excedido.',
});


