import { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomService } from '../services/room.service.js';
import { IVideoMetadata } from '../types/room.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '../../uploads');

const PROBE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
      const { hostName, isTemporary } = req.body;
      if (!hostName || typeof hostName !== 'string' || hostName.trim().length === 0) {
        res.status(400).json({ error: 'hostName is required' });
        return;
      }

      const { room, hostSecret } = await RoomService.createRoom({
        hostName,
        isTemporary: isTemporary !== undefined ? Boolean(isTemporary) : true,
      });

      res.status(201).json({
        roomId: room.roomId,
        hostName: room.hostName,
        hostSecret,
        status: room.status,
        isTemporary: room.isTemporary !== false,
        createdAt: room.createdAt,
      });
    } catch (error) {
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
        hostName: room.hostName,
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

      const existing = await RoomService.getRoomById(cleanId);
      if (!existing) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      // ── Approval-gated rooms: do NOT add the guest to participants here.
      // The socket 'join-room' handler holds them in the waiting list until the
      // host/co-host approves. Adding them here would bypass the approval gate.
      const requireApproval = existing.settings?.requireApproval === true;
      const isHostName = existing.hostName.toLowerCase() === trimmedName.toLowerCase();
      const alreadyParticipant = (existing.participants || []).some(
        (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
      );

      if (requireApproval && !isHostName && !alreadyParticipant) {
        res.json({
          roomId: existing.roomId,
          hostName: existing.hostName,
          status: existing.status,
          participants: existing.participants,
          pendingApproval: true,
        });
        return;
      }

      const room = await RoomService.joinRoom(cleanId, trimmedName);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      res.json({
        roomId: room.roomId,
        hostName: room.hostName,
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

      if (!file) {
        res.status(400).json({ error: 'No se envió ningún archivo de video válido' });
        return;
      }

      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
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
   * Delete room and cleanup all associated files on disk
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
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
   * Ultra-fast HTTP 206 Partial Content Video Streaming with chunk caching and zero delay
   */
  public static async streamVideo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      const room = await RoomService.getRoomById(roomId);

      if (!room || !room.video) {
        res.status(404).json({ error: 'Video no encontrado en esta sala' });
        return;
      }

      if (room.video.sourceType === 'hls' || room.video.sourceType === 'url' || room.video.directUrl) {
        res.redirect(room.video.directUrl || room.video.fileName);
        return;
      }

      const filePath = path.join(uploadsDir, room.video.fileName);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'El archivo de video no existe en el disco' });
        return;
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        // Range: bytes=start-end
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        // Serve 2MB - 4MB chunks for instant seek responsiveness
        const chunkSize = 3 * 1024 * 1024;
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + chunkSize, fileSize - 1);

        if (start >= fileSize) {
          res.status(416).send(`Requested range not satisfiable: ${start} >= ${fileSize}`);
          return;
        }

        const contentLength = end - start + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        const headers = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': contentLength,
          'Content-Type': room.video.mimeType || 'video/mp4',
          'Cache-Control': 'public, max-age=3600',
        };

        res.writeHead(206, headers);
        fileStream.pipe(res);
      } else {
        const headers = {
          'Content-Length': fileSize,
          'Content-Type': room.video.mimeType || 'video/mp4',
          'Accept-Ranges': 'bytes',
        };
        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (error) {
      next(error);
    }
  }
}
