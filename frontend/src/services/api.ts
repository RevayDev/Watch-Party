import { IRoomData, IVideoMetadata } from '../types/room';

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
    hostName: string,
    isTemporary: boolean = true
  ): Promise<{ roomId: string; hostSecret: string; hostName: string; isTemporary?: boolean }> {
    const response = await fetch(`${API_BASE_URL}/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ hostName, isTemporary }),
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
    const response = await fetch(`${API_BASE_URL}/rooms/${roomId}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userName }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Error al unirse a la sala');
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
      xhr.send(formData);
    });
  }
}
