import express, { Express } from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import roomRoutes from './routes/room.routes.js';
import proxyRoutes from './routes/proxy.routes.js';
import { errorHandler } from './middleware/error.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // ── CORS Proxy for external video streaming (ver services/proxy.service.ts + routes/proxy.routes.ts) ──
  app.use('/api/proxy', proxyRoutes);

  // Routes
  app.use('/api/rooms', roomRoutes);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
