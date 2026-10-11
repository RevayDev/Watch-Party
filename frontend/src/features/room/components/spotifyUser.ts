/**
 * Spotify vinculado por el propio usuario (sin `.env` en el servidor).
 *
 * Cada persona registra SU app en https://developer.spotify.com/dashboard
 * (solo Client ID, sin secreto: flujo PKCE) y pega el Client ID aquí. Los
 * tokens viven en SU navegador (localStorage); al backend nunca llegan.
 * La sala sigue compartiendo solo cola y selección (metadatos).
 */

const CLIENT_ID_KEY = 'wp_spotify_client_id';
const TOKEN_KEY = 'wp_spotify_self_token';
const OAUTH_STATE_KEY = 'wp_spotify_self_state';

export interface SelfSpotifyToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

export interface SelfSpotifyStatus {
  connected: boolean;
  accountName: string | null;
}

/** Scopes mínimos: leer el estado y controlar la reproducción propia. */
const SCOPES = 'user-read-playback-state user-modify-playback-state';

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* noop */
  }
}

function storageDel(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

/** Client ID propio guardado (o null si el usuario no lo pegó). */
export function getOwnClientId(): string | null {
  const v = (storageGet(CLIENT_ID_KEY) || '').trim();
  return v ? v : null;
}

export function setOwnClientId(clientId: string): void {
  storageSet(CLIENT_ID_KEY, clientId.trim());
}

export function clearOwnSpotify(): void {
  storageDel(CLIENT_ID_KEY);
  storageDel(TOKEN_KEY);
  storageDel(OAUTH_STATE_KEY);
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Verifier PKCE aleatorio (43-128 chars). */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** Challenge S256 del verifier (vector RFC 7636 comprobado en tests). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** URI de retorno: el frontend actual (el usuario la registra en su app). */
export function selfRedirectUri(): string {
  return `${window.location.origin}/`;
}

/**
 * Abre la pestaña OAuth directo desde el clic (anti-bloqueos) y la navega
 * cuando llega la URL. Si falla: intenta cerrarla; si el navegador no deja,
 * escribe un mensaje claro dentro (es about:blank del mismo origen).
 * Devuelve true si navegó a la URL.
 */
export async function openOAuthTab(getAuthUrl: () => Promise<string>): Promise<boolean> {
  let win: Window | null = null;
  try {
    win = window.open('about:blank', '_blank', 'noopener,noreferrer');
  } catch {
    win = null;
  }
  try {
    const authUrl = await getAuthUrl();
    if (win && !win.closed) {
      win.location.href = authUrl;
      return true;
    }
    window.location.href = authUrl;
    return true;
  } catch {
    if (win && !win.closed) {
      try {
        win.close();
      } catch {
        /* noop */
      }
      if (!win.closed) {
        // Último recurso: la pestaña quedó abierta; explicar por qué.
        try {
          win.document.title = 'Spotify no disponible';
          win.document.body.innerHTML =
            '<p style="font-family:sans-serif;padding:2rem">No se pudo iniciar la vinculación ' +
            'de Spotify. Cierra esta pestaña e inténtalo de nuevo.</p>';
        } catch {
          /* noop */
        }
      }
    }
    return false;
  }
}

export interface SelfAuthStart {
  authUrl: string;
}

/**
 * Prepara el OAuth propio: guarda verifier+state y devuelve la URL de
 * Spotify. El llamador debe abrirla directo desde el clic (pestaña nueva).
 */
export async function startSelfOAuth(clientId: string, roomId: string): Promise<SelfAuthStart> {
  const verifier = generateCodeVerifier();
  const challenge = await codeChallenge(verifier);
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const state = `${roomId}.${nonce}.${Date.now()}`;
  storageSet(OAUTH_STATE_KEY, JSON.stringify({ state, verifier, roomId }));
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    response_type: 'code',
    redirect_uri: selfRedirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  return { authUrl: `https://accounts.spotify.com/authorize?${params.toString()}` };
}

/** Resultado del retorno `?spotify=self&code=&state=` (null si no aplica). */
export function readSelfReturn(search: string): { code: string; state: string } | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  if (params.get('spotify') !== 'self') return null;
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  if (!code || !state) return null;
  return { code, state };
}

function readStoredToken(): SelfSpotifyToken | null {
  try {
    const raw = storageGet(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as SelfSpotifyToken;
    if (!t.accessToken) return null;
    return t;
  } catch {
    return null;
  }
}

function writeStoredToken(t: SelfSpotifyToken): void {
  storageSet(TOKEN_KEY, JSON.stringify(t));
}

async function requestToken(body: Record<string, string>): Promise<SelfSpotifyToken> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`Spotify token HTTP ${res.status}`);
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error('Spotify no devolvió access_token');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000,
  };
}

/**
 * Completa el retorno: verifica el state guardado y canjea el código (PKCE,
 * sin secreto). Devuelve true si quedó vinculado.
 */
export async function finishSelfOAuth(search: string): Promise<boolean> {
  const ret = readSelfReturn(search);
  if (!ret) return false;
  let saved: { state: string; verifier: string; roomId: string } | null = null;
  try {
    saved = JSON.parse(storageGet(OAUTH_STATE_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  if (!saved || saved.state !== ret.state) return false;
  storageDel(OAUTH_STATE_KEY);
  const clientId = getOwnClientId();
  if (!clientId) return false;
  try {
    const t = await requestToken({
      grant_type: 'authorization_code',
      code: ret.code,
      redirect_uri: selfRedirectUri(),
      client_id: clientId,
      code_verifier: saved.verifier,
    });
    // Preserva el refresh anterior si Spotify no rota uno nuevo.
    const prev = readStoredToken();
    if (!t.refreshToken && prev?.refreshToken) t.refreshToken = prev.refreshToken;
    writeStoredToken(t);
    return true;
  } catch {
    return false;
  }
}

/** Token válido propio (renueva con el refresh si venció). null si no hay. */
export async function getValidSelfToken(): Promise<string | null> {
  const current = readStoredToken();
  if (!current) return null;
  if (Date.now() < current.expiresAt - 60_000) return current.accessToken;
  const clientId = getOwnClientId();
  if (!clientId || !current.refreshToken) return null;
  try {
    const t = await requestToken({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: clientId,
    });
    if (!t.refreshToken) t.refreshToken = current.refreshToken;
    writeStoredToken(t);
    return t.accessToken;
  } catch {
    return null;
  }
}

/** Estado propio: conectado + nombre de la cuenta (vía /v1/me). */
export async function getSelfStatus(): Promise<SelfSpotifyStatus> {
  if (!getOwnClientId()) return { connected: false, accountName: null };
  const token = await getValidSelfToken();
  if (!token) return { connected: false, accountName: null };
  try {
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { connected: true, accountName: null };
    const me = (await res.json()) as { display_name?: unknown; email?: unknown };
    const name =
      typeof me.display_name === 'string' && me.display_name.trim()
        ? me.display_name.trim()
        : typeof me.email === 'string' && me.email.trim()
          ? me.email.trim()
          : '';
    return { connected: true, accountName: name || null };
  } catch {
    return { connected: true, accountName: null };
  }
}

export interface SelfTrackResult {
  id: string;
  name: string;
  artists: string;
  albumArt?: string;
  durationMs?: number;
  uri?: string;
  openUrl?: string;
}

/** Búsqueda directa con el token propio (sin pasar por el servidor). */
export async function searchSelfTracks(query: string, limit = 10): Promise<SelfTrackResult[]> {
  const q = query.trim();
  if (!q) throw new Error('La búsqueda está vacía.');
  const token = await getValidSelfToken();
  if (!token) throw new Error('Vincula tu cuenta de Spotify primero.');
  const params = new URLSearchParams({
    q,
    type: 'track',
    limit: String(Math.min(20, Math.max(1, Math.floor(limit)))),
    market: 'ES',
  });
  let res: Response;
  try {
    res = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('Spotify no disponible: error de red.');
  }
  if (!res.ok) throw new Error(`Spotify no disponible (HTTP ${res.status}).`);
  const data = (await res.json()) as {
    tracks?: { items?: Array<{ id?: unknown; name?: unknown; artists?: Array<{ name?: unknown }>; album?: { images?: Array<{ url?: unknown }> }; duration_ms?: unknown; uri?: unknown; external_urls?: { spotify?: unknown } }> };
  };
  const items = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
  return items.map((item) => {
    const artists = Array.isArray(item.artists)
      ? item.artists.map((a) => (typeof a?.name === 'string' ? a.name.trim() : '')).filter(Boolean).join(', ')
      : '';
    const images = Array.isArray(item.album?.images) ? item.album.images : [];
    const cover =
      [...images].reverse().find((img) => typeof img?.url === 'string' && (img.url as string).trim()) ?? null;
    const id = typeof item.id === 'string' ? item.id : '';
    return {
      id,
      name: typeof item.name === 'string' ? item.name : '',
      artists,
      albumArt:
        cover && typeof cover.url === 'string' && (cover.url as string).trim()
          ? (cover.url as string).trim()
          : undefined,
      durationMs: typeof item.duration_ms === 'number' ? item.duration_ms : 0,
      uri: typeof item.uri === 'string' ? item.uri : undefined,
      openUrl:
        typeof item.external_urls?.spotify === 'string' && (item.external_urls.spotify as string).trim()
          ? (item.external_urls.spotify as string).trim()
          : `https://open.spotify.com/track/${id}`,
    };
  });
}
