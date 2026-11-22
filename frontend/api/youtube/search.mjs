// Cache and budget apply per warm function instance; Google enforces total quota.
const cache = new Map();
const budgets = new Map();
// Server-only credential: never use a VITE_ variable for this key.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2 || q.length > 100) return res.status(400).json({ error: 'Escribe entre 2 y 100 caracteres.' });
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return res.status(503).json({ error: 'Configura YOUTUBE_API_KEY en Vercel para activar las búsquedas.' });
  const now = Date.now(), normalized = q.toLowerCase();
  const cached = cache.get(normalized);
  if (cached?.until > now) return res.status(200).json(cached.body);
  const ip = String(req.headers?.['x-forwarded-for'] || 'unknown').split(',')[0];
  const budget = budgets.get(ip);
  if (budget?.until > now && budget.count >= 8) return res.status(429).json({ error: 'Espera un minuto antes de seguir buscando.' });
  if (budgets.size > 1000) budgets.clear();
  budgets.set(ip, { until: budget?.until > now ? budget.until : now + 60000, count: budget?.until > now ? budget.count + 1 : 1 });
  try {
    const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '12', q });
    const upstream = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
      headers: { 'X-Goog-Api-Key': key }, signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) return res.status(502).json({ error: 'YouTube rechazó la búsqueda. Revisa la clave y su cuota.' });
    const data = await upstream.json();
    const tracks = (data.items || []).flatMap(item => {
      const id = item.id?.videoId;
      if (!/^[\w-]{11}$/.test(id || '') || typeof item.snippet?.title !== 'string') return [];
      const url = `https://www.youtube.com/watch?v=${id}`;
      return [{ id, name: item.snippet.title, artists: item.snippet.channelTitle || 'YouTube',
        albumArt: `https://img.youtube.com/vi/${id}/mqdefault.jpg`, uri: url, openUrl: url }];
    });
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(normalized, { until: now + 60000, body: { tracks } });
    return res.status(200).json({ tracks });
  } catch { return res.status(502).json({ error: 'No se pudo contactar con YouTube. Inténtalo de nuevo.' }); }
}
