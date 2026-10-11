import type { Request, Response, NextFunction } from 'express';
import { parseSpotifyUrl, toEmbedUrl } from '../domain/spotify.js';
import { RoomService } from '../services/room.service.js';
import {
  disconnectSpotify,
  exchangeSpotifyCode,
  getSpotifyAuthUrl,
  getSpotifyStatus,
  isSpotifyConfigured,
  searchTracks,
} from '../services/spotify.service.js';
import { consumeSpotifyState } from '../services/spotify-state.js';

/**
 * Extrae el roomId del `state` SIN consumir el nonce (solo para saber a qué
 * sala devolver al usuario cuando la autorización falla). null si ilegible.
 */
function peekRoomFromState(state: string | null): string | null {
  if (!state) return null;
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf-8');
    const sep = decoded.lastIndexOf('.');
    if (sep <= 0) return null;
    const room = decoded.slice(0, sep).toUpperCase().trim();
    return room || null;
  } catch {
    return null;
  }
}

/**
 * Spotify fase B — docs/admin-panel-spotify.md §3.
 * `resolve` es público (validar/pegar enlaces). El OAuth guarda el token
 * en el servidor (nunca en el frontend) con `state` anti-CSRF de un solo
 * uso. `search` usa client-credentials (sin usuario) con gates de sala.
 * Errores siempre `{error}`; jamás se exponen tokens en respuestas ni logs.
 */
export class SpotifyController {
  public static async resolve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const raw = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
      if (typeof raw !== 'string' || !raw.trim()) {
        res.status(400).json({ error: 'url es requerida' });
        return;
      }
      const ref = parseSpotifyUrl(raw);
      if (!ref) {
        res.status(400).json({ error: 'No es un enlace válido de Spotify (track, playlist, álbum o episodio).' });
        return;
      }
      res.json({
        kind: ref.kind,
        id: ref.id,
        embedUrl: toEmbedUrl(ref),
        openUrl: raw.trim(),
      });
    } catch (error) {
      next(error);
    }
  }

  public static async status(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const raw = Array.isArray(req.query.roomId) ? req.query.roomId[0] : req.query.roomId;
      if (typeof raw !== 'string' || !raw.trim()) {
        res.status(400).json({ error: 'roomId es requerido' });
        return;
      }
      res.json(await getSpotifyStatus(raw));
    } catch (error) {
      next(error);
    }
  }

  public static async authUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const raw = Array.isArray(req.query.roomId) ? req.query.roomId[0] : req.query.roomId;
      if (typeof raw !== 'string' || !raw.trim()) {
        res.status(400).json({ error: 'roomId es requerido' });
        return;
      }
      if (!isSpotifyConfigured()) {
        res.status(503).json({ error: 'Spotify no está configurado en este servidor (faltan SPOTIFY_CLIENT_ID/SECRET).' });
        return;
      }
      res.json({ authUrl: getSpotifyAuthUrl(raw) });
    } catch (error) {
      next(error);
    }
  }

  public static async callback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pick = (v: unknown): string | null => {
        const s = Array.isArray(v) ? v[0] : v;
        return typeof s === 'string' && s.trim() ? s.trim() : null;
      };
      const client = (process.env.CLIENT_URL || '').trim().replace(/\/$/, '') || '/';
      const backToClient = (roomId: string | null, params: string): void => {
        const base = roomId ? `${client}${client.includes('?') ? '&' : '?'}room=${encodeURIComponent(roomId)}` : client;
        const sep = base.includes('?') ? '&' : '?';
        res.redirect(302, `${base}${sep}${params}`);
      };
      // Spotify redirige con ?error= cuando el usuario cancela o deniega.
      const spotifyError = pick(req.query.error);
      if (spotifyError) {
        res.redirect(302, `${client}${client.includes('?') ? '&' : '?'}spotify=error&reason=cancelled`);
        return;
      }
      const code = pick(req.query.code);
      const state = pick(req.query.state);
      if (!code || !state) {
        backToClient(peekRoomFromState(state), 'spotify=error&reason=invalid');
        return;
      }
      // State de un solo uso: formato, existencia, expiración y sala ligada.
      const roomId = consumeSpotifyState(state);
      if (!roomId) {
        backToClient(peekRoomFromState(state), 'spotify=error&reason=expired');
        return;
      }
      if (!isSpotifyConfigured()) {
        backToClient(roomId, 'spotify=error&reason=not_configured');
        return;
      }
      try {
        await exchangeSpotifyCode(roomId, code);
      } catch {
        backToClient(roomId, 'spotify=error&reason=rejected');
        return;
      }
      const sep = client.includes('?') ? '&' : '?';
      res.redirect(302, `${client}${sep}room=${encodeURIComponent(roomId)}&spotify=connected`);
    } catch (error) {
      next(error);
    }
  }

  public static async disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.body ?? {};
      if (typeof roomId !== 'string' || !roomId.trim()) {
        res.status(400).json({ error: 'roomId es requerido' });
        return;
      }
      await disconnectSpotify(roomId);
      res.json({ connected: false, roomId: roomId.toUpperCase().trim() });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Búsqueda de canciones (client-credentials, sin usuario).
   * `GET /api/spotify/search?q=&roomId=&limit=` → `{tracks: [...]}`.
   */
  public static async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pick = (v: unknown): string | null => {
        const s = Array.isArray(v) ? v[0] : v;
        return typeof s === 'string' && s.trim() ? s.trim() : null;
      };
      const q = pick(req.query.q);
      const roomId = pick(req.query.roomId);
      const limitRaw = pick(req.query.limit);
      if (!q || q.length < 2 || q.length > 80) {
        res.status(400).json({ error: 'q es requerida (2-80 caracteres).' });
        return;
      }
      if (!roomId) {
        res.status(400).json({ error: 'roomId es requerido' });
        return;
      }
      let limit = 10;
      if (limitRaw !== null) {
        const parsed = Number.parseInt(limitRaw, 10);
        if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20) {
          res.status(400).json({ error: 'limit debe ser un número entre 1 y 20.' });
          return;
        }
        limit = parsed;
      }
      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      const settings = (room.settings ?? {}) as {
        musicEnabled?: unknown;
        musicAllowSearch?: unknown;
      };
      if (settings.musicEnabled !== true) {
        res.status(403).json({ error: 'La música está desactivada en esta sala.' });
        return;
      }
      if (settings.musicAllowSearch === false) {
        res.status(403).json({ error: 'La búsqueda está desactivada en esta sala.' });
        return;
      }
      try {
        const tracks = await searchTracks(q, { limit });
        res.json({ tracks });
      } catch (error) {
        res.status(502).json({
          error: error instanceof Error && error.message ? error.message : 'Spotify no disponible.',
        });
      }
    } catch (error) {
      next(error);
    }
  }
}
