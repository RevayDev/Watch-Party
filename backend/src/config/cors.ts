import type { CorsOptions } from 'cors';

let warnedMissingClientUrl = false;

/** Solo para tests: el aviso es warn-once y el flag es estado de módulo. */
export function resetCorsWarningsForTests(): void {
  warnedMissingClientUrl = false;
}

/**
 * Avisa una sola vez si CLIENT_URL no está definido: en ese caso no hay
 * allowlist estricta de producción y se usan los orígenes de desarrollo.
 * Sin efectos en el comportamiento, solo visibilidad en logs.
 */
function warnIfClientUrlMissingOnce(): void {
  if (warnedMissingClientUrl) return;
  if (!process.env.CLIENT_URL?.trim()) {
    warnedMissingClientUrl = true;
    console.warn(
      '⚠️ CLIENT_URL no está definido: CORS usa orígenes de desarrollo. Define CLIENT_URL en producción.'
    );
  }
}

/**
 * Orígenes explícitos desde entorno. Acepta entradas exactas
 * (`https://mi-app.vercel.app`) y comodines controlados (`*.vercel.app`).
 * Los comodines solo se usan para dominios conocidos (ver `matchesAllowed`).
 */
export function getExplicitOrigins(): string[] {
  warnIfClientUrlMissingOnce();
  const out = new Set<string>();
  const clientUrl = process.env.CLIENT_URL?.trim();
  if (clientUrl) out.add(clientUrl.replace(/\/$/, ''));
  const extra = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  for (const o of extra) out.add(o.replace(/\/$/, ''));
  return Array.from(out);
}

/** Puertos loopback de desarrollo del proyecto (Vite dev 5173, preview 4173). */
const DEV_LOOPBACK_PORTS = ['5173', '4173'];

/** ¿Está habilitada la red local como flujo de dev (móvil por IP)? */
export function isLanDevEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.ALLOW_LAN_DEV !== 'false';
}

/**
 * Lista de orígenes permitidos según entorno (para inspección/tests).
 * En producción estricta con orígenes declarados: solo esos.
 * En desarrollo: + loopback 5173/4173 (+ LAN si ALLOW_LAN_DEV).
 */
export function getAllowedOrigins(): string[] | '*' {
  const explicit = getExplicitOrigins();
  if (process.env.NODE_ENV === 'production' && explicit.length > 0) {
    return explicit;
  }
  const all = new Set<string>(explicit);
  for (const port of DEV_LOOPBACK_PORTS) {
    all.add(`http://localhost:${port}`);
    all.add(`http://127.0.0.1:${port}`);
  }
  return Array.from(all);
}

function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Comodín controlado: la entrada debe ser `*.sufijo` y el origen `https`
 * con un subdominio real bajo ese sufijo. Ej: `*.vercel.app` acepta
 * `https://mi-app-abc123.vercel.app` (previews por PR) y rechaza
 * `http://…`, `https://evil-vercel.app` o `https://x.vercel.app.evil.com`.
 */
function matchesWildcard(entry: string, origin: string): boolean {
  if (!entry.startsWith('*.')) return false;
  const suffix = entry.slice(1).toLowerCase(); // ".vercel.app"
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const leader = url.hostname.toLowerCase();
  return leader.length > suffix.length && leader.endsWith(suffix);
}

function matchesAllowed(origin: string, allowed: string[]): boolean {
  const cleanOrigin = origin.replace(/\/$/, '');
  if (allowed.includes(cleanOrigin)) return true;
  return allowed.some((entry) => matchesWildcard(entry, cleanOrigin));
}

/**
 * Validador de origen para CORS Express y Socket.IO.
 *
 * Matriz real (verificada en código):
 * - Prod + CLIENT_URL/ALLOWED_ORIGINS → exactos + comodines `*.` (cubre
 *   dominio custom www/apex y previews `https://*.vercel.app`).
 * - Dev misma máquina → loopback :5173/:4173 (Vite dev y `vite preview`,
 *   cuyo build usa VITE_API_URL contra el backend remoto).
 * - Dev móvil/LAN (flujo oficial, `vite leader:true` + socket a
 *   `http://<hostname>:4000`) → IP privada, solo no-producción y solo si
 *   ALLOW_LAN_DEV no es 'false'. En producción la LAN nunca entra.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // curl / server-to-server sin Origin
  const allowed = getAllowedOrigins();
  if (allowed === '*') return true;
  if (matchesAllowed(origin, allowed)) return true;

  if (process.env.NODE_ENV !== 'production') {
    const leader = hostnameOf(origin);
    const port = (() => {
      try {
        return new URL(origin).port;
      } catch {
        return '';
      }
    })();
    const isLoopback =
      (leader === 'localhost' || leader === '127.0.0.1') && DEV_LOOPBACK_PORTS.includes(port);
    if (isLoopback) return true;
    if (
      isLanDevEnabled() &&
      leader !== null &&
      /^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/.test(leader)
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
    'x-leader-secret',
    'x-user-id',
    'x-user-name',
  ],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
};
