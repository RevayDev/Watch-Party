import { Server, Socket } from 'socket.io';
import { activeMediaStates, activeUsers } from '../socket-state.js';

/** Handler de relay WebRTC y estado de medios. Nombres de eventos y payloads idénticos al original. */
export function registerWebrtcRelayHandlers(io: Server, socket: Socket): void {
  // 4. WebRTC Signaling (Offers, Answers, ICE candidates)
  socket.on(
    'webrtc-offer',
    (data: {
      targetSocketId: string;
      offer: unknown;
      callerName: string;
      callerIsHost: boolean;
    } | undefined) => {
      if (!data || typeof data.targetSocketId !== 'string' || !data.targetSocketId) return;
      // Solo sockets conocidos de la misma sala pueden señalizar (anti-reflector).
      const sender = activeUsers.get(socket.id);
      const target = activeUsers.get(data.targetSocketId);
      if (!sender || sender.pending || !target || target.pending) return;
      if (sender.roomId !== target.roomId) return;
      io.to(data.targetSocketId).emit('webrtc-offer', {
        senderSocketId: socket.id,
        offer: data.offer,
        callerName: typeof data.callerName === 'string' ? data.callerName.slice(0, 50) : '',
        callerIsHost: data.callerIsHost === true,
      });
    }
  );

  socket.on('webrtc-answer', (data: { targetSocketId: string; answer: unknown } | undefined) => {
    if (!data || typeof data.targetSocketId !== 'string' || !data.targetSocketId) return;
    const sender = activeUsers.get(socket.id);
    const target = activeUsers.get(data.targetSocketId);
    if (!sender || sender.pending || !target || target.pending) return;
    if (sender.roomId !== target.roomId) return;
    io.to(data.targetSocketId).emit('webrtc-answer', {
      senderSocketId: socket.id,
      answer: data.answer,
    });
  });

  socket.on('webrtc-ice-candidate', (data: { targetSocketId: string; candidate: unknown } | undefined) => {
    if (!data || typeof data.targetSocketId !== 'string' || !data.targetSocketId) return;
    const sender = activeUsers.get(socket.id);
    const target = activeUsers.get(data.targetSocketId);
    if (!sender || sender.pending || !target || target.pending) return;
    if (sender.roomId !== target.roomId) return;
    io.to(data.targetSocketId).emit('webrtc-ice-candidate', {
      senderSocketId: socket.id,
      candidate: data.candidate,
    });
  });

  // 4.1 Broadcast Peer Media State (Camera / Mic on/off)
  socket.on('peer-media-state', (data: { roomId: string; userName?: string; isCameraOn: boolean; isMicOn: boolean }) => {
    if (!data || typeof data !== 'object') return;
    const { roomId } = data;
    if (typeof roomId !== 'string' || !roomId.trim()) return;
    const cleanRoomId = roomId.toUpperCase().trim();
    const user = activeUsers.get(socket.id);
    if (!user || user.roomId !== cleanRoomId || user.pending) return;
    const isCameraOn = data.isCameraOn === true;
    const isMicOn = data.isMicOn === true;
    const effectiveUserName =
      (typeof data.userName === 'string' && data.userName.trim()) || user?.userName || '';

    activeMediaStates.set(socket.id, { isCameraOn, isMicOn });
    if (effectiveUserName) {
      activeMediaStates.set(effectiveUserName.toLowerCase(), { isCameraOn, isMicOn });
    }

    socket.to(cleanRoomId).emit('peer-media-state', {
      socketId: socket.id,
      userName: effectiveUserName,
      isCameraOn,
      isMicOn,
    });
  });
}
