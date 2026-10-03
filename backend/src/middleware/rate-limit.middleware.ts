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
// Creación de salas: máximo 15 salas por minuto por IP
export const createRoomLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: 'Has alcanzado el límite de creación de salas por minuto.',
});

// Subida de video y fijar URL: máximo 10 por minuto por IP
export const uploadVideoLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Has alcanzado el límite de subida o cambio de video por minuto.',
});

// Proxy de streaming: máximo 120 peticiones por minuto por IP
export const proxyLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Límite de solicitudes de streaming/proxy excedido.',
});
