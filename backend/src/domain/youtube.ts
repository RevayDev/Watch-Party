/**
 * Utilitarios puros para YouTube (detección, extracción de Video ID y URLs embebidas).
 */

export interface YouTubeRef {
  videoId: string;
  cleanUrl: string;
  embedUrl: string;
}

const YT_REGEX = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

/**
 * Extrae el videoId de una URL o cadena dada si es de YouTube.
 * Acepta URLs estándar, cortas (youtu.be), embeds y YouTube Shorts.
 */
export function parseYouTubeUrl(raw: unknown): YouTubeRef | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match = trimmed.match(YT_REGEX);
  if (!match || !match[1]) return null;

  const videoId = match[1];
  return {
    videoId,
    cleanUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1`,
  };
}

/**
 * Determina si la URL corresponde a YouTube.
 */
export function isYouTubeUrl(raw: unknown): boolean {
  return parseYouTubeUrl(raw) !== null;
}
