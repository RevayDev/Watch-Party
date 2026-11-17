import { Router } from 'express';
import { z } from 'zod';
import { createRateLimiter } from '../middleware/rate-limit.middleware.js';

const router = Router();
const searchLimiter = createRateLimiter({ windowMs: 60_000, max: 8 });

const searchQuery = z.string().trim().min(2).max(100);
const searchResponse = z.object({ items: z.array(z.unknown()).default([]) });
const videoResult = z.object({
  id: z.object({ videoId: z.string().regex(/^[\w-]{11}$/) }),
  snippet: z.object({ title: z.string().min(1), channelTitle: z.string().optional() }),
});

router.get('/search', searchLimiter, async (req, res) => {
  const query = searchQuery.safeParse(req.query.q);
  if (!query.success) {
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
    q: query.data,
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
    const { items } = searchResponse.parse(await response.json());
    const tracks = items.flatMap((item) => {
      const video = videoResult.safeParse(item);
      if (!video.success) return [];
      const { id: { videoId }, snippet } = video.data;
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
