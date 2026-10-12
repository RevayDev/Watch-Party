/**
 * Helpers para YouTube en el frontend (parseo de URL, IDs, iframe API).
 */

export interface YouTubeRef {
  videoId: string;
  cleanUrl: string;
  embedUrl: string;
}

const YT_REGEX = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

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

export function isYouTubeUrl(raw: unknown): boolean {
  return parseYouTubeUrl(raw) !== null;
}
