import http from 'node:http';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';
import { createApp } from './app.js';
import { connectDatabase } from './config/database.js';
import { setupSocketHandlers } from './sockets/room.socket.js';

dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/watch_party';

async function startServer() {
  // 1. Connect database
  await connectDatabase(MONGODB_URI);

  // 2. Initialize express app
  const app = createApp();
  const server = http.createServer(app);

  // 3. Initialize Socket.IO with CORS enabled for LAN devices
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Attach socket handlers
  setupSocketHandlers(io);

  // 4. Start HTTP Server on all interfaces (0.0.0.0)
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Watch Party server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal startup error:', err);
});
