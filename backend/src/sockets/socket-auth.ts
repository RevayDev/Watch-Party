import type { Socket } from 'socket.io';
import type { AuthClaim } from '../domain/auth-policy.js';
import { activeUsers } from './socket-state.js';

/**
 * Campos de autorización del contrato con frontend. Todo payload socket
 * privilegiado puede traerlos; `requesterUserId`/`requesterName` caen al
 * directorio de sockets cuando el cliente no los envía (compatibilidad).
 */
export interface PrivilegedPayload {
  leaderSecret?: string;
  requesterUserId?: string;
  requesterName?: string;
}

/** Construye el claim de autorización desde payload + estado del servidor. */
export function resolveSocketClaim(socket: Socket, payload: PrivilegedPayload): AuthClaim {
  const entry = activeUsers.get(socket.id);
  return {
    leaderSecret: payload.leaderSecret,
    requesterUserId: payload.requesterUserId ?? entry?.userId,
    requesterName: payload.requesterName ?? entry?.userName,
  };
}

/** Denegación solo al emisor (contrato: `action-denied {event, message}`). */
export function denySocket(socket: Socket, event: string, message: string): void {
  socket.emit('action-denied', { event, message });
}
