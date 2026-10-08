/**
 * Demo gratuita (`demo-free`): interruptor visual + contrato con el backend.
 *
 * REGLA DE ORO: deshabilitar, nunca eliminar. Todo lo visual de la demo va
 * tras `isDemoMode()`; con `VITE_DEMO_MODE=false` se restaura el
 * comportamiento completo original. Sin dependencias ni endpoints nuevos
 * (solo se consume `GET /api/demo/availability`, ya implementado en backend).
 *
 * - Default `true` en esta rama: solo los valores explícitos
 *   `false | 0 | no | off | disabled` (insensible a mayúsculas/espacios)
 *   desactivan la demo. Variable ausente o vacía = demo activada.
 * - Los mensajes son el TEXTO EXACTO del backend (contrato): si el backend
 *   responde `err.message`, ese texto manda; estas constantes son el fallback
 *   cuando no hay mensaje del servidor.
 */

export const DEMO_MAX_ROOMS = 5;
export const DEMO_MAX_USERS_PER_ROOM = 5;
/** Cupo de salas premium (debe coincidir con PREMIUM_ROOM_MAX_USERS del backend). */
export const PREMIUM_MAX_USERS_PER_ROOM = 10;

/** Mensaje EXACTO al alcanzar el tope de salas (contrato con backend). */
export const DEMO_ROOM_LIMIT_MESSAGE =
  'La demo ha alcanzado el límite de 5 salas. Intenta nuevamente más tarde.';
/** Mensaje EXACTO al intentar entrar a una sala llena (contrato con backend). */
export const DEMO_ROOM_FULL_MESSAGE = 'Esta sala está llena.';
/** Upload deshabilitado en demo (la demo reproduce por enlace Drive). */
export const DEMO_UPLOAD_DISABLED_MESSAGE =
  'La subida de archivos está deshabilitada en la demo. Usa un enlace de video (por ejemplo, Google Drive) en su lugar.';

const DEMO_OFF_VALUES = new Set(['false', '0', 'no', 'off', 'disabled']);

/** Función pura: interpreta el valor crudo de `VITE_DEMO_MODE` (testeable). */
export function parseDemoModeValue(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return true;
  return !DEMO_OFF_VALUES.has(normalized);
}

/** ¿Está activa la demo? Default `true` en la rama `demo-free`. */
export function isDemoMode(): boolean {
  return parseDemoModeValue(import.meta.env.VITE_DEMO_MODE as string | undefined);
}

export interface DemoAvailability {
  roomsUsed: number;
  roomsTotal: number;
  roomsAvailable: number;
}

/**
 * Texto del contador del Home.
 * Formato del contrato: "X de 5 salas en uso / Y disponibles".
 */
export function formatDemoAvailability(a: DemoAvailability): string {
  return `${a.roomsUsed} de ${a.roomsTotal} salas en uso / ${a.roomsAvailable} disponibles`;
}
