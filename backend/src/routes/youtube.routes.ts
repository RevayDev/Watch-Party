import { Router } from 'express';
import { createRateLimiter } from '../middleware/rate-limit.middleware.js';

const router = Router();
const searchLimiter = createRateLimiter({ windowMs: 60_000, max: 8 });

interface SearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string };
}

router.get('/search', searchLimiter, async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 100) {
    res.status(400).json({ error: 'Escribe entre 2 y 100 caracteres para buscar.' });
    return;
  }

  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) {
    res.status(503).json({ error: 'La búsqueda de YouTube aún no está configurada. Puedes pegar un enlace.' });
    return;
  }

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    maxResults: '12',
    q: query,
  });

  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
      headers: { 'X-Goog-Api-Key': key },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      res.status(502).json({ error: 'YouTube no pudo completar la búsqueda. Puedes pegar un enlace.' });
      return;
    }
    const { items = [] } = (await response.json()) as { items?: SearchItem[] };
    const tracks = items.flatMap(({ id, snippet }) => {
      const videoId = id?.videoId;
      if (!videoId || !/^[\w-]{11}$/.test(videoId) || !snippet?.title) return [];
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      return [{
        id: videoId,
        name: snippet.title,
        artists: snippet.channelTitle || 'YouTube',
        albumArt: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        uri: url,
        openUrl: url,
      }];
    });
    res.json({ tracks });
  } catch {
    res.status(502).json({ error: 'No se pudo contactar con YouTube. Inténtalo de nuevo.' });
  }
});

export default router;
