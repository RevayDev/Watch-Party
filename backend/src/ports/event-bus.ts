/**
 * Puerto mínimo de bus de eventos (hexagonal).
 * Abstrae Socket.IO para que los casos de uso no dependan del transporte.
 * El adaptador real vive en src/adapters/socket-event-bus.ts y delega en `io`.
 */
export interface EventBus {
  /** Emite a todos los sockets unidos a una sala. */
  toRoom(roomId: string, event: string, payload?: unknown): void;
  /** Emite a un socket concreto. */
  toSocket(socketId: string, event: string, payload?: unknown): void;
  /** Emite excepto al remitente (difusión en sala). */
  broadcastExcept(roomId: string, exceptSocketId: string, event: string, payload?: unknown): void;
}
