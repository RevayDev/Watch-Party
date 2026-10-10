import crypto from 'node:crypto';

/**
 * Nonces anti-CSRF de un solo uso para el OAuth de Spotify.
 * Al generar la URL de autorización se firma un `state` con formato
 * `base64url(`${roomId}.${nonce}`)`; el callback lo valida (formato,
 * existencia y expiración de 10 min) y lo consume (borra).
 * Así el `state` liga la autorización a la sala y no es reutilizable.
 */

interface StateEntry {
  roomId: string;
  exp: number;
}

/** Ventana de validez del nonce (10 minutos). */
export const SPOTIFY_STATE_TTL_MS = 10 * 60 * 1000;

const states = new Map<string, StateEntry>();

function normRoom(roomId: string): string {
  return roomId.toUpperCase().trim();
}

/**
 * Genera un `state` firmado para la sala (síncrono: usa aleatorio del SO).
 * Guarda el nonce en memoria con expiración.
 */
export function issueSpotifyState(roomId: string): string {
  const room = normRoom(roomId);
  const nonce = crypto.randomBytes(16).toString('hex');
  states.set(nonce, { roomId: room, exp: Date.now() + SPOTIFY_STATE_TTL_MS });
  return Buffer.from(`${room}.${nonce}`, 'utf-8').toString('base64url');
}

/**
 * Valida y consume un `state` de un solo uso.
 * Devuelve el roomId normalizado, o null si el formato es inválido, el
 * nonce no existe (desconocido o ya consumido) o expiró.
 */
export function consumeSpotifyState(state: string): string | null {
  let decoded: string;
  try {
    decoded = Buffer.from(state, 'base64url').toString('utf-8');
  } catch {
    return null;
  }
  const sep = decoded.lastIndexOf('.');
  if (sep <= 0 || sep >= decoded.length - 1) return null;
  const room = normRoom(decoded.slice(0, sep));
  const nonce = decoded.slice(sep + 1);
  if (!room || !/^[0-9a-f]{32}$/.test(nonce)) return null;
  const entry = states.get(nonce);
  // Consumo inmediato: un solo uso aunque haya expirado o la sala no coincida.
  states.delete(nonce);
  if (!entry) return null;
  if (Date.now() > entry.exp) return null;
  if (entry.roomId !== room) return null;
  return room;
}

/** Solo para tests: vacía los nonces pendientes. */
export function clearSpotifyStates(): void {
  states.clear();
}

/** Solo para tests: fuerza la expiración de todos los nonces pendientes. */
export function expireSpotifyStatesForTests(): void {
  for (const entry of states.values()) {
    entry.exp = Date.now() - 1;
  }
}
