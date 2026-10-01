import express, { Express } from 'express';
import cors from 'cors';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import roomRoutes from './routes/room.routes.js';
import { errorHandler } from './middleware/error.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(): Express {
  const app = express();

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
  app.get('/api/proxy', (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl || typeof targetUrl !== 'string') {
      res.status(400).json({ error: 'url query parameter is required' });
      return;
    }

    try {
      new URL(targetUrl); // validate URL
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    const protocol = targetUrl.startsWith('https') ? https : http;

    const proxyReq = protocol.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': new URL(targetUrl).origin + '/',
      },
    }, (proxyRes) => {
      // Handle redirects (301, 302, 303, 307, 308)
      if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        // Follow the redirect through our proxy
        const redirectUrl = new URL(proxyRes.headers.location, targetUrl).href;
        res.redirect(`/api/proxy?url=${encodeURIComponent(redirectUrl)}`);
        return;
      }

      const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
      const isPlaylist = contentType.includes('mpegurl') || targetUrl.includes('.m3u8');

      if (isPlaylist) {
        // For .m3u8 playlists: collect the body, rewrite URLs to route through proxy
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let body = Buffer.concat(chunks).toString('utf-8');

          // Determine base URL for resolving relative paths in the playlist
          const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

          // Rewrite each line that is a URL or relative path to route through our proxy
          body = body.split('\n').map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
              // Check for URI= inside EXT tags (e.g. #EXT-X-KEY:...URI="...")
              if (trimmed.includes('URI="')) {
                return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
                  const absoluteUri = uri.startsWith('http') ? uri : new URL(uri, baseUrl).href;
                  return `URI="/api/proxy?url=${encodeURIComponent(absoluteUri)}"`;
                });
              }
              return line;
            }
            // Non-comment, non-empty line: it's a segment or sub-playlist reference
            const absoluteUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
            return `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`;
          }).join('\n');

          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'no-cache');
          res.send(body);
        });
      } else {
        // For .ts segments, video files, etc. — just pipe through
        const headers: Record<string, string | number> = {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        };
        if (proxyRes.headers['content-length']) {
          headers['Content-Length'] = proxyRes.headers['content-length'];
        }
        if (proxyRes.headers['accept-ranges']) {
          headers['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
        }
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      }
    });

    proxyReq.on('error', (err) => {
      console.error('❌ Proxy error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to fetch external resource', details: err.message });
      }
    });

    // Timeout for slow external servers
    proxyReq.setTimeout(15000, () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: 'External server timed out' });
      }
    });
  });

  // Routes
  app.use('/api/rooms', roomRoutes);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

