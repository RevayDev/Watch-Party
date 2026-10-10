import { IRoomData, IRoomSettings, IVideoMetadata } from '../types/room';
import { buildRestAuthHeaders, getStoredUserId } from '../shared/utils';
import type { DemoAvailability } from '../shared/demo';

// In production, VITE_API_URL can be set to the backend URL (e.g., https://my-watchparty-backend.onrender.com)
// In local development or when proxying, it defaults to empty string or /api
const BACKEND_BASE = import.meta.env.VITE_API_URL || '';
const API_BASE_URL = BACKEND_BASE ? `${BACKEND_BASE.replace(/\/$/, '')}/api` : '/api';

export { BACKEND_BASE };


export class ApiService {
  /**
   * Request backend to create a new room.
   */
  static async createRoom(
    leaderName: string,
    isTemporary: boolean = true
  ): Promise<{ roomId: string; leaderSecret: string; leaderName: string; isTemporary?: boolean }> {
    const userId = getStoredUserId();
    const body: { leaderName: string; isTemporary: boolean; userId?: string } = {
      leaderName,
      isTemporary,
    };
    if (userId) body.userId = userId;

    const response = await fetch(`${API_BASE_URL}/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { 'x-user-id': userId, 'x-user-name': leaderName.trim() } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Error al crear la sala');
    }

    return response.json();
  }

  /**
   * Fetch room details by roomId.
   */
  static async getRoom(roomId: string): Promise<IRoomData> {
    const response = await fetch(`${API_BASE_URL}/rooms/${roomId}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Sala no encontrada');
    }

    return response.json();
  }

  /**
   * Join an existing room with user name.
   */
  static async joinRoom(roomId: string, userName: string): Promise<IRoomData> {
    const userId = getStoredUserId();
    const body: { userName: string; userId?: string } = { userName };
    if (userId) body.userId = userId;

    const response = await fetch(`${API_BASE_URL}/rooms/${roomId}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildRestAuthHeaders(roomId, userName),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Error al unirse a la sala');
    }

    return response.json();
  }

  /**
   * Demo gratuita: solo conteos de salas (roomsUsed/roomsTotal/roomsAvailable).
   * No expone códigos ni listas. Si falla, el llamador oculta el contador.
   */
  static async getDemoAvailability(): Promise<DemoAvailability> {    const response = await fetch(`${API_BASE_URL}/demo/availability`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'No se pudo consultar la disponibilidad de la demo');
    }

    return response.json();
  }

  /**
   * Actualiza ajustes de sala por REST (`PATCH /api/rooms/:roomId/settings`).
   * Rol B: la UI en vivo usa socket (difusión en tiempo real); este helper
   * queda para llamadas sin socket. Requiere anfitrión (el servidor valida
   * la misma whitelist que por socket).
   */
  static async updateRoomSettings(
    roomId: string,
    settings: Partial<IRoomSettings>,
    userName?: string
  ): Promise<{ message: string; settings: IRoomSettings }> {
    const response = await fetch(`${API_BASE_URL}/rooms/${roomId}/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...buildRestAuthHeaders(roomId, userName),
      },
      body: JSON.stringify({ settings }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Error al actualizar la configuración');
    }

    return response.json();
  }

  /**
   * Upload or replace video with progress tracking.
   */
  static uploadVideo(
    roomId: string,
    file: File,
    onProgress: (percent: number) => void
  ): Promise<{ message: string; video: IVideoMetadata; status: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('video', file);

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch {
            resolve(xhr.responseText as any);
          }
        } else {
          try {
            const error = JSON.parse(xhr.responseText);
            reject(new Error(error.error || 'Error al subir el video'));
          } catch {
            reject(new Error(`Error ${xhr.status}: Falló la subida`));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Error de red al intentar subir el video'));
      });

      xhr.open('POST', `${API_BASE_URL}/rooms/${roomId}/video`);
      const authHeaders = buildRestAuthHeaders(roomId);
      for (const [key, value] of Object.entries(authHeaders)) {
        xhr.setRequestHeader(key, value);
      }
      xhr.send(formData);
    });
  }

  // ── Panel Admin (ADMIN_TOKEN por header; el token lo escribe el usuario,
  // nunca va en el código) ──────────────────────────────────────────────
  private static adminHeaders(token: string): Record<string, string> {
    return { 'Content-Type': 'application/json', 'x-admin-token': token };
  }

  private static async adminFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...ApiService.adminHeaders(token), ...(init?.headers || {}) },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Error del panel de administración');
    }
    return response.json();
  }

  static adminListRooms(token: string): Promise<{ rooms: any[]; total: number }> {
    return ApiService.adminFetch(token, '/admin/rooms');
  }

  static adminGetRoom(roomId: string, token: string): Promise<any> {
    return ApiService.adminFetch(token, `/admin/rooms/${roomId}`);
  }

  static adminUpdateSettings(
    roomId: string,
    token: string,
    settings: Partial<IRoomSettings>
  ): Promise<{ message: string; settings: IRoomSettings }> {
    return ApiService.adminFetch(token, `/admin/rooms/${roomId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ settings }),
    });
  }

  static adminDeleteRoom(roomId: string, token: string): Promise<{ message: string; roomId: string }> {
    return ApiService.adminFetch(token, `/admin/rooms/${roomId}`, { method: 'DELETE' });
  }

  static adminKick(
    roomId: string,
    token: string,
    body: { targetUserName?: string; targetUserId?: string; ban?: boolean }
  ): Promise<any> {
    return ApiService.adminFetch(token, `/admin/rooms/${roomId}/kick`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  static adminUnban(
    roomId: string,
    token: string,
    body: { targetUserName?: string; targetUserId?: string }
  ): Promise<any> {
    return ApiService.adminFetch(token, `/admin/rooms/${roomId}/unban`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  static adminSetRole(
    roomId: string,
    token: string,
    body: { targetUserName: string; role: 'coleader' | 'member' }
  ): Promise<any> {
    return ApiService.adminFetch(token, `/admin/rooms/${roomId}/role`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  static adminTransferLeader(
    roomId: string,
    token: string,
    body: { targetUserName?: string; targetUserId?: string }
  ): Promise<any> {
    return ApiService.adminFetch(token, `/admin/rooms/${roomId}/transfer-leader`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  static adminRename(
    roomId: string,
    token: string,
    body: { oldName?: string; targetUserId?: string; newName: string }
  ): Promise<any> {
    return ApiService.adminFetch(token, `/admin/rooms/${roomId}/rename`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  static adminMute(
    roomId: string,
    token: string,
    body: { kind: 'mic' | 'camera'; targetUserName?: string; targetUserId?: string }
  ): Promise<any> {
    return ApiService.adminFetch(token, `/admin/rooms/${roomId}/mute`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ── Spotify ("Potify" fase 1) ──────────────────────────────────────────
  static async spotifyStatus(roomId: string): Promise<{ configured: boolean; connected: boolean; roomId: string }> {
    const response = await fetch(`${API_BASE_URL}/spotify/status?roomId=${encodeURIComponent(roomId)}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'No se pudo consultar Spotify');
    }
    return response.json();
  }

  static async spotifyAuthUrl(roomId: string): Promise<{ authUrl: string }> {
    const response = await fetch(`${API_BASE_URL}/spotify/auth-url?roomId=${encodeURIComponent(roomId)}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Spotify no está configurado');
    }
    return response.json();
  }

  static async spotifyDisconnect(roomId: string): Promise<{ connected: boolean }> {
    const response = await fetch(`${API_BASE_URL}/spotify/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'No se pudo desconectar Spotify');
    }
    return response.json();
  }

  static async spotifyResolve(url: string): Promise<{ kind: string; id: string; embedUrl: string; openUrl: string }> {
    const response = await fetch(`${API_BASE_URL}/spotify/resolve?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Enlace de Spotify inválido');
    }
    return response.json();
  }

  /**
   * Busca pistas de Spotify para la cola musical de la sala.
   * GET /api/spotify/search?q=&roomId=&limit=. Lanza Error(error) si !ok.
   */
  static async spotifySearch(
    query: string,
    roomId: string,
    limit?: number
  ): Promise<{ tracks: import('../types/room').IMusicTrack[] }> {
    const params = new URLSearchParams({ q: query, roomId });
    if (typeof limit === 'number' && Number.isFinite(limit)) {
      params.set('limit', String(limit));
    }
    const response = await fetch(`${API_BASE_URL}/spotify/search?${params.toString()}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'No se pudo buscar en Spotify');
    }
    return response.json();
  }

  /**
   * Set video from direct URL, Google Drive or .m3u8 HLS playlist
   * (o enlace de Spotify: el backend lo detecta y lo guarda como `spotify`).
   */
  static async setVideoUrl(
    roomId: string,
    url: string,
    title?: string
  ): Promise<{ message: string; video: IVideoMetadata; status: string }> {
    const response = await fetch(`${API_BASE_URL}/rooms/${roomId}/video-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildRestAuthHeaders(roomId),
      },
      body: JSON.stringify({ url, title }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Error al configurar el enlace de video');
    }

    return response.json();
  }
}
