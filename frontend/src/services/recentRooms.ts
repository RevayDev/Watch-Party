export interface RecentRoom {
  roomId: string;
  hostName: string;
  role: 'host' | 'guest';
  lastJoined: number;
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
    const list = getRecentRooms().filter((r) => r.roomId !== cleanId);
    list.unshift({ roomId: cleanId, hostName, role, lastJoined: Date.now() });
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
    if (hostName.trim()) localStorage.setItem(LAST_USERNAME_KEY, hostName.trim());
  } catch {
    // storage full / unavailable
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
