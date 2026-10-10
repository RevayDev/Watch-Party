import type { ISpotifyConnection } from '../types/spotify.types.js';
import type { SpotifyConnectionRepository } from '../ports/spotify-connection.repository.js';

function normalize(roomId: string): string {
  return roomId.toUpperCase().trim();
}

/** Adaptador en memoria de conexiones Spotify (Map por roomId). */
export class MemorySpotifyConnectionRepository implements SpotifyConnectionRepository {
  private readonly conns = new Map<string, ISpotifyConnection>();

  async get(roomId: string): Promise<ISpotifyConnection | null> {
    return this.conns.get(normalize(roomId)) ?? null;
  }

  async save(conn: ISpotifyConnection): Promise<ISpotifyConnection> {
    const copy: ISpotifyConnection = {
      ...conn,
      roomId: normalize(conn.roomId),
      updatedAt: conn.updatedAt ?? new Date(),
      createdAt: conn.createdAt ?? new Date(),
    };
    this.conns.set(copy.roomId, copy);
    return copy;
  }

  async delete(roomId: string): Promise<boolean> {
    return this.conns.delete(normalize(roomId));
  }
}

/** Singleton del adaptador en memoria (conserva el estado entre llamadas). */
export const memorySpotifyConnectionRepository = new MemorySpotifyConnectionRepository();
