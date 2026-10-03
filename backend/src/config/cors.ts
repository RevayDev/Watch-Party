import type { CorsOptions } from 'cors';

/**
 * Obtiene la lista de orígenes permitidos según variables de entorno y entorno de ejecución.
 * Soporta CLIENT_URL, ALLOWED_ORIGINS (separados por coma) y orígenes de desarrollo/LAN.
 */
export function getAllowedOrigins(): string[] | '*' {
  const clientUrl = process.env.CLIENT_URL?.trim();
  const envOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  const explicitOrigins = new Set<string>();
  if (clientUrl) explicitOrigins.add(clientUrl.replace(/\/$/, ''));
  for (const o of envOrigins) {
    explicitOrigins.add(o.replace(/\/$/, ''));
  }

  // En producción estricta con orígenes declarados
  if (process.env.NODE_ENV === 'production' && explicitOrigins.size > 0) {
    return Array.from(explicitOrigins);
  }

  // En desarrollo o si no hay configuración estricta, permitir localhost y orígenes comunes
  const devDefaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://localhost:4000',
  ];

  for (const d of devDefaults) {
    explicitOrigins.add(d);
  }

  return Array.from(explicitOrigins);
}

/**
 * Validador dinámico de origen para CORS Express y Socket.IO
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // Permite llamadas locales / server-to-server / curl
  const allowed = getAllowedOrigins();
  if (allowed === '*') return true;
  
  const cleanOrigin = origin.replace(/\/$/, '');
  if (allowed.includes(cleanOrigin)) return true;

  // En modo desarrollo permitir IPs de red local (192.168.x.x, 10.x.x.x, etc.)
  if (process.env.NODE_ENV !== 'production') {
    if (
      /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(
        cleanOrigin
      )
    ) {
      return true;
    }
  }

  return false;
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origen no permitido por CORS: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Range',
    'x-host-secret',
    'x-user-id',
    'x-user-name',
  ],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
};
