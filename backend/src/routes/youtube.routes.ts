import { Router } from 'express';
import { z } from 'zod';
import { createRateLimiter } from '../middleware/rate-limit.middleware.js';
import { describeYouTubeProvider, getYouTubeProvider, registerYouTubeProvider, revokeYouTubeProvider } from '../services/youtube-provider.service.js';

const router = Router();
const searchLimiter = createRateLimiter({ windowMs: 60_000, max: 8 });
const registerLimiter = createRateLimiter({ windowMs: 60_000, max: 4 });

router.get('/status', (_req, res) => res.json({ configured: !!process.env.YOUTUBE_API_KEY?.trim() }));
router.post('/providers', registerLimiter, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.status(201).json(registerYouTubeProvider(req.body)); }
  catch (error) { res.status(400).json({ error: error instanceof z.ZodError ? 'Revisa la clave o el endpoint.' : error instanceof Error ? error.message : 'Configuración inválida.' }); }
});
router.get('/providers/:id', (req, res) => {
  const provider = describeYouTubeProvider(req.params.id);
  if (!provider) { res.status(410).json({ error: 'La configuración expiró. Vuelve a registrarla.' }); return; }
  res.json(provider);
});
router.delete('/providers/:id', (req, res) => {
  if (!revokeYouTubeProvider(req.params.id, req.headers.authorization?.replace(/^Bearer /, '') || '')) { res.sendStatus(403); return; }
  res.sendStatus(204);
});

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

  const providerId = req.headers.authorization?.replace(/^Bearer /, '');
  const provider = providerId ? getYouTubeProvider(providerId) : undefined;
  if (providerId && !provider) { res.status(410).json({ error: 'El proveedor de la sala expiró. Regístralo de nuevo en Configuración → YouTube.' }); return; }
  const key = provider?.kind === 'google' ? provider.secret : process.env.YOUTUBE_API_KEY?.trim();
  if (provider?.kind === 'endpoint') {
    try {
      const url = new URL(provider.endpoint!);
      url.searchParams.set('q', query.data);
      const response = await fetch(url, { headers: provider.secret ? { Authorization: `Bearer ${provider.secret}` } : {}, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      const data = z.object({ tracks: z.array(z.object({ id: z.string().regex(/^[\w-]{11}$/), name: z.string().min(1).max(200), artists: z.string().max(200).optional() })).max(50) }).parse(await response.json());
      res.json({ tracks: data.tracks.map((track) => ({ ...track, artists: track.artists || 'YouTube', albumArt: `https://img.youtube.com/vi/${track.id}/mqdefault.jpg`, uri: `https://www.youtube.com/watch?v=${track.id}`, openUrl: `https://www.youtube.com/watch?v=${track.id}` })) });
    } catch { res.status(502).json({ error: 'El endpoint no devolvió resultados válidos. Comprueba su configuración.' }); }
    return;
  }
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
