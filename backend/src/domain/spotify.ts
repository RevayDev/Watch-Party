/**
 * Spotify ("Potify") fase 1 — helpers puros (sin red).
 * Reconoce enlaces públicos de Spotify y los normaliza al reproductor
 * embebido (`open.spotify.com/embed/...`), que es lo que el frontend
 * muestra en la sala. La reproducción con cuenta Premium (Web Playback API)
 * es un paso posterior; el embed no exige login.
 */

export type SpotifyKind = 'track' | 'playlist' | 'album' | 'episode';

export interface SpotifyRef {
  kind: SpotifyKind;
  id: string;
}

const KINDS: ReadonlySet<string> = new Set(['track', 'playlist', 'album', 'episode']);

/**
 * Extrae `{ kind, id }` de un enlace de Spotify o null si no es válido.
 * Acepta `open.spotify.com/<kind>/<id>`, con locale (`/intl-es/...) y la
 * variante `/embed/...`. Solo http(s).
 */
export function parseSpotifyUrl(raw: unknown): SpotifyRef | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname.toLowerCase() !== 'open.spotify.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  // Quita el prefijo del reproductor (`/embed/...`) y el locale (`/intl-es/...`).
  const segs = parts.filter((s) => s.toLowerCase() !== 'embed');
  const withoutLocale =
    segs.length > 0 && /^intl-[a-z-]{2,}$/i.test(segs[0]) ? segs.slice(1) : segs;
  const [kindRaw, idRaw] = withoutLocale;
  const kind = (kindRaw ?? '').toLowerCase();
  const id = (idRaw ?? '').trim();
  if (!KINDS.has(kind)) return null;
  if (!/^[A-Za-z0-9]{8,}$/.test(id)) return null;
  return { kind: kind as SpotifyKind, id };
}

/** URL del reproductor embebido para una referencia válida. */
export function toEmbedUrl(ref: SpotifyRef): string {
  return `https://open.spotify.com/embed/${ref.kind}/${ref.id}`;
}

/** ¿Parece un enlace de Spotify (aunque el tipo aún no se valide)? */
export function isSpotifyUrl(raw: unknown): boolean {
  return parseSpotifyUrl(raw) !== null;
}

/** Nombre legible por defecto cuando el usuario no da título. */
export function defaultSpotifyName(ref: SpotifyRef): string {
  const label =
    ref.kind === 'track'
      ? 'Canción'
      : ref.kind === 'playlist'
        ? 'Playlist'
        : ref.kind === 'album'
          ? 'Álbum'
          : 'Episodio';
  return `${label} de Spotify`;
}
