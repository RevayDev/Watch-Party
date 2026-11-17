import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { activeMediaStates, activeUsers } from '../socket-state.js';

const relayTarget = z.object({ targetSocketId: z.string().min(1) }).passthrough();

/** Relays WebRTC signaling only between admitted members of the same room. */
export function registerWebrtcRelayHandlers(io: Server, socket: Socket): void {
  function getRelayRequest(data: unknown) {
    const parsed = relayTarget.safeParse(data);
    if (!parsed.success) return null;
    const sender = activeUsers.get(socket.id);
    const target = activeUsers.get(parsed.data.targetSocketId);
    return sender && !sender.pending && target && !target.pending && sender.roomId === target.roomId
      ? parsed.data
      : null;
  }

  socket.on(
    'webrtc-offer',
    (input: unknown) => {
      const data = getRelayRequest(input);
      if (!data) return;
      io.to(data.targetSocketId).emit('webrtc-offer', {
        senderSocketId: socket.id,
        offer: data.offer,
        callerName: typeof data.callerName === 'string' ? data.callerName.slice(0, 50) : '',
        callerIsLeader: data.callerIsLeader === true,
      });
    }
  );

  socket.on('webrtc-answer', (input: unknown) => {
    const data = getRelayRequest(input);
    if (!data) return;
    io.to(data.targetSocketId).emit('webrtc-answer', {
      senderSocketId: socket.id,
      answer: data.answer,
    });
  });

  socket.on('webrtc-ice-candidate', (input: unknown) => {
    const data = getRelayRequest(input);
    if (!data) return;
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
