import type { ISpotifyConnection } from '../types/spotify.types.js';

/**
 * Puerto de persistencia de la conexión Spotify por sala (hexagonal).
 * El servicio programa contra esta interfaz; los adaptadores
 * memoria / Mongo / Prisma la implementan. Opera sobre ISpotifyConnection.
 */
export interface SpotifyConnectionRepository {
  /** Conexión por roomId (normalizado). Null si no existe. */
  get(roomId: string): Promise<ISpotifyConnection | null>;
  /** Inserta o actualiza (upsert por roomId). Retorna la conexión guardada. */
  save(conn: ISpotifyConnection): Promise<ISpotifyConnection>;
  /** Elimina por roomId. true si existía. */
  delete(roomId: string): Promise<boolean>;
}
