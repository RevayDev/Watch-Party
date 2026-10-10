/**
 * Tipos de la conexión persistente de Spotify por sala.
 * La conexión guarda los tokens CIFRADOS (AES-256-GCM, ver
 * `services/spotify-crypto.ts`): jamás se exponen en respuestas ni logs.
 */
export interface ISpotifyConnection {
  /** Código público de la sala (normalizado: mayúsculas + trim). */
  roomId: string;
  /** Id del usuario de Spotify que autorizó (si se conoce). */
  spotifyUserId?: string;
  /** Nombre visible del usuario de Spotify (si se conoce). */
  displayName?: string;
  /** Scopes concedidos en la autorización. */
  scope: string;
  /** Refresh token cifrado (base64 de iv|tag|ct). */
  refreshTokenEnc: string;
  /** Access token cifrado (base64 de iv|tag|ct). */
  accessTokenEnc?: string;
  /** Vencimiento del access token (ms epoch), si se conoce. */
  accessTokenExpiresAt?: number;
  updatedAt: Date;
  createdAt: Date;
}
