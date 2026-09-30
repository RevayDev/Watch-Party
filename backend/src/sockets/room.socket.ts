import { Server, Socket } from 'socket.io';
import { RoomService } from '../services/room.service.js';
import { IVideoMetadata } from '../types/room.types.js';

interface SocketUser {
  socketId: string;
  roomId: string;
  userName: string;
  isHost: boolean;
}

// In-memory socket user directory
const activeUsers = new Map<string, SocketUser>();

// In-memory playback state per room: { currentTime, isPlaying, updatedAt }
interface PlaybackState {
  currentTime: number;
  isPlaying: boolean;
  updatedAt: number; // Date.now() when last updated
}
const roomPlayback = new Map<string, PlaybackState>();

export function setupSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`⚡ Socket conectado: ${socket.id}`);

    // 1. Join Room
    socket.on('join-room', async (data: { roomId: string; userName: string; isHost?: boolean }) => {
      const { roomId, userName, isHost = false } = data;
      if (!roomId || !userName) return;

      const cleanRoomId = roomId.toUpperCase().trim();
      socket.join(cleanRoomId);

      // Check if this room already exists and who is current host
      const existingRoom = await RoomService.getRoomById(cleanRoomId);
      const isActuallyHost =
        isHost ||
        (existingRoom && existingRoom.hostName.toLowerCase() === userName.trim().toLowerCase());

      const socketUser: SocketUser = {
        socketId: socket.id,
        roomId: cleanRoomId,
        userName: userName.trim(),
        isHost: !!isActuallyHost,
      };
      activeUsers.set(socket.id, socketUser);

      // Add to database/memory participant list
      await RoomService.joinRoom(cleanRoomId, userName.trim());
      const room = await RoomService.getRoomById(cleanRoomId);

      console.log(`👤 ${userName} se unió a la sala [${cleanRoomId}] (Host: ${socketUser.isHost})`);

      // Build existing peers list for WebRTC mesh
      const existingPeers: Array<{ socketId: string; userName: string; isHost: boolean }> = [];
      const roomSockets = io.sockets.adapter.rooms.get(cleanRoomId);
      if (roomSockets) {
        for (const sockId of roomSockets) {
          if (sockId !== socket.id) {
            const peer = activeUsers.get(sockId);
            if (peer) {
              existingPeers.push({
                socketId: peer.socketId,
                userName: peer.userName,
                isHost: peer.isHost,
              });
            }
          }
        }
      }

      // Notify others in room of new participant
      socket.to(cleanRoomId).emit('user-joined', {
        socketId: socket.id,
        userName: userName.trim(),
        isHost: socketUser.isHost,
        participants: room?.participants || [],
      });

      // Get current playback state for this room (if video is playing)
      const playback = roomPlayback.get(cleanRoomId);
      let syncedCurrentTime: number | null = null;
      if (playback) {
        // Compensate for elapsed time since last sync snapshot
        const elapsedSec = (Date.now() - playback.updatedAt) / 1000;
        syncedCurrentTime = playback.isPlaying
          ? playback.currentTime + elapsedSec
          : playback.currentTime;
      }

      // Send initial room state + peer list for WebRTC + playback position
      socket.emit('room-state', {
        roomId: cleanRoomId,
        hostName: room?.hostName,
        isHost: socketUser.isHost,
        video: room?.video || null,
        status: room?.status || 'waiting',
        participants: room?.participants || [],
        peers: existingPeers,
        // New: send current playback position so joiner can seek immediately
        playback: syncedCurrentTime !== null
          ? { currentTime: syncedCurrentTime, isPlaying: playback!.isPlaying }
          : null,
      });
    });

    // 2. Host deletes/closes the entire room
    socket.on('close-room', async (data: { roomId: string }) => {
      const { roomId } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      console.log(`🚨 Host cerró la sala [${cleanRoomId}] para todos los participantes`);

      io.to(cleanRoomId).emit('room-closed', {
        message: 'La sala ha sido cerrada y eliminada por el anfitrión.',
      });

      io.in(cleanRoomId).socketsLeave(cleanRoomId);
      roomPlayback.delete(cleanRoomId);
      await RoomService.deleteRoom(cleanRoomId);
    });

    // 3. User leaves voluntarily (with Host role transfer if host leaves)
    socket.on('leave-room', async (data: { roomId: string; userName: string }) => {
      const { roomId, userName } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      socket.leave(cleanRoomId);
      activeUsers.delete(socket.id);

      const { room, newHostName } = await RoomService.removeParticipantAndTransferHost(
        cleanRoomId,
        userName
      );

      if (newHostName) {
        for (const [_sId, u] of activeUsers.entries()) {
          if (u.roomId === cleanRoomId && u.userName.toLowerCase() === newHostName.toLowerCase()) {
            u.isHost = true;
          }
        }

        io.to(cleanRoomId).emit('host-changed', {
          newHostName,
          participants: room?.participants || [],
        });
      }

      socket.to(cleanRoomId).emit('user-left', {
        socketId: socket.id,
        userName,
        participants: room?.participants || [],
      });
    });

    // 4. WebRTC Signaling (Offers, Answers, ICE candidates)
    socket.on(
      'webrtc-offer',
      (data: {
        targetSocketId: string;
        offer: any;
        callerName: string;
        callerIsHost: boolean;
      }) => {
        io.to(data.targetSocketId).emit('webrtc-offer', {
          senderSocketId: socket.id,
          offer: data.offer,
          callerName: data.callerName,
          callerIsHost: data.callerIsHost,
        });
      }
    );

    socket.on('webrtc-answer', (data: { targetSocketId: string; answer: any }) => {
      io.to(data.targetSocketId).emit('webrtc-answer', {
        senderSocketId: socket.id,
        answer: data.answer,
      });
    });

    socket.on('webrtc-ice-candidate', (data: { targetSocketId: string; candidate: any }) => {
      io.to(data.targetSocketId).emit('webrtc-ice-candidate', {
        senderSocketId: socket.id,
        candidate: data.candidate,
      });
    });

    // 5. Video Playback Synchronization (play, pause, seek with latency compensation)
    socket.on(
      'sync-video',
      (data: { roomId: string; action: 'play' | 'pause' | 'seek'; currentTime: number }) => {
        const { roomId, action, currentTime } = data;
        if (!roomId) return;
        const cleanRoomId = roomId.toUpperCase().trim();

        // ── Update in-memory playback state ──────────────────────────────────
        roomPlayback.set(cleanRoomId, {
          currentTime,
          isPlaying: action === 'play',
          updatedAt: Date.now(),
        });

        const sentAt = Date.now();
        socket.to(cleanRoomId).emit('sync-video', {
          action,
          currentTime,
          sentAt,
          senderSocketId: socket.id,
        });
      }
    );

    // 6. Video Changed (when host uploads or swaps movie)
    socket.on('video-changed', (data: { roomId: string; video: IVideoMetadata }) => {
      const { roomId, video } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      // Reset playback state for the new video
      roomPlayback.set(cleanRoomId, {
        currentTime: 0,
        isPlaying: false,
        updatedAt: Date.now(),
      });

      console.log(`🎬 Nuevo video cargado en sala [${cleanRoomId}]: ${video.originalName}`);
      io.to(cleanRoomId).emit('video-changed', { video });
    });

    // 7. Chat Message
    socket.on('send-message', (data: { roomId: string; text: string; userName: string }) => {
      const { roomId, text, userName } = data;
      if (!roomId || !text.trim()) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const messagePayload = {
        id: Math.random().toString(36).substring(2, 9),
        user: userName || 'Anónimo',
        text: text.trim(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      io.to(cleanRoomId).emit('chat-message', messagePayload);
    });

    // 8. Reaction (Emoji float animation)
    socket.on('send-reaction', (data: { roomId: string; emoji: string; userName: string }) => {
      const { roomId, emoji, userName } = data;
      if (!roomId || !emoji) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const reactionPayload = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        emoji,
        user: userName || 'Anónimo',
        xOffset: Math.random() * 40 - 20,
      };

      io.to(cleanRoomId).emit('reaction', reactionPayload);
    });

    // 9. Disconnection (Handle auto-host transfer when host drops out)
    socket.on('disconnect', async () => {
      const user = activeUsers.get(socket.id);
      if (user) {
        activeUsers.delete(socket.id);
        const { room, newHostName } = await RoomService.removeParticipantAndTransferHost(
          user.roomId,
          user.userName
        );

        console.log(`🔌 ${user.userName} se desconectó de la sala [${user.roomId}]`);

        if (newHostName) {
          for (const [_sId, u] of activeUsers.entries()) {
            if (
              u.roomId === user.roomId &&
              u.userName.toLowerCase() === newHostName.toLowerCase()
            ) {
              u.isHost = true;
            }
          }

          socket.to(user.roomId).emit('host-changed', {
            newHostName,
            participants: room?.participants || [],
          });
        }

        socket.to(user.roomId).emit('user-left', {
          socketId: socket.id,
          userName: user.userName,
          participants: room?.participants || [],
        });

        // Clean up empty rooms
        const roomSockets = io.sockets.adapter.rooms.get(user.roomId);
        if (!roomSockets || roomSockets.size === 0) {
          roomPlayback.delete(user.roomId);
        }
      }
    });
  });
}
