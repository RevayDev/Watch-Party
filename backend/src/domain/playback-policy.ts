// ── Reglas puras de sincronización de playback ─────────────────────────────
// Movido verbatim desde src/sockets/room.socket.ts (sin cambios de lógica).
// Este módulo conserva el estado efímero en memoria (snapshots + heartbeats)
// porque es volátil por naturaleza; la persistencia de salas vive en el puerto
// RoomRepository. La función pura testeable es `resolveRoomTime`.

// In-memory playback state per room: { currentTime, isPlaying, updatedAt }
export interface PlaybackState {
  currentTime: number;
  isPlaying: boolean;
  updatedAt: number; // Date.now() when last updated
}

export const roomPlayback = new Map<string, PlaybackState>();

// Live playback positions reported by members (heartbeats). Used to resolve
// the reference time a (re)joining user should adopt: the time most members
// share; seniority (longest in the room) wins ties.
export interface PositionReport {
  socketId: string;
  userName: string;
  userId?: string;
  currentTime: number;
  isPlaying: boolean;
  updatedAt: number;
}

export const roomPositions = new Map<string, Map<string, PositionReport>>();
export const POSITION_TTL_MS = 12_000;
export const CLUSTER_TOLERANCE_SEC = 3;

export function freshPositions(roomId: string): PositionReport[] {
  const now = Date.now();
  const bySocket = roomPositions.get(roomId);
  if (!bySocket) return [];
  const out: PositionReport[] = [];
  for (const [sid, rep] of bySocket.entries()) {
    if (now - rep.updatedAt > POSITION_TTL_MS) {
      bySocket.delete(sid);
      continue;
    }
    if (Number.isFinite(rep.currentTime) && rep.currentTime >= 0) out.push(rep);
  }
  if (bySocket.size === 0) roomPositions.delete(roomId);
  return out;
}

export function seniorityOf(
  rep: PositionReport,
  participants: Array<{ userId?: string; name: string; joinedAt?: Date | string; isHost?: boolean }>,
): number {
  const match = participants.find((p) => {
    if (rep.userId && p.userId) return p.userId === rep.userId;
    return p.name.toLowerCase() === rep.userName.toLowerCase();
  });
  const t = match?.joinedAt ? new Date(match.joinedAt).getTime() : NaN;
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/**
 * Reference playback for a newcomer: the time most present members share
 * (reports clustered within CLUSTER_TOLERANCE_SEC, median of the biggest
 * cluster). With no majority — e.g. two members apart — the senior member
 * (longest in the room) wins. Returns null when nobody reported recently.
 */
export function resolveRoomTime(
  roomId: string,
  participants: Array<{ userId?: string; name: string; joinedAt?: Date | string; isHost?: boolean }>,
): { currentTime: number; isPlaying: boolean } | null {
  const reports = freshPositions(roomId);
  if (reports.length === 0) return null;

  const sorted = [...reports].sort((a, b) => a.currentTime - b.currentTime);
  let best: PositionReport[] = [];
  let window: PositionReport[] = [];
  for (const rep of sorted) {
    if (window.length > 0 && rep.currentTime - window[0].currentTime > CLUSTER_TOLERANCE_SEC) {
      if (window.length > best.length) best = window;
      window = [];
    }
    window.push(rep);
  }
  if (window.length > best.length) best = window;

  // No majority (everyone apart): seniority wins — longest in the room first.
  const cluster =
    best.length >= 2 || sorted.length === 1
      ? best
      : [...sorted].sort(
          (a, b) => seniorityOf(a, participants) - seniorityOf(b, participants),
        ).slice(0, 1);

  const times = cluster.map((r) => r.currentTime).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const playingVotes = cluster.filter((r) => r.isPlaying).length;
  return { currentTime: median, isPlaying: playingVotes * 2 >= cluster.length };
}

export function dropPosition(roomId: string, socketId: string): void {
  const bySocket = roomPositions.get(roomId);
  if (!bySocket) return;
  bySocket.delete(socketId);
  if (bySocket.size === 0) roomPositions.delete(roomId);
}

/** Snapshot de última acción (play/pause/seek) para una sala. */
export function setPlaybackSnapshot(roomId: string, currentTime: number, isPlaying: boolean): void {
  roomPlayback.set(roomId, { currentTime, isPlaying, updatedAt: Date.now() });
}

/** Tiempo sincronizado para un recién llegado (consenso primero, snapshot como fallback). */
export function resolveSyncedPlayback(
  roomId: string,
  participants: Array<{ userId?: string; name: string; joinedAt?: Date | string; isHost?: boolean }>,
): { currentTime: number; isPlaying: boolean } | null {
  const consensus = resolveRoomTime(roomId, participants);
  if (consensus) return consensus;
  const playback = roomPlayback.get(roomId);
  if (!playback) return null;
  const elapsedSec = (Date.now() - playback.updatedAt) / 1000;
  return {
    currentTime: playback.isPlaying ? playback.currentTime + elapsedSec : playback.currentTime,
    isPlaying: playback.isPlaying,
  };
}
