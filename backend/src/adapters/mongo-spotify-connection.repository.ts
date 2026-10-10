import type { ISpotifyConnection } from '../types/spotify.types.js';
import type { SpotifyConnectionRepository } from '../ports/spotify-connection.repository.js';
import { SpotifyConnectionModel } from '../models/spotify-connection.model.js';

function normalize(roomId: string): string {
  return roomId.toUpperCase().trim();
}

/** Adaptador MongoDB del puerto SpotifyConnectionRepository. */
export class MongoSpotifyConnectionRepository implements SpotifyConnectionRepository {
  async get(roomId: string): Promise<ISpotifyConnection | null> {
    const row = await SpotifyConnectionModel.findOne({ roomId: normalize(roomId) }).lean();
    return (row as unknown as ISpotifyConnection) ?? null;
  }

  async save(conn: ISpotifyConnection): Promise<ISpotifyConnection> {
    const cleanId = normalize(conn.roomId);
    const saved = await SpotifyConnectionModel.findOneAndUpdate(
      { roomId: cleanId },
      {
        $set: {
          roomId: cleanId,
          spotifyUserId: conn.spotifyUserId,
          displayName: conn.displayName,
          scope: conn.scope,
          refreshTokenEnc: conn.refreshTokenEnc,
          accessTokenEnc: conn.accessTokenEnc,
          accessTokenExpiresAt: conn.accessTokenExpiresAt,
          updatedAt: conn.updatedAt ?? new Date(),
        },
        $setOnInsert: { createdAt: conn.createdAt ?? new Date() },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return saved as unknown as ISpotifyConnection;
  }

  async delete(roomId: string): Promise<boolean> {
    const result = await SpotifyConnectionModel.deleteOne({ roomId: normalize(roomId) });
    return result.deletedCount > 0;
  }
}

/** Singleton del adaptador MongoDB. */
export const mongoSpotifyConnectionRepository = new MongoSpotifyConnectionRepository();
