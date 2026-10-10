import type { ISpotifyConnection } from '../types/spotify.types.js';
import type { SpotifyConnectionRepository } from '../ports/spotify-connection.repository.js';
import { getPrismaClient } from './prisma-room.repository.js';

function normalize(roomId: string): string {
  return roomId.toUpperCase().trim();
}

/**
 * Acceso al modelo Prisma `spotifyConnection` (lo añade el coordinador en
 * `prisma/schema.prisma`). Si el cliente aún no lo tiene, se lanza un error
 * legible y el llamador lo trata como "sin persistencia".
 */
function spotifyConnectionDelegate(): {
  findUnique(args: unknown): Promise<unknown>;
  upsert(args: unknown): Promise<unknown>;
  deleteMany(args: unknown): Promise<{ count: number }>;
} {
  const client = getPrismaClient() as unknown as {
    spotifyConnection?: {
      findUnique(args: unknown): Promise<unknown>;
      upsert(args: unknown): Promise<unknown>;
      deleteMany(args: unknown): Promise<{ count: number }>;
    };
  };
  if (!client.spotifyConnection) {
    throw new Error('Modelo Prisma spotifyConnection no disponible (lo añade el coordinador).');
  }
  return client.spotifyConnection;
}

function fromRow(row: unknown): ISpotifyConnection {
  const r = row as Record<string, unknown>;
  return {
    roomId: String(r.roomId ?? '').toUpperCase().trim(),
    spotifyUserId: (r.spotifyUserId as string | undefined) ?? undefined,
    displayName: (r.displayName as string | undefined) ?? undefined,
    scope: String(r.scope ?? ''),
    refreshTokenEnc: String(r.refreshTokenEnc ?? ''),
    accessTokenEnc: (r.accessTokenEnc as string | undefined) ?? undefined,
    accessTokenExpiresAt:
      typeof r.accessTokenExpiresAt === 'number' ? r.accessTokenExpiresAt : undefined,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt : new Date(),
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(),
  };
}

/**
 * Adaptador Prisma (MongoDB) del puerto SpotifyConnectionRepository.
 * Solo se usa con `ROOM_STORE=prisma`; por defecto el routing sigue con
 * Mongoose/memoria.
 */
export class PrismaSpotifyConnectionRepository implements SpotifyConnectionRepository {
  async get(roomId: string): Promise<ISpotifyConnection | null> {
    const row = await spotifyConnectionDelegate().findUnique({
      where: { roomId: normalize(roomId) },
    });
    return row ? fromRow(row) : null;
  }

  async save(conn: ISpotifyConnection): Promise<ISpotifyConnection> {
    const cleanId = normalize(conn.roomId);
    const row = await spotifyConnectionDelegate().upsert({
      where: { roomId: cleanId },
      create: {
        roomId: cleanId,
        spotifyUserId: conn.spotifyUserId ?? null,
        displayName: conn.displayName ?? null,
        scope: conn.scope,
        refreshTokenEnc: conn.refreshTokenEnc,
        accessTokenEnc: conn.accessTokenEnc ?? null,
        accessTokenExpiresAt: conn.accessTokenExpiresAt ?? null,
        createdAt: conn.createdAt ?? new Date(),
        updatedAt: conn.updatedAt ?? new Date(),
      },
      update: {
        spotifyUserId: conn.spotifyUserId ?? null,
        displayName: conn.displayName ?? null,
        scope: conn.scope,
        refreshTokenEnc: conn.refreshTokenEnc,
        accessTokenEnc: conn.accessTokenEnc ?? null,
        accessTokenExpiresAt: conn.accessTokenExpiresAt ?? null,
        updatedAt: conn.updatedAt ?? new Date(),
      },
    });
    return fromRow(row);
  }

  async delete(roomId: string): Promise<boolean> {
    const result = await spotifyConnectionDelegate().deleteMany({
      where: { roomId: normalize(roomId) },
    });
    return result.count > 0;
  }
}

/** Singleton del adaptador Prisma. */
export const prismaSpotifyConnectionRepository = new PrismaSpotifyConnectionRepository();
