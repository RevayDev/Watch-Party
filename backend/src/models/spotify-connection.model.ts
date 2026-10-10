import mongoose, { Schema, Document } from 'mongoose';
import type { ISpotifyConnection } from '../types/spotify.types.js';

export interface SpotifyConnectionDocument extends ISpotifyConnection, Document {}

/**
 * Conexión Spotify por sala (tokens siempre cifrados, ver spotify-crypto.ts).
 * Colección `spotifyconnections`, una fila por roomId.
 */
const SpotifyConnectionSchema = new Schema<SpotifyConnectionDocument>(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    spotifyUserId: { type: String, default: undefined },
    displayName: { type: String, default: undefined },
    scope: { type: String, required: true },
    refreshTokenEnc: { type: String, required: true },
    accessTokenEnc: { type: String, default: undefined },
    accessTokenExpiresAt: { type: Number, default: undefined },
  },
  {
    timestamps: true,
    collection: 'spotifyconnections',
  }
);

export const SpotifyConnectionModel =
  mongoose.models.SpotifyConnection ??
  mongoose.model<SpotifyConnectionDocument>('SpotifyConnection', SpotifyConnectionSchema);
