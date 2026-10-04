/**
 * DEMO_MODE — interruptor de la demo gratuita (rama `demo-free`).
 *
 * REGLA DE ORO: deshabilitar, nunca eliminar. Todo el comportamiento de la
 * demo va tras `isDemoMode()`; con `DEMO_MODE=false` se restaura el
 * comportamiento completo original. No se añaden dependencias ni servicios.
 *
 * - Default `true` en esta rama: solo los valores explícitos
 *   `false | 0 | no | off | disabled` (insensible a mayúsculas/espacios)
 *   desactivan la demo. Variable ausente o vacía = demo activada.
 * - `isDemoMode()` lee `process.env` UNA vez (lazy) y cachea el resultado,
 *   porque se consulta en cada create/join/upload/settings. Los tests usan
 *   `resetDemoModeCache()` tras cambiar `process.env.DEMO_MODE`.
 * - `parseDemoModeValue()` es la función pura y testeable (no toca el env).
 */

export const DEMO_MAX_ROOMS = 5;
export const DEMO_MAX_USERS_PER_ROOM = 10;
export const DEMO_TIMER_MIN_MINUTES = 1;
export const DEMO_TIMER_MAX_MINUTES = 480;

/** Mensaje EXACTO al alcanzar el tope de salas (contrato con frontend). */
export const DEMO_ROOM_LIMIT_MESSAGE =
  'La demo ha alcanzado el límite de 5 salas. Intenta nuevamente más tarde.';
/** Mensaje EXACTO al intentar entrar a una sala llena (contrato con frontend). */
export const DEMO_ROOM_FULL_MESSAGE = 'Esta sala está llena.';
/** Upload deshabilitado en demo (la demo reproduce por enlace Drive). */
export const DEMO_UPLOAD_DISABLED_MESSAGE =
  'La subida de archivos está deshabilitada en la demo. Usa un enlace de video (por ejemplo, Google Drive) en su lugar.';

const DEMO_OFF_VALUES = new Set(['false', '0', 'no', 'off', 'disabled']);

/**
 * Función pura: interpreta el valor crudo de la variable de entorno.
 * `undefined`/vacío → true (default de la rama `demo-free`).
 */
export function parseDemoModeValue(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return true;
  return !DEMO_OFF_VALUES.has(normalized);
}

let cachedDemoMode: boolean | undefined;

/**
 * Override explícito (tests). Cuando está definido tiene prioridad sobre el
 * env y evita mutar `process.env` (los ficheros vitest comparten proceso y
 * mutar el env provocaría carreras entre ficheros). Producción: sin override.
 */
let demoModeOverride: boolean | undefined;

export function setDemoModeOverride(value: boolean | undefined): void {
  demoModeOverride = value;
}

/** ¿Está activa la demo? Lee el env una sola vez y cachea (ver `resetDemoModeCache`). */
export function isDemoMode(): boolean {
  if (demoModeOverride !== undefined) return demoModeOverride;
  if (cachedDemoMode === undefined) {
    cachedDemoMode = parseDemoModeValue(process.env.DEMO_MODE);
  }
  return cachedDemoMode;
}

/** Invalida la caché del flag (tests / recarga de configuración). */
export function resetDemoModeCache(): void {
  cachedDemoMode = undefined;
}
