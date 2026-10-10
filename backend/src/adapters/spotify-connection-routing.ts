import type { SpotifyConnectionRepository } from '../ports/spotify-connection.repository.js';
import type { ISpotifyConnection } from '../types/spotify.types.js';
import { getIsMongoConnected, getIsPrismaConnected, isPrismaStore } from '../config/database.js';
import { memorySpotifyConnectionRepository } from './memory-spotify-connection.repository.js';
import { mongoSpotifyConnectionRepository } from './mongo-spotify-connection.repository.js';
import { prismaSpotifyConnectionRepository } from './prisma-spotify-connection.repository.js';

/**
 * Repositorio de enrutado: un único punto de acceso que delega según el
 * estado de la conexión (evaluado en cada llamada), igual que
 * `room-repository.routing.ts`.
 * - `ROOM_STORE=prisma` → Prisma (si conectó) o memoria (fallback).
 * - default (`auto`) → Mongoose (si conectó) o memoria (fallback).
 */
class RoutingSpotifyConnectionRepository implements SpotifyConnectionRepository {
  private active(): SpotifyConnectionRepository {
    if (isPrismaStore()) {
      return getIsPrismaConnected() ? prismaSpotifyConnectionRepository : memorySpotifyConnectionRepository;
    }
    return getIsMongoConnected() ? mongoSpotifyConnectionRepository : memorySpotifyConnectionRepository;
  }

  get(roomId: string): Promise<ISpotifyConnection | null> {
    return this.active().get(roomId);
  }

  save(conn: ISpotifyConnection): Promise<ISpotifyConnection> {
    return this.active().save(conn);
  }

  delete(roomId: string): Promise<boolean> {
    return this.active().delete(roomId);
  }
}

/** Singleton usado por el servicio de Spotify. */
export const spotifyConnectionRepository: SpotifyConnectionRepository =
  new RoutingSpotifyConnectionRepository();
