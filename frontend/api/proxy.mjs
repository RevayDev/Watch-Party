import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const budgets = new Map();

// Only Drive's public download hosts may be fetched. Check every redirect too.
export function allowedDriveUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
    !(/^(drive\.google\.com|drive\.usercontent\.google\.com|doc-[\w-]+\.googleusercontent\.com)$/.test(url.hostname))) {
    throw new Error('Solo se permiten enlaces públicos de Google Drive.');
  }
  return url;
}
export function driveRange(value) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(value || 'bytes=0-');
  if (!match) throw new Error('Rango de video inválido.');
  const start = Number(match[1]);
  const end = Math.min(match[2] ? Number(match[2]) : start + 4194303, start + 4194303);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) throw new Error('Rango inválido.');
  return `bytes=${start}-${end}`;
}
export function confirmationUrl(html) {
  const form = html.match(/<form\b[^>]*\bid=["']download-form["'][^>]*>/i)?.[0];
  const action = form?.match(/\baction=["']([^"']+)["']/i)?.[1];
  if (!action) return null;
  const url = allowedDriveUrl(action.replace(/&amp;/g, '&'));
  for (const tag of html.match(/<input\b[^>]*>/gi) || []) {
    const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
    const value = tag.match(/\bvalue=["']([^"']*)["']/i)?.[1];
    if (name) url.searchParams.set(name, (value || '').replace(/&amp;/g, '&'));
  }
  return url;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });
  const now = Date.now(), ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0];
  const budget = budgets.get(ip);
  if (budget?.until > now && budget.count >= 180) return res.status(429).json({ error: 'Demasiadas solicitudes de video. Intenta de nuevo en un minuto.' });
  if (budgets.size > 1000) budgets.clear();
  budgets.set(ip, { until: budget?.until > now ? budget.until : now + 60000, count: budget?.until > now ? budget.count + 1 : 1 });
  let target, range;
  try {
    if (typeof req.query.url !== 'string' || req.query.url.length > 8192) throw new Error('URL inválida');
    target = allowedDriveUrl(req.query.url); range = driveRange(req.headers.range);
  }
  catch { return res.status(400).json({ error: 'Enlace de Drive o rango inválido.' }); }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const closed = () => controller.abort();
  res.once('close', closed);
  try {
    for (let hop = 0; hop < 6; hop++) {
      const upstream = await fetch(target, { redirect: 'manual', signal: controller.signal,
        headers: { Range: range, 'Accept-Encoding': 'identity' } });
      if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
        await upstream.body?.cancel();
        target = allowedDriveUrl(new URL(upstream.headers.get('location'), target)); continue;
      }
      const type = upstream.headers.get('content-type') || '';
      if (type.includes('text/html')) {
        const reader = upstream.body.getReader(); let html = '', bytes = 0;
        const decoder = new TextDecoder();
        while (true) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 262144) { await reader.cancel(); throw new Error('Respuesta de Drive demasiado grande.'); }
          html += decoder.decode(part.value, { stream: true });
        }
        const confirmed = confirmationUrl(html);
        if (confirmed) { target = confirmed; continue; }
        return res.status(502).json({ error: /quota exceeded|cuota excedida/i.test(html)
          ? 'Google Drive agotó la cuota de este archivo.' : 'Google Drive exige acceso o no permite descargar este archivo. Comprueba que sea público.' });
      }
      if (!upstream.ok) { await upstream.body?.cancel(); return res.status(upstream.status === 416 ? 416 : 502).json({ error: 'Google Drive no pudo entregar el video.' }); }
      // A bounded range makes each response short; seeking opens a new request.
      if (upstream.status !== 206 || !upstream.headers.get('content-range')) {
        await upstream.body?.cancel(); return res.status(502).json({ error: 'El origen no admite reproducción por fragmentos.' });
      }
      for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(header); if (value) res.setHeader(header, value);
      }
      res.status(206);
      if (req.method === 'HEAD') { await upstream.body?.cancel(); return res.end(); }
      await pipeline(Readable.fromWeb(upstream.body), res);
      return;
    }
    return res.status(502).json({ error: 'Demasiadas redirecciones de Google Drive.' });
  } catch {
    if (!res.headersSent && !res.destroyed) res.status(502).json({ error: 'No se pudo obtener el video de Google Drive.' });
    else if (!res.destroyed) res.destroy();
  } finally { clearTimeout(timeout); res.off('close', closed); }
}
