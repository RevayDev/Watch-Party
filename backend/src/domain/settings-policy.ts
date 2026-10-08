import type { IRoomSettings } from '../types/room.types.js';
import { DEMO_TIMER_MAX_MINUTES, DEMO_TIMER_MIN_MINUTES } from '../config/demo-mode.js';

// Claves permitidas para `update-room-settings` (whitelist).
// Rol B (perf overlays): `dataSaver`, `fullscreenToasts`, `reactionsEnabled`,
// `visualEffects`, `duckingEnabled` y `duckingLevel` persisten los ajustes de rendimiento.
const ALLOWED_KEYS = new Set<string>([
  'muteOnEntry',
  'cameraOffOnEntry',
  'allowMicReactivation',
  'allowCamReactivation',
  'isTemporary',
  'requireApproval',
  'name',
  'description',
  'timerMinutes',
  'timerEndsAt',
  'dataSaver',
  'fullscreenToasts',
  'reactionsEnabled',
  'visualEffects',
  'duckingEnabled',
  'duckingLevel',
]);

const BOOLEAN_KEYS = new Set<string>([
  'muteOnEntry',
  'cameraOffOnEntry',
  'allowMicReactivation',
  'allowCamReactivation',
  'isTemporary',
  'requireApproval',
  'dataSaver',
  'fullscreenToasts',
  'reactionsEnabled',
  'visualEffects',
  'duckingEnabled',
]);

/** Rango válido para `duckingLevel` (porcentaje 10–60, default 30 en cliente). */
export const DUCKING_LEVEL_MIN = 10;
export const DUCKING_LEVEL_MAX = 60;

export interface SanitizedSettings {
  /** Valores válidos listos para fusionar. Vacío si hubo errores (atómico). */
  settings: Partial<IRoomSettings>;
  /** Mensajes claros, uno por problema. Vacío = válido. */
  errors: string[];
}

/**
 * Opciones de saneo. `demo=true` aplica la validación mínima de la demo al
 * temporizador (minutos 1–480 y `timerEndsAt` futuro dentro de ese rango),
 * porque el cliente no debe imponer tiempo arbitrario. Con `demo` ausente o
 * false el comportamiento es el original. `now` solo existe para tests.
 */
export interface SanitizeOptions {
  demo?: boolean;
  now?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Valida y sanea el payload de `update-room-settings` (H-estricto).
 *
 * A diferencia de la versión permisiva anterior, cualquier problema produce
 * un error en `errors` y `settings` queda vacío para que el llamador NO
 * aplique nada (atómico: o todo válido o nada).
 *
 * Los llamadores deben: si `errors.length > 0` → socket `settings-error` al
 * emisor / REST 400 con mensaje claro, sin mutar la sala.
 */
export function sanitizeRoomSettings(input: unknown, opts: SanitizeOptions = {}): SanitizedSettings {
  if (!isRecord(input)) {
    return { settings: {}, errors: ['Los ajustes deben ser un objeto.'] };
  }

  const errors: string[] = [];
  const out: Partial<IRoomSettings> = {};

  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors.push(`Ajuste desconocido: "${key}".`);
    }
  }

  for (const key of BOOLEAN_KEYS) {
    if (!(key in input)) continue;
    const value = input[key];
    if (typeof value !== 'boolean') {
      errors.push(`"${key}" debe ser booleano (true/false).`);
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }

  for (const key of ['name', 'description'] as const) {
    if (!(key in input)) continue;
    const value = input[key];
    if (typeof value !== 'string') {
      errors.push(`"${key}" debe ser texto.`);
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }

  if ('timerMinutes' in input) {
    const value = input['timerMinutes'];
    if (value === null) {
      (out as Record<string, unknown>)['timerMinutes'] = null;
    } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      (out as Record<string, unknown>)['timerMinutes'] = value;
    } else {
      errors.push('"timerMinutes" debe ser un número finito mayor o igual a 0, o null para desactivar.');
    }
  }

  if ('timerEndsAt' in input) {
    const value = input['timerEndsAt'];
    if (value === null || value === '') {
      (out as Record<string, unknown>)['timerEndsAt'] = null;
    } else if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        errors.push('"timerEndsAt" debe ser una fecha válida en formato ISO o null para desactivar.');
      } else {
        (out as Record<string, unknown>)['timerEndsAt'] = parsed.toISOString();
      }
    } else {
      errors.push('"timerEndsAt" debe ser una fecha válida en formato ISO o null para desactivar.');
    }
  }

  // Rol B (ducking dinámico): porcentaje 10–60. Estricto como el resto:
  // fuera de rango o no numérico → error y nada se aplica (atómico).
  if ('duckingLevel' in input) {
    const value = input['duckingLevel'];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < DUCKING_LEVEL_MIN ||
      value > DUCKING_LEVEL_MAX
    ) {
      errors.push(
        `"duckingLevel" debe ser un número entre ${DUCKING_LEVEL_MIN} y ${DUCKING_LEVEL_MAX}.`
      );
    } else {
      (out as Record<string, unknown>)['duckingLevel'] = Math.round(value);
    }
  }

  if (errors.length > 0) return { settings: {}, errors };

  // ── Demo: el temporizador ya es de servidor (barrido cada 15s sobre el
  // `timerEndsAt` persistido), pero el cliente podía imponer tiempo arbitrario.
  // Validación mínima: minutos 1–480 y deadline futuro dentro de ese rango.
  if (opts.demo) {
    const now = opts.now ?? Date.now();
    const maxEndsAt = now + DEMO_TIMER_MAX_MINUTES * 60_000;
    const minutes = (out as Record<string, unknown>)['timerMinutes'];
    if (minutes !== undefined && minutes !== null) {
      const v = minutes as number;
      if (v < DEMO_TIMER_MIN_MINUTES || v > DEMO_TIMER_MAX_MINUTES) {
        errors.push(
          `"timerMinutes" en la demo debe estar entre ${DEMO_TIMER_MIN_MINUTES} y ${DEMO_TIMER_MAX_MINUTES} minutos, o null para desactivar.`
        );
      }
    }
    const endsAt = (out as Record<string, unknown>)['timerEndsAt'];
    if (endsAt !== undefined && endsAt !== null) {
      const parsed = new Date(endsAt as string).getTime();
      if (!(parsed > now) || parsed > maxEndsAt) {
        errors.push(
          `"timerEndsAt" en la demo debe ser una fecha futura dentro de las próximas ${DEMO_TIMER_MAX_MINUTES / 60} horas.`
        );
      }
    }
  }

  if (errors.length > 0) return { settings: {}, errors };
  return { settings: out, errors };
}
