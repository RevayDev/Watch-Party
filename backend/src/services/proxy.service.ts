import express, { Response } from 'express';
import https from 'node:https';
import http from 'node:http';

export const PROXY_MAX_REDIRECTS = 5;
export const PROXY_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// Tope de buffering en memoria para playlists/páginas HTML (anti-DoS).
// Los segmentos/binarios van por pipe sin buffering.
export const PROXY_MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

export function handleProxyError(res: Response, status: number, message: string, details?: string): void {
  res.status(status).json({ error: message, ...(details ? { details } : {}) });
}

/**
 * Google Drive serves an HTML "virus scan warning" form for large files.
 * Extracts the real download URL (action + hidden inputs like confirm/uuid) from that page.
 */
export function extractDriveDownloadUrl(html: string): string | null {
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
export function toDriveExplicitRange(range: string | null, chunkSize: number): string {
  if (!range) return `bytes=0-${chunkSize - 1}`;
  const match = range.trim().match(/^bytes=(\d+)-(\d*)$/i);
  if (!match) return range;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : start + chunkSize - 1;
  return `bytes=${start}-${Math.max(end, start)}`;
}

/**
 * CORS Proxy for external video streaming (HLS .m3u8, .ts segments, Google Drive, etc.)
 * Movido verbatim desde app.ts (sin cambios de lógica).
 */
export const proxyFetch = (
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
    // Si el cliente aborta, se libera el upstream de inmediato.
    req.on('close', () => {
      try { proxyRes.destroy(); } catch { /* noop */ }
    });
    proxyRes.on('error', () => {
      try { proxyRes.destroy(); } catch { /* noop */ }
    });
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

    const collectCapped = (onDone: (body: Buffer) => void): void => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let aborted = false;
      proxyRes.on('data', (chunk: Buffer) => {
        if (aborted) return;
        bytes += chunk.length;
        if (bytes > PROXY_MAX_BUFFERED_BYTES) {
          aborted = true;
          try { proxyRes.destroy(); } catch { /* noop */ }
          if (!res.headersSent) {
            handleProxyError(res, 502, 'La respuesta del video externo es demasiado grande');
          }
          return;
        }
        chunks.push(chunk);
      });
      proxyRes.on('end', () => {
        if (aborted || res.headersSent) return;
        onDone(Buffer.concat(chunks));
      });
    };

    if (isPlaylist) {
      // For .m3u8 playlists: collect the body, rewrite URLs to route through proxy
      collectCapped((buffer) => {
        let body = buffer.toString('utf-8');

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
      collectCapped((buffer) => {
        const html = buffer.toString('utf-8');
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

  proxyReq.on('error', (err: Error) => {
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
