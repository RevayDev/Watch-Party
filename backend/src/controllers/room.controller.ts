import { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomService } from '../services/room.service.js';
import { IVideoMetadata } from '../types/room.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '../../uploads');

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

      const room = await RoomService.joinRoom(roomId, userName);
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
      const driveMatch = cleanUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (driveMatch && driveMatch[1]) {
        cleanUrl = `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
      }

      const isHls = cleanUrl.includes('.m3u8') || cleanUrl.includes('/hls/');
      const originalName = title?.trim() || (isHls ? 'Transmisión HLS en Vivo' : cleanUrl.split('/').pop()?.split('?')[0] || 'Video Enlace Web');

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
