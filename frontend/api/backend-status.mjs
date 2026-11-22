let cached = null;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  if (req.query?.refresh !== '1' && cached && cached.until > Date.now()) return res.status(200).json(cached.body);
  const configured = process.env.ROOM_BACKEND_URL || process.env.VITE_API_URL;
  let body = { ok: false, availability: null };
  try {
    const base = new URL(configured);
    if (base.protocol !== 'https:') throw new Error('Backend HTTPS requerido');
    const health = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(2000), redirect: 'error' });
    const status = await health.json();
    if (health.ok && status.ok === true) {
      body.ok = true;
      try {
        const availability = await fetch(new URL('/api/demo/availability', base), { signal: AbortSignal.timeout(2000), redirect: 'error' });
        if (availability.ok) body.availability = await availability.json();
      } catch { /* Room creation can work without demo counters. */ }
    }
  } catch { /* Sleeping Render is an available host-mode path, not a page error. */ }
  cached = { until: Date.now() + (body.ok ? 5000 : 15000), body };
  return res.status(200).json(body);
}
