import express, { Express, Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import roomRoutes from './routes/room.routes.js';
import { errorHandler } from './middleware/error.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROXY_MAX_REDIRECTS = 5;
const PROXY_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function handleProxyError(res: Response, status: number, message: string, details?: string): void {
  res.status(status).json({ error: message, ...(details ? { details } : {}) });
}

/**
 * Google Drive serves an HTML "virus scan warning" form for large files.
 * Extracts the real download URL (action + hidden inputs like confirm/uuid) from that page.
 */
function extractDriveDownloadUrl(html: string): string | null {
  if (!html.includes('download-form')) return null;

  const formTag = html.match(/<form\b[^>]*>/i);
  const action = formTag?.[0].match(/\baction="([^"]+)"/i)?.[1];
  if (!action) return null;

  try {
    const actionUrl = new URL(action.replace(/&amp;/g, '&'), 'https://drive.google.com');
    const inputs = html.match(/<input\b[^>]*>/gi) || [];
    for (const tag of inputs) {
      const name = tag.match(/\bname="([^"]*)"/i)?.[1];
      const value = tag.match(/\bvalue="([^"]*)"/i)?.[1];
      if (name) actionUrl.searchParams.set(name, (value || '').replace(/&amp;/g, '&'));
    }
    return actionUrl.href;
  } catch {
    return null;
  }
}

/**
 * Google Drive replies to open ranges ("bytes=0-", "bytes=1000-") or no Range at all with an
 * HTML page (virus-scan / quota) instead of the file, and only serves the real bytes when the
 * range has an explicit end. Open ranges are therefore expanded to a fixed-size chunk; closed
 * ranges are forwarded untouched.
 */
function toDriveExplicitRange(range: string | null, chunkSize: number): string {
  if (!range) return `bytes=0-${chunkSize - 1}`;
  const match = range.trim().match(/^bytes=(\d+)-(\d*)$/i);
  if (!match) return range;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : start + chunkSize - 1;
  return `bytes=${start}-${Math.max(end, start)}`;
}

export function createApp(): Express {
  const app = express();

  // Needed to build absolute proxy URLs when running behind Render/Heroku/nginx
  app.set('trust proxy', 1);

  // Basic Middlewares
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static uploads directory
  const uploadsPath = path.join(__dirname, '..', 'uploads');
  app.use('/uploads', express.static(uploadsPath));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'watch-party-backend', timestamp: new Date().toISOString() });
  });

  // ── CORS Proxy for external video streaming (HLS .m3u8, .ts segments, Google Drive, etc.) ──
  const proxyFetch = (
    targetUrl: string,
    req: express.Request,
    res: Response,
    redirectsLeft: number
  ): void => {
    const protocol = targetUrl.startsWith('https') ? https : http;

    const clientRange = typeof req.headers.range === 'string' ? req.headers.range : null;
    const isDriveHost = /(?:drive\.google\.com|drive\.usercontent\.google\.com|doc-[\w-]+\.googleusercontent\.com)/.test(targetUrl);

    const headers: Record<string, string> = {
      'User-Agent': PROXY_USER_AGENT,
      'Accept': (req.headers.accept as string) || '*/*',
      'Referer': new URL(targetUrl).origin + '/',
    };
    if (isDriveHost) {
      headers['Range'] = toDriveExplicitRange(clientRange, 4 * 1024 * 1024);
    } else if (clientRange) {
      headers['Range'] = clientRange;
    }

    const proxyReq = protocol.get(targetUrl, { headers }, (proxyRes) => {
      // Follow redirects server-side (a relative Location would break on other origins)
      const status = proxyRes.statusCode || 0;
      if (status >= 300 && status < 400 && proxyRes.headers.location) {
        proxyRes.resume(); // drain
        if (redirectsLeft <= 0) {
          handleProxyError(res, 508, 'Demasiadas redirecciones al obtener el video externo');
          return;
        }
        const redirectUrl = new URL(proxyRes.headers.location, targetUrl).href;
        proxyFetch(redirectUrl, req, res, redirectsLeft - 1);
        return;
      }

      const contentType = (proxyRes.headers['content-type'] as string) || 'application/octet-stream';
      const isPlaylist = contentType.includes('mpegurl') || targetUrl.includes('.m3u8');

      if (isPlaylist) {
        // For .m3u8 playlists: collect the body, rewrite URLs to route through proxy
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let body = Buffer.concat(chunks).toString('utf-8');

          // Determine base URL for resolving relative paths in the playlist
          const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
          // Absolute proxy origin so it also works when frontend and backend live on different domains
          const proxyOrigin = `${req.protocol}://${req.get('host')}`;
          const toProxy = (absoluteUrl: string) => `${proxyOrigin}/api/proxy?url=${encodeURIComponent(absoluteUrl)}`;

          // Rewrite each line that is a URL or relative path to route through our proxy
          body = body.split('\n').map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
              // Check for URI= inside EXT tags (e.g. #EXT-X-KEY:...URI="...")
              if (trimmed.includes('URI="')) {
                return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
                  const absoluteUri = uri.startsWith('http') ? uri : new URL(uri, baseUrl).href;
                  return `URI="${toProxy(absoluteUri)}"`;
                });
              }
              return line;
            }
            // Non-comment, non-empty line: it's a segment or sub-playlist reference
            const absoluteUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
            return toProxy(absoluteUrl);
          }).join('\n');

          res.status(status);
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'no-cache');
          res.send(body);
        });
      } else if (contentType.includes('text/html')) {
        // HTML instead of video (Google Drive virus-scan page, quota page, login wall, error page)
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf-8');
          const downloadUrl = extractDriveDownloadUrl(html);
          if (downloadUrl && downloadUrl !== targetUrl && redirectsLeft > 0) {
            // Follow the real download link extracted from the confirmation form
            proxyFetch(downloadUrl, req, res, redirectsLeft - 1);
            return;
          }
          console.warn(`⚠️ Proxy: el recurso devolvió HTML en vez de video: ${targetUrl}`);
          const isQuota = /quota exceeded|cuota excedida/i.test(html);
          const message = isQuota
            ? 'Google Drive excedió su cuota de descargas para este archivo. Intenta más tarde o usa otro enlace.'
            : 'El enlace devolvió una página HTML en vez del video. Verifica que el archivo sea público.';
          res.status(502);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.send(JSON.stringify({ error: message }));
        });
      } else {
        // For .ts segments, video files, etc. — just pipe through (keeping 206 ranges)
        const outHeaders: Record<string, string | number> = {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        };
        for (const h of ['content-length', 'accept-ranges', 'content-range']) {
          const value = proxyRes.headers[h];
          if (value) outHeaders[h.replace(/(^|-)([a-z])/g, (_m, p1, p2) => p1 + p2.toUpperCase())] = value as string;
        }
        res.writeHead(status || 200, outHeaders);
        proxyRes.pipe(res);
      }
    });

    proxyReq.on('error', (err) => {
      console.error('❌ Proxy error:', err.message);
      if (!res.headersSent) {
        handleProxyError(res, 502, 'No se pudo obtener el video externo', err.message);
      }
    });

    // Timeout for slow external servers
    proxyReq.setTimeout(20000, () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        handleProxyError(res, 504, 'El servidor del video externo no responde');
      }
    });
  };

  app.get('/api/proxy', (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl || typeof targetUrl !== 'string') {
      res.status(400).json({ error: 'url query parameter is required' });
      return;
    }

    try {
      const parsed = new URL(targetUrl); // validate URL
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        res.status(400).json({ error: 'Only http(s) URLs are allowed' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    proxyFetch(targetUrl, req, res, PROXY_MAX_REDIRECTS);
  });

  // Routes
  app.use('/api/rooms', roomRoutes);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

