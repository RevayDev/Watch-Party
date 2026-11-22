import { onPageResume } from '../shared/pageResume';
import { resetRoomClock, sampleRoomClock } from '../shared/roomClock';
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let stopResume: (() => void) | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
function probeClock() {
  if (!socket?.connected || typeof socket.emit !== 'function') return;
  const sent = Date.now();
  socket.emit('clock-sync', (data: { serverAt?: number }) => { if (typeof data?.serverAt === 'number') sampleRoomClock(sent, data.serverAt); });
}

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
      // Reconexión resiliente ante señal intermitente: reintentos con
      // backoff y timeout generoso (la sala tolera 20 s de gracia y la
      // película nunca se pausa por un fallo del socket).
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
      timeout: 20000,
      autoConnect: true,
    });
    resetRoomClock(); socket.on?.('connect', probeClock);
    clockTimer = setInterval(probeClock, 30000);
  }
  stopResume ??= onPageResume(() => { if (socket && !socket.connected) socket.connect(); });
  return socket;
}

export function disconnectSocket(): void {
  if (clockTimer) clearInterval(clockTimer); clockTimer = null;
  stopResume?.(); stopResume = null;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
