import http from 'node:http';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';
import { createApp } from './app.js';
import { connectDatabase, connectPrisma, isPrismaStore } from './config/database.js';
import { isOriginAllowed } from './config/cors.js';
import { readStartupEnv } from './config/env.js';
import { setupSocketHandlers } from './sockets/room.socket.js';

dotenv.config();

async function startServer() {
  const { port, mongoUri } = readStartupEnv(process.env);
  // 1. Connect database (Prisma si ROOM_STORE=prisma, si no Mongoose/memoria)
  if (isPrismaStore()) {
    await connectPrisma();
  } else {
    await connectDatabase(mongoUri);
  }

  // 2. Initialize express app
  const app = createApp();
  const server = http.createServer(app);

  // 3. Initialize Socket.IO with consistent CORS policy
  const io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Socket.IO CORS: Origen no permitido (${origin})`));
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // El panel admin REST emite eventos en tiempo real: expone `io` a los
  // controllers vía `req.app.get('io')` (ausente en tests → se omite el emit).
  app.set('io', io);

  // Attach socket handlers
  setupSocketHandlers(io);

  // 4. Start HTTP Server on all interfaces (0.0.0.0)
  server.once('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE'
      ? `El puerto ${port} ya está en uso. Ejecuta npm run dev desde la raíz para reutilizar el servidor activo.`
      : `No se pudo iniciar el servidor: ${error.message}`);
    process.exit(1);
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Watch Party server running at http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exitCode = 1;
});
