import type { IRoomSettings } from '../types/room.types.js';

// Claves permitidas para `update-room-settings` (whitelist).
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
]);

const BOOLEAN_KEYS = new Set<string>([
  'muteOnEntry',
  'cameraOffOnEntry',
  'allowMicReactivation',
  'allowCamReactivation',
  'isTemporary',
  'requireApproval',
]);

export interface SanitizedSettings {
  /** Valores válidos listos para fusionar. Vacío si hubo errores (atómico). */
  settings: Partial<IRoomSettings>;
  /** Mensajes claros, uno por problema. Vacío = válido. */
  errors: string[];
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
export function sanitizeRoomSettings(input: unknown): SanitizedSettings {
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

  if (errors.length > 0) return { settings: {}, errors };
  return { settings: out, errors };
}
