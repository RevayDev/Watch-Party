import {
  roomPlayback,
  roomPositions,
  resolveSyncedPlayback,
  setPlaybackSnapshot,
} from '../domain/playback-policy.js';

const VALID_ACTIONS = new Set(['play', 'pause', 'seek']);

/** Caso de uso: sincronizar playback (play/pause/seek). Delgado: actualiza el snapshot y devuelve el payload a emitir. */
export class SyncPlaybackUseCase {
  static execute(input: { roomId: string; action: 'play' | 'pause' | 'seek'; currentTime: number }): {
    action: 'play' | 'pause' | 'seek';
    currentTime: number;
    sentAt: number;
  } | null {
    if (!input || !input.roomId) return null;
    if (!VALID_ACTIONS.has(input.action)) return null;
    if (!Number.isFinite(input.currentTime) || input.currentTime < 0) return null;
    const cleanRoomId = input.roomId.toUpperCase().trim();
    // `seek` no cambia el estado de reproducción: conserva el anterior.
    const prev = roomPlayback.get(cleanRoomId);
    const isPlaying =
      input.action === 'play' ? true : input.action === 'pause' ? false : (prev?.isPlaying ?? false);
    setPlaybackSnapshot(cleanRoomId, input.currentTime, isPlaying);
    return { action: input.action, currentTime: input.currentTime, sentAt: Date.now() };
  }
}

/** Caso de uso: registrar heartbeat de posición (alimenta el consenso de tiempo). */
export class RecordHeartbeatUseCase {
  static execute(input: {
    roomId: string;
    socketId: string;
    userName: string;
    userId?: string;
    currentTime: number;
    isPlaying: boolean;
    isMember: boolean;
  }): boolean {
    const { roomId, currentTime } = input;
    if (!roomId || !Number.isFinite(currentTime) || currentTime < 0) return false;
    if (!input.isMember) return false;
    const cleanRoomId = roomId.toUpperCase().trim();
    let bySocket = roomPositions.get(cleanRoomId);
    if (!bySocket) {
      bySocket = new Map();
      roomPositions.set(cleanRoomId, bySocket);
    }
    bySocket.set(input.socketId, {
      socketId: input.socketId,
      userName: input.userName,
      userId: input.userId,
      currentTime,
      isPlaying: input.isPlaying === true,
      updatedAt: Date.now(),
    });
    return true;
  }
}

/** Caso de uso (lectura): tiempo de referencia para un recién llegado. */
export class ResolveSyncTimeUseCase {
  static execute(
    roomId: string,
    participants: Array<{ userId?: string; name: string; joinedAt?: Date | string; isLeader?: boolean }>,
  ): { currentTime: number; isPlaying: boolean } | null {
    return resolveSyncedPlayback(roomId.toUpperCase().trim(), participants);
  }
}
