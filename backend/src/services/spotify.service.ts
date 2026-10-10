import { issueSpotifyState } from './spotify-state.js';
import { decryptFromB64, encryptToB64, hasSpotifyTokenKey } from './spotify-crypto.js';
import { spotifyConnectionRepository } from '../adapters/spotify-connection-routing.js';

/**
 * Spotify fase B — OAuth endurecido + conexión persistente + búsqueda.
 * - OAuth: `state` anti-CSRF de un solo uso (ver `spotify-state.ts`).
 * - Conexión: tokens cifrados por sala (ver `spotify-crypto.ts` + puerto
 *   `SpotifyConnectionRepository`); sin `SPOTIFY_TOKEN_KEY` válida se cae a
 *   memoria efímera con aviso (nunca rompe el flujo).
 * - Búsqueda: client-credentials sin usuario (el embed no necesita token).
 * Jamás se exponen tokens en respuestas ni logs (solo booleans).
 */

interface SpotifyToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

const tokens = new Map<string, SpotifyToken>();

/** Scopes mínimos: reproducir en el propio dispositivo (fase B). */
const SCOPES = ['user-read-playback-state', 'user-modify-playback-state'].join(' ');

/** Resultado normalizado de una búsqueda de canciones. */
export interface SpotifyTrackResult {
  id: string;
  name: string;
  artists: string;
  albumArt: string | null;
  durationMs: number;
  uri: string;
  openUrl: string;
}

export function spotifyClientId(): string {
  return (process.env.SPOTIFY_CLIENT_ID || '').trim();
}

export function spotifyRedirectUri(): string {
  return (process.env.SPOTIFY_REDIRECT_URI || '').trim();
}

export function isSpotifyConfigured(): boolean {
  return Boolean(spotifyClientId() && (process.env.SPOTIFY_CLIENT_SECRET || '').trim() && spotifyRedirectUri());
}

function normRoom(roomId: string): string {
  return roomId.toUpperCase().trim();
}

export function getSpotifyAuthUrl(roomId: string): string {
  // State firmado de un solo uso: liga la autorización a la sala (anti-CSRF).
  const state = issueSpotifyState(roomId);
  const params = new URLSearchParams({
    client_id: spotifyClientId(),
    response_type: 'code',
    redirect_uri: spotifyRedirectUri(),
    scope: SCOPES,
    state,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function requestToken(body: Record<string, string>): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number }> {
  const secret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  const basic = Buffer.from(`${spotifyClientId()}:${secret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(`Spotify token HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error('Spotify no devolvió access_token');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 3600,
  };
}

function storeToken(roomId: string, t: { accessToken: string; refreshToken: string | null; expiresIn: number }): void {
  tokens.set(normRoom(roomId), {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    expiresAt: Date.now() + t.expiresIn * 1000,
  });
}

/**
 * Guarda (upsert) la conexión cifrada de la sala, preservando `createdAt`.
 * Sin clave válida cae a memoria efímera con aviso (no lanza).
 */
async function persistConnection(
  roomId: string,
  t: { accessToken: string; refreshToken: string | null; expiresIn: number }
): Promise<void> {
  let refreshEnc: string | null = null;
  let accessEnc: string | null = null;
  const expiresAt = Date.now() + t.expiresIn * 1000;
  try {
    if (t.refreshToken) {
      refreshEnc = encryptToB64(t.refreshToken);
    }
    accessEnc = encryptToB64(t.accessToken);
  } catch {
    console.warn('⚠️ SPOTIFY_TOKEN_KEY no configurada: conexión Spotify solo en memoria efímera.');
    return;
  }
  const key = normRoom(roomId);
  try {
    // Sin refresh nuevo se preserva el cifrado ya guardado (el refresh de
    // Spotify solo llega en la primera autorización o al rotar).
    let previous: { refreshTokenEnc: string; createdAt: Date } | null = null;
    try {
      const found = await spotifyConnectionRepository.get(key);
      if (found) previous = { refreshTokenEnc: found.refreshTokenEnc, createdAt: found.createdAt };
    } catch {
      previous = null;
    }
    const finalRefreshEnc = refreshEnc ?? previous?.refreshTokenEnc ?? null;
    if (!finalRefreshEnc) return;
    const now = new Date();
    await spotifyConnectionRepository.save({
      roomId: key,
      scope: SCOPES,
      refreshTokenEnc: finalRefreshEnc,
      accessTokenEnc: accessEnc ?? undefined,
      accessTokenExpiresAt: expiresAt,
      updatedAt: now,
      createdAt: previous?.createdAt ?? now,
    });
  } catch (error) {
    console.warn('⚠️ No se pudo persistir la conexión Spotify (sigue en memoria):', (error as Error)?.message ?? error);
  }
}

export async function exchangeSpotifyCode(roomId: string, code: string): Promise<void> {
  const t = await requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: spotifyRedirectUri(),
  });
  storeToken(roomId, t);
  await persistConnection(roomId, t);
}

async function refreshStoredToken(roomId: string, current: SpotifyToken): Promise<SpotifyToken | null> {
  if (!current.refreshToken) return null;
  try {
    const t = await requestToken({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
    });
    const merged = {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken ?? current.refreshToken,
      expiresIn: t.expiresIn,
    };
    storeToken(roomId, merged);
    await persistConnection(roomId, merged);
    return tokens.get(normRoom(roomId)) ?? null;
  } catch {
    return null;
  }
}

/** Recupera el token desde la conexión persistente (descifra + refresca). */
async function tokenFromPersistent(key: string): Promise<string | null> {
  if (!hasSpotifyTokenKey()) return null;
  let conn: { refreshTokenEnc: string } | null = null;
  try {
    conn = await spotifyConnectionRepository.get(key);
  } catch {
    return null;
  }
  if (!conn) return null;
  let refresh: string;
  try {
    refresh = decryptFromB64(conn.refreshTokenEnc);
  } catch {
    console.warn('⚠️ No se pudo descifrar la conexión Spotify (¿SPOTIFY_TOKEN_KEY distinta?).');
    return null;
  }
  try {
    const t = await requestToken({ grant_type: 'refresh_token', refresh_token: refresh });
    const merged = {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken ?? refresh,
      expiresIn: t.expiresIn,
    };
    storeToken(key, merged);
    await persistConnection(key, merged);
    return merged.accessToken;
  } catch {
    return null;
  }
}

/** Token válido (refresca si venció y hay refresh_token). null si no hay. */
export async function getValidSpotifyToken(roomId: string): Promise<string | null> {
  const key = normRoom(roomId);
  const current = tokens.get(key);
  if (current) {
    if (Date.now() < current.expiresAt - 60_000) return current.accessToken;
    const refreshed = await refreshStoredToken(key, current);
    if (refreshed?.accessToken) return refreshed.accessToken;
    // El refresh en memoria falló: se intenta la vía persistente abajo.
  }
  return tokenFromPersistent(key);
}

export async function getSpotifyStatus(roomId: string): Promise<{
  configured: boolean;
  connected: boolean;
  persistent: boolean;
  roomId: string;
}> {
  const key = normRoom(roomId);
  const configured = isSpotifyConfigured();
  if (!configured) return { configured, connected: false, persistent: false, roomId: key };
  const token = await getValidSpotifyToken(roomId);
  let persistent = false;
  if (hasSpotifyTokenKey()) {
    try {
      persistent = (await spotifyConnectionRepository.get(key)) !== null;
    } catch {
      persistent = false;
    }
  }
  return { configured, connected: token !== null, persistent, roomId: key };
}

/** Borra la conexión en memoria Y en el repositorio persistente. */
export async function disconnectSpotify(roomId: string): Promise<void> {
  const key = normRoom(roomId);
  tokens.delete(key);
  try {
    await spotifyConnectionRepository.delete(key);
  } catch (error) {
    console.warn('⚠️ No se pudo borrar la conexión Spotify persistente:', (error as Error)?.message ?? error);
  }
}

/** Solo para tests: limpia el store en memoria (tokens + app-token). */
export function clearSpotifyTokens(): void {
  tokens.clear();
  appTokenCache = null;
}

// ── Búsqueda (client-credentials, sin usuario) ──────────────────────────────

interface AppTokenCache {
  token: string;
  exp: number;
}

let appTokenCache: AppTokenCache | null = null;

/** Solo para tests: vacía la caché del token de aplicación. */
export function clearSpotifyAppToken(): void {
  appTokenCache = null;
}

/** Token de aplicación (client-credentials), cacheado ~55 min. */
export async function getAppToken(): Promise<string> {
  if (appTokenCache && Date.now() < appTokenCache.exp) return appTokenCache.token;
  const t = await requestToken({ grant_type: 'client_credentials' });
  // Margen de 5 min sobre `expires_in` (típico 3600 s → ~55 min de caché).
  const ttl = Math.max(60_000, (t.expiresIn - 300) * 1000);
  appTokenCache = { token: t.accessToken, exp: Date.now() + ttl };
  return t.accessToken;
}

interface SpotifySearchItem {
  id?: unknown;
  name?: unknown;
  artists?: Array<{ name?: unknown }>;
  album?: { images?: Array<{ url?: unknown }> };
  duration_ms?: unknown;
  uri?: unknown;
  external_urls?: { spotify?: unknown };
}

function mapTrack(item: SpotifySearchItem): SpotifyTrackResult {
  const id = typeof item.id === 'string' ? item.id : '';
  const artists = Array.isArray(item.artists)
    ? item.artists
        .map((a) => (typeof a?.name === 'string' ? a.name.trim() : ''))
        .filter(Boolean)
        .join(', ')
    : '';
  const images = Array.isArray(item.album?.images) ? item.album.images : [];
  // Las imágenes vienen de mayor a menor: la última (pequeña) basta en lista.
  const cover =
    [...images].reverse().find((img) => typeof img?.url === 'string' && (img.url as string).trim()) ??
    images.find((img) => typeof img?.url === 'string' && (img.url as string).trim()) ??
    null;
  const openUrl =
    typeof item.external_urls?.spotify === 'string' && (item.external_urls.spotify as string).trim()
      ? (item.external_urls.spotify as string).trim()
      : `https://open.spotify.com/track/${id}`;
  return {
    id,
    name: typeof item.name === 'string' ? item.name : '',
    artists,
    albumArt: cover && typeof cover.url === 'string' ? (cover.url as string).trim() : null,
    durationMs: typeof item.duration_ms === 'number' ? item.duration_ms : 0,
    uri: typeof item.uri === 'string' ? item.uri : '',
    openUrl,
  };
}

/**
 * Busca canciones con el token de aplicación (sin usuario).
 * Lanza Error con mensaje legible si Spotify falla (el controlador → 502).
 */
export async function searchTracks(
  query: string,
  opts: { limit?: number; market?: string } = {}
): Promise<SpotifyTrackResult[]> {
  const q = query.trim();
  if (!q) throw new Error('La búsqueda está vacía.');
  const rawLimit = opts.limit ?? 10;
  const limit = Math.min(20, Math.max(1, Math.floor(rawLimit)));
  const market = (opts.market ?? process.env.SPOTIFY_MARKET ?? 'ES').trim().toUpperCase() || 'ES';
  let token: string;
  try {
    token = await getAppToken();
  } catch {
    throw new Error('Spotify no disponible: no se pudo obtener el token de aplicación.');
  }
  const params = new URLSearchParams({ q, type: 'track', limit: String(limit), market });
  let res: Response;
  try {
    res = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('Spotify no disponible: error de red.');
  }
  if (!res.ok) {
    throw new Error(`Spotify no disponible (HTTP ${res.status}). Inténtalo más tarde.`);
  }
  let data: { tracks?: { items?: SpotifySearchItem[] } };
  try {
    data = (await res.json()) as { tracks?: { items?: SpotifySearchItem[] } };
  } catch {
    throw new Error('Spotify devolvió una respuesta ilegible.');
  }
  const items = Array.isArray(data?.tracks?.items) ? (data.tracks.items as SpotifySearchItem[]) : [];
  return items.map(mapTrack);
}
