import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    // 1. Check environment variable first (e.g. Vercel env -> Render backend)
    const envUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL;
    let socketUrl: string;

    if (envUrl) {
      socketUrl = envUrl.replace(/\/$/, '');
    } else {
      // 2. Fallback to current browser hostname on port 4000
      const hostname = window.location.hostname || 'localhost';
      socketUrl = `http://${hostname}:4000`;
    }

    console.log(`🔌 Conectando Socket.IO a: ${socketUrl}`);
    socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: false,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
