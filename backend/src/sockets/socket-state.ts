// Estado efímero compartido por los handlers de sockets (directorio de usuarios y medios).
export interface SocketUser {
  socketId: string;
  roomId: string;
  userName: string;
  isLeader: boolean;
  userId?: string;
  pending?: boolean;
}

/** Directorio de usuarios conectados por socket.id */
export const activeUsers = new Map<string, SocketUser>();

/** Estados de medios por socket.id y por nombre en minúsculas */
export const activeMediaStates = new Map<string, { isCameraOn: boolean; isMicOn: boolean }>();

/**
 * Último trigger de cinemática (combo Interestellar) por sala. El servidor
 * serializa: solo la primera propuesta dentro de la ventana gana y se
 * reenvía, para que toda la sala vea las mismas frases.
 */
export const lastCinematicTrigger = new Map<string, number>();

/**
 * Libera el estado de cinemática de una sala al cerrarla/eliminarla o cuando
 * queda vacía. Sin esto el mapa crece indefinidamente (una entrada por sala).
 */
export function clearCinematicTrigger(roomId: string): void {
  if (typeof roomId !== 'string' || !roomId.trim()) return;
  lastCinematicTrigger.delete(roomId.toUpperCase().trim());
}
