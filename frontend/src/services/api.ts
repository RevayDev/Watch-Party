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

  /**
   * Set video from direct URL, Google Drive or .m3u8 HLS playlist
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
