import type { CorsOptions } from 'cors';

let warnedMissingClientUrl = false;

/**
 * Avisa una sola vez si CLIENT_URL no está definido: en ese caso se conserva
 * la apertura actual de desarrollo (localhost + LAN) en vez de una allowlist
 * estricta. Sin efectos en el comportamiento, solo visibilidad en logs.
 */
function warnIfClientUrlMissingOnce(): void {
  if (warnedMissingClientUrl) return;
  if (!process.env.CLIENT_URL?.trim()) {
    warnedMissingClientUrl = true;
    console.warn(
      '⚠️ CLIENT_URL no está definido: CORS conserva la apertura actual de desarrollo (localhost/LAN). Define CLIENT_URL en producción.'
    );
  }
}

/**
 * Obtiene la lista de orígenes permitidos según variables de entorno y entorno de ejecución.
 * Soporta CLIENT_URL, ALLOWED_ORIGINS (separados por coma) y orígenes de desarrollo.
 *
 * DECISIÓN DE ALLOWLIST (auditoría 2026-10-04, sin cambios funcionales en rooms/chat/sync):
 * - Orígenes reales del proyecto: `CLIENT_URL` (prod en Vercel; ver backend/.env.example
 *   y README "Guía de Despliegue"), más `http://localhost:5173` y `http://127.0.0.1:5173`
 *   en desarrollo (frontend/vite.config.ts sirve en el puerto 5173 y proxea /api y
 *   /uploads a http://localhost:4000, así que el REST de dev es mismo-origen).
 * - `http://localhost:3000` y `http://localhost:4000` se ELIMINARON de los defaults:
 *   ningún fichero del proyecto los usa como Origin (el 4000 es el propio servidor,
 *   que no sirve páginas; el frontend nunca corre en el 3000). Búsqueda: 0 refs.
 * - La apertura LAN (192.168/10/172.16-31, solo NO-producción) se CONSERVA a propósito:
 *   vite.config.ts usa `host: true` y frontend/socket.ts conecta a
 *   `http://<hostname>:4000` (IP LAN al probar desde el móvil), así que el Origin
 *   en ese caso es `http://<IP-LAN>:5173`. Eliminarla rompería el dev en móvil.
 *   En producción la LAN nunca se permite y solo entran CLIENT_URL/ALLOWED_ORIGINS.
 * - `credentials: true` se MANTIENE en Express (corsOptions) y Socket.IO (server.ts):
 *   hoy el proyecto NO usa cookies/sesiones (auth por cabeceras x-host-secret /
 *   x-user-id / x-user-name + localStorage; el frontend envía `withCredentials: false`
 *   y ningún fetch/XHR usa `credentials: 'include'`), así que mantenerlo no abre
 *   nada nuevo y preserva compatibilidad si el frontend credentialed cambia.
 */
export function getAllowedOrigins(): string[] | '*' {
  warnIfClientUrlMissingOnce();
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

  // En desarrollo o si no hay configuración estricta, permitir los orígenes
  // locales reales del proyecto (Vite en 5173). Sin 3000/4000: sin uso
  // evidenciado como Origin (ver comentario de decisión arriba).
  const devDefaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
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

  // En modo desarrollo permitir loopback exacto del proyecto (Vite en 5173)
  // e IPs de red local con puerto flexible (dev en móvil: vite `host:true` y
  // socket a `http://<hostname>:4000`; el puerto de Vite puede autonumerarse
  // si el 5173 está ocupado → para eso existe ALLOWED_ORIGINS como escape).
  // localhost/127.0.0.1 con OTRO puerto (3000/4000/…) se rechazan: sin uso
  // evidenciado como Origin en este proyecto.
  if (process.env.NODE_ENV !== 'production') {
    if (/^https?:\/\/(localhost|127\.0\.0\.1):5173$/.test(cleanOrigin)) {
      return true;
    }
    if (
      /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(
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
