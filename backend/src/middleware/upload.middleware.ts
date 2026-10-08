import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response, NextFunction } from 'express';
import { DEMO_UPLOAD_DISABLED_MESSAGE, isDemoMode } from '../config/demo-mode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure disk storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, uniqueName);
  },
});

// Allow popular video formats (mp4, webm, mkv, mov)
// NOTE: invalid files are rejected with `cb(null, false)` (instead of an Error)
// so the request reaches the controller, which responds 400 (not 500).
// The reason is exposed via `req.fileValidationError`.
// Exportado para cobertura vitest (validación de formatos); sin efectos en runtime.
export const fileFilter = (
  req: any,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedMimeTypes = [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'video/x-matroska',
  ];

  if (allowedMimeTypes.includes(file.mimetype) || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    req.fileValidationError =
      'Formato no soportado. Por favor sube un archivo de video válido (.mp4, .webm, .mkv, .mov).';
    cb(null, false);
  }
};

// 4GB max file size limit (suitable for long 1-3 hour movies)
export const uploadVideoMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 4 * 1024 * 1024 * 1024, // 4GB
  },
});

/**
 * Guarda demo PREVIA a multer: con `DEMO_MODE` activo rechaza 403 sin que
 * multer escriba ningún archivo en disco (no hay huérfanos que borrar).
 * Con la demo desactivada es transparente (`next()`). El controlador repite
 * la guarda como respaldo (y borra el huérfano si multer ya escribió).
 */
export function demoUploadGuard(_req: Request, res: Response, next: NextFunction): void {
  if (isDemoMode()) {
    res.status(403).json({ error: DEMO_UPLOAD_DISABLED_MESSAGE });
    return;
  }
  next();
}
