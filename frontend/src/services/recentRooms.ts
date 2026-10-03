export interface RecentRoom {
  roomId: string;
  hostName: string;
  role: 'host' | 'guest';
  lastJoined: number;
  roomName?: string;
  roomDescription?: string;
}

const RECENT_ROOMS_KEY = 'watchparty_recent_rooms';
const LAST_USERNAME_KEY = 'watchparty_last_username';
const MAX_RECENT = 8;

export function getRecentRooms(): RecentRoom[] {
  try {
    const raw = localStorage.getItem(RECENT_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => r && typeof r.roomId === 'string');
  } catch {
    return [];
  }
}

export function saveRecentRoom(roomId: string, hostName: string, role: 'host' | 'guest'): void {
  try {
    const cleanId = roomId.toUpperCase().trim();
    const prev = getRecentRooms().find((r) => r.roomId === cleanId);
    const list = getRecentRooms().filter((r) => r.roomId !== cleanId);
    list.unshift({
      roomId: cleanId,
      hostName,
      role,
      lastJoined: Date.now(),
      roomName: prev?.roomName,
      roomDescription: prev?.roomDescription,
    });
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
    if (hostName.trim()) localStorage.setItem(LAST_USERNAME_KEY, hostName.trim());
  } catch {
    // storage full / unavailable
  }
}

/** Guarda el nombre/descripción de la sala en la entrada reciente (sin cambiar el resto). */
export function updateRecentRoomMeta(
  roomId: string,
  meta: { roomName?: string; roomDescription?: string }
): void {
  try {
    const cleanId = roomId.toUpperCase().trim();
    const list = getRecentRooms();
    const idx = list.findIndex((r) => r.roomId === cleanId);
    if (idx === -1) return;
    const current = list[idx];
    list[idx] = {
      ...current,
      roomName: meta.roomName?.trim() ? meta.roomName.trim() : current.roomName,
      roomDescription: meta.roomDescription?.trim() ? meta.roomDescription.trim() : current.roomDescription,
    };
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // ignore
  }
}

export function removeRecentRoom(roomId: string): void {
  try {
    const cleanId = roomId.toUpperCase().trim();
    const list = getRecentRooms().filter((r) => r.roomId !== cleanId);
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function getLastUsername(): string {
  try {
    return localStorage.getItem(LAST_USERNAME_KEY) || '';
  } catch {
    return '';
  }
}
