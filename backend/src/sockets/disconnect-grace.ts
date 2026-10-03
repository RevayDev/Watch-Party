/**
 * Gracia de refresh ante `disconnect` (H3).
 *
 * Si el usuario tiene userId, su eliminación de participantes y la
 * transferencia de host se difieren 20s (clave `${roomId}:${userId}`).
 * Si reaparece vía `join-room` dentro de la ventana, el temporizador se
 * cancela y conserva participante + rol (nunca se llegó a eliminar).
 *
 * `leave-room` voluntario sigue siendo inmediato (y cancela cualquier gracia
 * pendiente de esa identidad). `user-left` solo se emite al eliminar de verdad.
 */

export const DISCONNECT_GRACE_MS = 20_000;

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Clave del mapa de gracia pendiente. Exportada para tests. */
export function graceKey(roomId: string, userId: string): string {
  return `${roomId.toUpperCase().trim()}:${userId}`;
}

/** ¿Hay una eliminación diferida pendiente para esta identidad? */
export function hasPendingGrace(roomId: string, userId: string): boolean {
  return pendingTimers.has(graceKey(roomId, userId));
}

/** Número de gracias pendientes (útil para tests). */
export function pendingGraceCount(): number {
  return pendingTimers.size;
}

/**
 * Programa la eliminación diferida. Si ya había una pendiente para la misma
 * identidad, se reemplaza. Devuelve la clave programada.
 */
export function schedulePendingGrace(
  roomId: string,
  userId: string,
  onExpire: () => void | Promise<void>,
  delayMs: number = DISCONNECT_GRACE_MS,
): string {
  const key = graceKey(roomId, userId);
  const prev = pendingTimers.get(key);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    void onExpire();
  }, delayMs);
  // No retener el proceso solo por una gracia pendiente.
  const maybeUnref = timer as unknown as { unref?: () => void };
  if (typeof maybeUnref.unref === 'function') maybeUnref.unref();
  pendingTimers.set(key, timer);
  return key;
}

/** Cancela la gracia pendiente. Devuelve true si había alguna. */
export function cancelPendingGrace(roomId: string, userId: string): boolean {
  const key = graceKey(roomId, userId);
  const timer = pendingTimers.get(key);
  if (!timer) return false;
  clearTimeout(timer);
  pendingTimers.delete(key);
  return true;
}

/** Limpia todas las gracias (tests / apagado). */
export function clearAllPendingGraces(): void {
  for (const timer of pendingTimers.values()) clearTimeout(timer);
  pendingTimers.clear();
}
