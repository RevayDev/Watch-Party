import { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomService } from '../services/room.service.js';
import { DemoCapacityError, maxUsersForRoom } from '../services/room.service.js';
import { IVideoMetadata } from '../types/room.types.js';
import { findBannedEntry, isNameTaken } from '../domain/room.entity.js';
import { AuthClaim, requireLeader, requireModerator } from '../domain/auth-policy.js';
import { sanitizeRoomSettings } from '../domain/settings-policy.js';
import {
  DEMO_ROOM_FULL_MESSAGE,
  DEMO_UPLOAD_DISABLED_MESSAGE,
  isDemoMode,
} from '../config/demo-mode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '../../uploads');

const PROBE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Claim de autorización desde los headers del contrato REST:
 * `x-leader-secret`, `x-user-id`, `x-user-name` (misma regla que sockets).
 */
function claimFromHeaders(req: Request): AuthClaim {
  const pick = (name: string): string | undefined => {
    const raw = req.headers?.[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed ? trimmed : undefined;
  };
  return {
    leaderSecret: pick('x-leader-secret'),
    requesterUserId: pick('x-user-id'),
    requesterName: pick('x-user-name'),
  };
}

/** userId del cuerpo (join) con fallback al header del contrato. */
function requestUserId(req: Request): string | undefined {
  const body = (req.body ?? {}) as { userId?: unknown };
  const fromBody = typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : undefined;
  return fromBody ?? claimFromHeaders(req).requesterUserId;
}

/**
 * Verify an external video URL is alive before saving it to the room.
 * Returns null when the URL is usable, otherwise a human-readable error.
 */
export async function probeExternalUrl(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': PROBE_USER_AGENT,
        'Accept': '*/*',
        'Referer': new URL(url).origin + '/',
        'Range': 'bytes=0-2047',
      },
    });
    await res.body?.cancel().catch(() => {});

    const status = res.status;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (status >= 200 && status < 300) {
      // Drive/Yandex return an HTML page (virus-scan warning, login, error) instead of the video
      const looksLikeVideoLink = /\.(m3u8|mp4|webm|mkv|mov|ts)(\?|$)/i.test(url)
        || url.includes('google.com/')
        || url.includes('yandex.')
        || url.includes('/hls/');
      if (contentType.includes('text/html') && looksLikeVideoLink) {
        return 'El enlace devolvió una página HTML en vez del video. Verifica que el archivo sea público y no tenga restricciones de Drive.';
      }
      return null;
    }

    if (status === 404 || status === 410) {
      return `El enlace ya no existe o expiró (HTTP ${status}). Genera uno nuevo e inténtalo otra vez.`;
    }
    if (status === 401 || status === 403) {
      return `El servidor del video rechazó el acceso (HTTP ${status}). El enlace debe ser público.`;
    }
    if (status >= 500) {
      return `El servidor del video falló (HTTP ${status}). Intenta más tarde o usa otro enlace.`;
    }
    if (status >= 400) {
      return `El enlace no es válido (HTTP ${status}).`;
    }
    return null;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return 'El servidor del video no respondió a tiempo. Verifica el enlace.';
    }
    return `No se pudo conectar con el enlace: ${err?.message || 'error de red'}.`;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best human-readable name for a linked video when the user did not provide a title.
 * For Google Drive files it reads the real file name from the (public) view page.
 */
async function resolveFallbackVideoName(cleanUrl: string, isHls: boolean, driveFileId?: string): Promise<string> {
  if (driveFileId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`https://drive.google.com/file/d/${driveFileId}/view`, {
        signal: controller.signal,
        headers: { 'User-Agent': PROBE_USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
      });
      if (res.ok) {
        const html = (await res.text()).slice(0, 60000);
        const match = html.match(/<title>([^<]+)<\/title>/i);
        if (match && match[1]) {
          const name = match[1]
            .replace(/\s*-\s*Google Drive\s*$/i, '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .trim();
          if (name) return name;
        }
      }
    } catch {
      // Ignore: fall through to the generic name
    } finally {
      clearTimeout(timer);
    }
    return 'Video de Google Drive';
  }

  if (isHls) return 'Transmisión HLS en Vivo';

  const lastSegment = cleanUrl.split('?')[0].split('/').filter(Boolean).pop() || '';
  const isGeneric =
    !lastSegment ||
    !lastSegment.includes('.') ||
    /^(download|uc|index|playlist|stream|video|file)$/i.test(lastSegment);
  return isGeneric ? 'Video por enlace web' : lastSegment;
}

export class RoomController {
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { leaderName, isTemporary } = req.body;
      if (!leaderName || typeof leaderName !== 'string' || leaderName.trim().length === 0) {
        res.status(400).json({ error: 'leaderName is required' });
        return;
      }

      const userId = requestUserId(req);

      const { room, leaderSecret } = await RoomService.createRoom({
        leaderName,
        isTemporary: isTemporary !== undefined ? Boolean(isTemporary) : true,
        userId,
      });

      res.status(201).json({
        roomId: room.roomId,
        leaderName: room.leaderName,
        leaderSecret,
        status: room.status,
        isTemporary: room.isTemporary !== false,
        createdAt: room.createdAt,
      });
    } catch (error) {
      // Cuota demo: 429 con el mensaje EXACTO del contrato (no 500).
      if (error instanceof DemoCapacityError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      next(error);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }

      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      res.json({
        roomId: room.roomId,
        leaderName: room.leaderName,
        status: room.status,
        isTemporary: room.isTemporary !== false,
        settings: room.settings,
        video: room.video || null,
        participants: room.participants,
        createdAt: room.createdAt,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async join(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      const { userName } = req.body;

      if (!userName || typeof userName !== 'string' || userName.trim().length === 0) {
        res.status(400).json({ error: 'userName is required' });
        return;
      }

      const cleanId = roomId.toUpperCase().trim();
      const trimmedName = userName.trim();
      const userId = requestUserId(req);

      const existing = await RoomService.getRoomById(cleanId);
      if (!existing) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      // ── Ban check (H4: espejo del chequeo del socket `join-room`) ──
      const bannedEntry = findBannedEntry(existing, userId, trimmedName);
      if (bannedEntry) {
        res.status(403).json({ error: 'Has sido baneado de esta sala y no puedes volver a entrar.' });
        return;
      }

      // ── Colisión de nombres (H8): el nombre lo usa otra identidad ──
      if (isNameTaken(existing.participants || [], userId, trimmedName)) {
        res.status(409).json({
          error: `El nombre "${trimmedName}" ya está en uso por otro participante. Elige otro nombre.`,
        });
        return;
      }

      // ── Approval-gated rooms: do NOT add the guest to participants here.
      // The socket 'join-room' handler holds them in the waiting list until the
      // leader/co-leader approves. Adding them here would bypass the approval gate.
      const requireApproval = existing.settings?.requireApproval === true;
      const isLeaderName = existing.leaderName.toLowerCase() === trimmedName.toLowerCase();
      // Identidad estable: el rejoin con el mismo userId nunca pasa por la puerta.
      const alreadyParticipant = (existing.participants || []).some((p) => {
        if (userId && p.userId) return p.userId === userId;
        return !p.userId && p.name.toLowerCase() === trimmedName.toLowerCase();
      });

      // ── Cuota demo: sala llena (según plan) → 429, salvo rejoin/merge
      // que no consumen cupo. Va antes de la puerta de aprobación: una sala
      // llena tampoco acepta nuevas solicitudes en espera.
      if (
        isDemoMode() &&
        !alreadyParticipant &&
        (existing.participants || []).length >= maxUsersForRoom(existing)
      ) {
        res.status(429).json({ error: DEMO_ROOM_FULL_MESSAGE });
        return;
      }

      if (requireApproval && !isLeaderName && !alreadyParticipant) {
        res.json({
          roomId: existing.roomId,
          leaderName: existing.leaderName,
          status: existing.status,
          participants: existing.participants,
          pendingApproval: true,
        });
        return;
      }

      let room;
      try {
        room = await RoomService.joinRoom(cleanId, trimmedName, 'Web Browser', userId);
      } catch (error) {
        // Carrera residual (dos joins paralelos): el servicio reserva el cupo
        // bajo mutex; el perdedor recibe el 429 exacto en vez de un 500.
        if (error instanceof DemoCapacityError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }
        throw error;
      }
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      res.json({
        roomId: room.roomId,
        leaderName: room.leaderName,
        status: room.status,
        participants: room.participants,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async uploadVideo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      const file = req.file;

      // Demo: subida de archivos deshabilitada (la demo reproduce por enlace
      // Drive via `video-url`/proxy, intactos). Si multer ya escribió el
      // archivo (esta guarda es el respaldo del middleware previo a multer),
      // se borra el huérfano como en el resto de rechazos.
      if (isDemoMode()) {
        if (file) {
          RoomService.removeOldVideoFile(file.filename);
        }
        res.status(403).json({ error: DEMO_UPLOAD_DISABLED_MESSAGE });
        return;
      }

      // Rechazo del fileFilter (tipo de archivo no soportado) → 400
      const validationError = (req as unknown as { fileValidationError?: string }).fileValidationError;
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      if (!file) {
        res.status(400).json({ error: 'No se envió ningún archivo de video válido' });
        return;
      }

      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      // Anfitrión o co-anfitrión (secreto válido o rol del servidor). Se limpia
      // el archivo ya subido por multer para no dejar huérfanos en disco.
      if (!requireModerator(room, claimFromHeaders(req))) {
        RoomService.removeOldVideoFile(file.filename);
        res.status(403).json({ error: 'Solo el anfitrión o un co-anfitrión puede subir el video de la sala.' });
        return;
      }

      const videoMetadata: IVideoMetadata = {
        originalName: file.originalname,
        fileName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        durationSeconds: 0,
        sourceType: 'file',
      };

      const updatedRoom = await RoomService.updateRoomVideo(roomId, videoMetadata);

      console.log(`🎬 Video subido para la sala ${roomId}: ${file.originalname} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);

      res.json({
        message: 'Video subido correctamente',
        video: updatedRoom?.video,
        status: updatedRoom?.status,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Set a direct video URL (e.g., .m3u8 HLS, Google Drive direct stream, or web MP4)
   */
  public static async setVideoUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      const { url, title } = req.body;

      if (!url || typeof url !== 'string' || url.trim().length === 0) {
        res.status(400).json({ error: 'url is required' });
        return;
      }

      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      // Anfitrión o co-anfitrión (secreto válido o rol del servidor).
      if (!requireModerator(room, claimFromHeaders(req))) {
        res.status(403).json({ error: 'Solo el anfitrión o un co-anfitrión puede configurar el video de la sala.' });
        return;
      }

      let cleanUrl = url.trim();
      // Google Drive link conversion helper (e.g. drive.google.com/file/d/ID/view -> direct stream)
      const driveMatch = cleanUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
        || cleanUrl.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
      const driveFileId = driveMatch?.[1];
      if (driveFileId) {
        // drive.usercontent.google.com + confirm=t streams large files directly (bypasses the virus-scan HTML page)
        cleanUrl = `https://drive.usercontent.google.com/download?id=${driveFileId}&export=download&confirm=t`;
      }

      const isHls = cleanUrl.includes('.m3u8') || cleanUrl.includes('/hls/');

      const probeError = await probeExternalUrl(cleanUrl);
      if (probeError) {
        res.status(400).json({ error: probeError });
        return;
      }

      const originalName =
        title?.trim() || (await resolveFallbackVideoName(cleanUrl, isHls, driveFileId));

      const videoMetadata: IVideoMetadata = {
        originalName,
        fileName: cleanUrl,
        mimeType: isHls ? 'application/x-mpegURL' : 'video/mp4',
        sizeBytes: 0,
        durationSeconds: 0,
        sourceType: isHls ? 'hls' : 'url',
        directUrl: cleanUrl,
      };

      const updatedRoom = await RoomService.updateRoomVideo(roomId, videoMetadata);

      console.log(`🔗 Video enlace configurado en sala [${roomId}]: ${originalName} (${videoMetadata.sourceType})`);

      res.json({
        message: 'Enlace de video configurado correctamente',
        video: updatedRoom?.video,
        status: updatedRoom?.status,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete room and cleanup all associated files on disk.
   * Solo el leader (secreto válido o rol leader del servidor).
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }

      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      if (!requireLeader(room, claimFromHeaders(req))) {
        res.status(403).json({ error: 'Solo el anfitrión puede eliminar la sala.' });
        return;
      }

      const deleted = await RoomService.deleteRoom(roomId, true);
      if (!deleted) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      res.json({ message: 'Sala y archivos de video eliminados exitosamente', roomId });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update room settings (estrictos + atómicos).
   * Solo el leader. Payload inválido → 400 con mensaje claro, sin aplicar nada.
   * Acepta `{ settings: {...} }` o el objeto de ajustes directamente.
   */
  public static async updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }

      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      if (!requireLeader(room, claimFromHeaders(req))) {
        res.status(403).json({ error: 'Solo el anfitrión puede cambiar los ajustes de la sala.' });
        return;
      }

      const body = (req.body ?? {}) as { settings?: unknown };
      const input = body.settings !== undefined ? body.settings : req.body;
      const { settings, errors } = sanitizeRoomSettings(input, { demo: isDemoMode() });
      if (errors.length > 0) {
        res.status(400).json({ error: `Ajustes inválidos: ${errors.join(' ')}` });
        return;
      }

      const updated = await RoomService.updateSettings(roomId, settings);
      res.json({ message: 'Ajustes actualizados correctamente', settings: updated?.settings || settings });
    } catch (error) {
      next(error);
    }
  }

  /**
   * HTTP 206 Partial Content sin bloquear el event loop (stat async + ETag).
   * Soporta rangos cerrados/abiertos/sufijo, If-Range e If-None-Match.
   */
  public static async streamVideo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (typeof roomId !== 'string' || !roomId.trim()) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }
      const room = await RoomService.getRoomById(roomId);

      if (!room || !room.video) {
        res.status(404).json({ error: 'Video no encontrado en esta sala' });
        return;
      }

      if (room.video.sourceType === 'hls' || room.video.sourceType === 'url' || room.video.directUrl) {
        res.redirect(room.video.directUrl || room.video.fileName);
        return;
      }

      // Evita path traversal: solo el basename del fichero registrado.
      const safeFileName = path.basename(room.video.fileName);
      const filePath = path.join(uploadsDir, safeFileName);
      let stat: { size: number; mtimeMs: number };
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        res.status(404).json({ error: 'El archivo de video no existe en el disco' });
        return;
      }
      const fileSize = stat.size;
      if (!Number.isFinite(fileSize) || fileSize <= 0) {
        res.status(404).json({ error: 'El archivo de video no existe en el disco' });
        return;
      }

      const mimeType = room.video.mimeType || 'video/mp4';
      const etag = `"${fileSize.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
      const lastModified = new Date(stat.mtimeMs).toUTCString();
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', lastModified);
      res.setHeader('Accept-Ranges', 'bytes');

      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }

      const range = req.headers.range;
      const ifRange = req.headers['if-range'];
      const rangeStale = typeof ifRange === 'string' && ifRange !== etag && ifRange !== lastModified;

      const streamWithCleanup = (start: number, end: number | undefined): void => {
        const fileStream = end === undefined
          ? fs.createReadStream(filePath)
          : fs.createReadStream(filePath, { start, end });
        fileStream.on('error', (err) => {
          if (!res.headersSent) {
            next(err);
            return;
          }
          try { res.destroy(); } catch { /* noop */ }
        });
        // Si el cliente aborta, se cierra el fd de inmediato.
        req.on('close', () => {
          try { fileStream.destroy(); } catch { /* noop */ }
        });
        fileStream.pipe(res);
      };

      if (range && !rangeStale) {
        const match = range.trim().match(/^bytes=(\d*)-(\d*)$/);
        if (!match || (match[1] === '' && match[2] === '')) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
          return;
        }
        let start: number;
        let end: number;
        if (match[1] === '') {
          // Sufijo: últimos N bytes.
          const suffix = parseInt(match[2], 10);
          if (!Number.isFinite(suffix) || suffix <= 0) {
            res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
            return;
          }
          start = Math.max(0, fileSize - suffix);
          end = fileSize - 1;
        } else {
          start = parseInt(match[1], 10);
          const chunkSize = 3 * 1024 * 1024;
          end = match[2] ? parseInt(match[2], 10) : Math.min(start + chunkSize, fileSize - 1);
        }

        if (!Number.isFinite(start) || !Number.isFinite(end) || start >= fileSize || end >= fileSize || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
          return;
        }

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Content-Length': end - start + 1,
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=3600',
        });
        streamWithCleanup(start, end);
        return;
      }

      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600',
      });
      streamWithCleanup(0, undefined);
    } catch (error) {
      next(error);
    }
  }
}
