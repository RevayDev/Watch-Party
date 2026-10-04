/**
 * Utils compartidos (movidos verbatim, sin cambios de lógica).
 * Extraídos de Home.tsx / Participants.tsx / RoomHeader.tsx.
 */

import { STORAGE_KEYS } from './constants';

// Clave definida en services/recentRooms.ts (se lee aquí sin importar el
// servicio para no invertir la dependencia shared -> services).
const LAST_USERNAME_KEY = 'watchparty_last_username';

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'ahora mismo';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return new Date(ts).toLocaleDateString([], {
    day: '2-digit',
    month: 'short',
  });
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #6366f1, #4338ca)',
  'linear-gradient(135deg, #ec4899, #be185d)',
  'linear-gradient(135deg, #3b82f6, #1d4ed8)',
  'linear-gradient(135deg, #f59e0b, #b45309)',
  'linear-gradient(135deg, #10b981, #047857)',
  'linear-gradient(135deg, #8b5cf6, #6d28d9)',
  'linear-gradient(135deg, #14b8a6, #0f766e)',
];

/** Color avatar generator (movido verbatim desde Participants.tsx). */
export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

export function getInitials(name: string): string {
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

/** Countdown mm:ss / h:mm:ss (movido verbatim desde RoomHeader.tsx). */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/* ── Auth para endpoints/emits privilegiados (contrato con backend) ─────────
 * El backend acepta `hostSecret?`, `requesterUserId?`, `requesterName?` en
 * los payloads socket privilegiados y los headers `x-host-secret`,
 * `x-user-id`, `x-user-name` en REST. Los campos solo se envían cuando hay
 * valor (sin credenciales == comportamiento de invitado, como hoy).
 */

/** hostSecret guardado en la sesión de host, solo si es de esta sala. */
export function getStoredHostSecret(roomId: string): string | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HOST_SESSION);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed?.roomId?.toUpperCase() === roomId.toUpperCase() && parsed.hostSecret) {
      return String(parsed.hostSecret);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** userId estable de este navegador (o undefined si no existe). */
export function getStoredUserId(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEYS.USER_ID) || undefined;
  } catch {
    return undefined;
  }
}

/** Obtiene o genera y guarda un userId persistente para este navegador. */
export function getOrCreateUserId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEYS.USER_ID);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(STORAGE_KEYS.USER_ID, id);
    }
    return id;
  } catch {
    return `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Último nombre usado (o undefined si no existe). */
export function getStoredUserName(): string | undefined {
  try {
    return localStorage.getItem(LAST_USERNAME_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export interface SocketAuth {
  hostSecret?: string;
  requesterUserId?: string;
  requesterName?: string;
}

/** Credenciales para emits socket privilegiados (solo campos con valor). */
export function buildSocketAuth(roomId: string, requesterName?: string): SocketAuth {
  const auth: SocketAuth = {};
  const hostSecret = getStoredHostSecret(roomId);
  if (hostSecret) auth.hostSecret = hostSecret;
  const userId = getStoredUserId();
  if (userId) auth.requesterUserId = userId;
  const name = requesterName?.trim() || getStoredUserName();
  if (name) auth.requesterName = name;
  return auth;
}

/** Headers REST para endpoints privilegiados (solo los que tienen valor). */
export function buildRestAuthHeaders(roomId: string, requesterName?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const hostSecret = getStoredHostSecret(roomId);
  if (hostSecret) headers['x-host-secret'] = hostSecret;
  const userId = getStoredUserId();
  if (userId) headers['x-user-id'] = userId;
  const name = requesterName?.trim() || getStoredUserName();
  if (name) headers['x-user-name'] = name;
  return headers;
}

/**
 * Guarda la sesión de host. Si no se provee hostSecret, se preserva el ya
 * guardado para esa sala (para no borrarlo en re-entradas sin secreto).
 */
export function saveHostSession(roomId: string, hostName: string, hostSecret?: string): void {
  try {
    let secret = hostSecret;
    if (!secret) {
      secret = getStoredHostSecret(roomId);
    }
    const sessionObj: { roomId: string; hostName: string; hostSecret?: string } = {
      roomId,
      hostName,
    };
    if (secret) {
      sessionObj.hostSecret = secret;
    }
    localStorage.setItem(STORAGE_KEYS.HOST_SESSION, JSON.stringify(sessionObj));
  } catch {
    // storage unavailable → se ignora (igual que el resto de persistencia)
  }
}

/** Mapeo puro del rechazo de entrada a notificación (testeable sin jsdom). */
export function resolveJoinRejectedFeedback(
  reason?: string,
  message?: string
): { type: 'error' | 'warning'; title: string; message: string } {
  if (reason === 'banned') {
    return { type: 'error', title: 'Baneado', message: message || 'Has sido baneado de esta sala.' };
  }
  if (reason === 'name-taken') {
    return {
      type: 'warning',
      title: 'Nombre en uso',
      message: message || 'Ese nombre ya está en uso en esta sala. Vuelve al inicio y entra con otro nombre.',
    };
  }
  // Demo: la sala alcanzó su cupo (10 participantes incl. host). El backend
  // envía reason 'room-full' con el mensaje EXACTO 'Esta sala está llena.';
  // si hay mensaje del servidor, ese texto manda (contrato).
  if (reason === 'room-full') {
    return { type: 'warning', title: 'Sala llena', message: message || 'Esta sala está llena.' };
  }
  return {
    type: 'warning',
    title: 'Solicitud rechazada',
    message: message || 'Tu solicitud para unirte fue rechazada.',
  };
}
