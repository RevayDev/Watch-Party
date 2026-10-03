// Estado efímero compartido por los handlers de sockets (directorio de usuarios y medios).
export interface SocketUser {
  socketId: string;
  roomId: string;
  userName: string;
  isHost: boolean;
  userId?: string;
  pending?: boolean;
}

/** Directorio de usuarios conectados por socket.id */
export const activeUsers = new Map<string, SocketUser>();

/** Estados de medios por socket.id y por nombre en minúsculas */
export const activeMediaStates = new Map<string, { isCameraOn: boolean; isMicOn: boolean }>();
