/**
 * Combo Interestellar (rol reacciones + efectos visuales).
 *
 * Si llegan 🪐 y ✨ de DOS usuarios distintos en 5 s (ventana por timestamp
 * de llegada), se muestra un overlay especial sobre la película. Solo visual.
 */

export const INTERSTELLAR_WINDOW_MS = 5000;

/**
 * Frases cinematográficas de la secuencia del combo. Viven aquí (no en el
 * componente) porque quien completa el combo elige 3 y las comparte por
 * socket: toda la sala ve exactamente las mismas, como con el video.
 */
export const AMBIENT_QUOTES = [
  'No entres dócil en esa buena noche.',
  'El amor es lo único que trasciende el tiempo y el espacio.',
  'La humanidad nació en la Tierra; no estaba destinada a morir aquí.',
  'Solíamos mirar al cielo y preguntarnos.',
  'No es posible.',
  'No. Es necesario.',
  'Quédate.',
  'Una hora allí son siete años aquí.',
  'El tiempo puede estirarse, pero no retroceder.',
  'No me dejes ir así, Murph.',
] as const;

/** Elige 3 frases distintas al azar para una secuencia. */
export function pickAmbientQuotes(): [string, string, string] {
  const pool: string[] = [...AMBIENT_QUOTES];
  const out: string[] = [];
  while (out.length < 3 && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out as [string, string, string];
}

export const INTERSTELLAR_EMOJIS = ['🪐', '✨'] as const;
export type InterstellarEmoji = (typeof INTERSTELLAR_EMOJIS)[number];

export interface InterstellarEvent {
  emoji: string;
  user: string;
  /** Timestamp de llegada (Date.now() al recibir por socket). */
  at: number;
}

export function isInterstellarEmoji(emoji: string): emoji is InterstellarEmoji {
  return emoji === '🪐' || emoji === '✨';
}

function normUser(user: string): string {
  return (user ?? '').trim().toLowerCase();
}

/**
 * ¿El evento entrante completa un combo Interestellar?
 * - `incoming` debe ser 🪐 o ✨.
 * - Debe existir otro evento con el emoji complementario (🪐↔✨),
 *   de OTRO usuario distinto, con |at - incoming.at| <= 5 s.
 * - `visualEffects` en false desactiva el combo (solo visual).
 */
export function checkInterstellarCombo(
  recent: InterstellarEvent[],
  incoming: InterstellarEvent,
  visualEffects = true,
): boolean {
  if (!visualEffects) return false;
  if (!isInterstellarEmoji(incoming.emoji)) return false;
  const incomingUser = normUser(incoming.user);
  if (!incomingUser) return false;
  const wanted = incoming.emoji === '🪐' ? '✨' : '🪐';
  return recent.some((ev) => {
    if (ev.emoji !== wanted) return false;
    if (normUser(ev.user) === incomingUser) return false;
    if (!Number.isFinite(ev.at) || !Number.isFinite(incoming.at)) return false;
    return Math.abs(incoming.at - ev.at) <= INTERSTELLAR_WINDOW_MS;
  });
}

/**
 * Busca en un historial si EXISTE alguna pareja válida (para tests y
 * depuración): dos eventos 🪐+✨ de usuarios distintos en ventana de 5 s.
 */
export function hasInterstellarPair(
  events: InterstellarEvent[],
  visualEffects = true,
): boolean {
  if (!visualEffects) return false;
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (!isInterstellarEmoji(a.emoji) || !isInterstellarEmoji(b.emoji)) continue;
      if (a.emoji === b.emoji) continue;
      if (normUser(a.user) === normUser(b.user)) continue;
      if (Math.abs(a.at - b.at) <= INTERSTELLAR_WINDOW_MS) return true;
    }
  }
  return false;
}
