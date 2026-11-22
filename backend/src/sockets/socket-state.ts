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

/** Tope de autores recordados por sala (solo para validar edición). */
const MAX_AUTHORS_PER_ROOM = 200;

/**
 * Autor de cada mensaje reciente por sala: id mensaje -> nombre.
 * Efímero (sin persistencia): solo sirve para que únicamente el autor pueda
 * editar sus mensajes. Se poda FIFO y se limpia al cerrar la sala.
 */
export const roomDeletedMessages = new Map<string, Set<string>>();
export const roomMessageReactions = new Map<string, Record<string, Record<string, { userId: string; userName: string; emoji: string }>>>();
export const roomReadReceipts = new Map<string, Record<string, { readerId: string; userName: string; messageId: string }>>();
export const roomMessageAuthors = new Map<string, Map<string, string>>();

/** Registra quién envió un mensaje (para validar su edición posterior). */
export function trackRoomMessage(roomId: string, messageId: string, userName: string): void {
  if (!roomId || !messageId || !userName) return;
  const key = roomId.toUpperCase().trim();
  let authors = roomMessageAuthors.get(key);
  if (!authors) {
    authors = new Map<string, string>();
    roomMessageAuthors.set(key, authors);
  }
  authors.delete(messageId);
  authors.set(messageId, userName);
  while (authors.size > MAX_AUTHORS_PER_ROOM) {
    const oldest = authors.keys().next().value;
    if (oldest === undefined) break;
    authors.delete(oldest);
    roomDeletedMessages.get(key)?.delete(oldest);
    const reactions = roomMessageReactions.get(key); if (reactions) delete reactions[oldest];
  }
}

/** Autor registrado de un mensaje, o null si no consta (ya podado). */
export function roomMessageAuthor(roomId: string, messageId: string): string | null {
  if (!roomId || !messageId) return null;
  return roomMessageAuthors.get(roomId.toUpperCase().trim())?.get(messageId) ?? null;
}

/** Libera los autores de una sala (al cerrarla/eliminarla o quedar vacía). */
export function clearRoomMessageAuthors(roomId: string): void {
  if (typeof roomId !== 'string' || !roomId.trim()) return;
  roomMessageAuthors.delete(roomId.toUpperCase().trim());
  roomReadReceipts.delete(roomId.toUpperCase().trim());
  roomDeletedMessages.delete(roomId.toUpperCase().trim());
  roomMessageReactions.delete(roomId.toUpperCase().trim());
}
