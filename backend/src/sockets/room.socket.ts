import { Server, Socket } from 'socket.io';
import { RoomService } from '../services/room.service.js';
import { IVideoMetadata } from '../types/room.types.js';

interface SocketUser {
  socketId: string;
  roomId: string;
  userName: string;
  isHost: boolean;
  userId?: string;
  pending?: boolean;
}

// In-memory socket user directory & media states
const activeUsers = new Map<string, SocketUser>();
const activeMediaStates = new Map<string, { isCameraOn: boolean; isMicOn: boolean }>();

// In-memory playback state per room: { currentTime, isPlaying, updatedAt }
interface PlaybackState {
  currentTime: number;
  isPlaying: boolean;
  updatedAt: number; // Date.now() when last updated
}
const roomPlayback = new Map<string, PlaybackState>();

// Live playback positions reported by members (heartbeats). Used to resolve
// the reference time a (re)joining user should adopt: the time most members
// share; seniority (longest in the room) wins ties.
interface PositionReport {
  socketId: string;
  userName: string;
  userId?: string;
  currentTime: number;
  isPlaying: boolean;
  updatedAt: number;
}
const roomPositions = new Map<string, Map<string, PositionReport>>();
const POSITION_TTL_MS = 12_000;
const CLUSTER_TOLERANCE_SEC = 3;

function freshPositions(roomId: string): PositionReport[] {
  const now = Date.now();
  const bySocket = roomPositions.get(roomId);
  if (!bySocket) return [];
  const out: PositionReport[] = [];
  for (const [sid, rep] of bySocket.entries()) {
    if (now - rep.updatedAt > POSITION_TTL_MS) {
      bySocket.delete(sid);
      continue;
    }
    if (Number.isFinite(rep.currentTime) && rep.currentTime >= 0) out.push(rep);
  }
  if (bySocket.size === 0) roomPositions.delete(roomId);
  return out;
}

function seniorityOf(
  rep: PositionReport,
  participants: Array<{ userId?: string; name: string; joinedAt?: Date | string; isHost?: boolean }>
): number {
  const match = participants.find((p) => {
    if (rep.userId && p.userId) return p.userId === rep.userId;
    return p.name.toLowerCase() === rep.userName.toLowerCase();
  });
  const t = match?.joinedAt ? new Date(match.joinedAt).getTime() : NaN;
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/**
 * Reference playback for a newcomer: the time most present members share
 * (reports clustered within CLUSTER_TOLERANCE_SEC, median of the biggest
 * cluster). With no majority — e.g. two members apart — the senior member
 * (longest in the room) wins. Returns null when nobody reported recently.
 */
export function resolveRoomTime(
  roomId: string,
  participants: Array<{ userId?: string; name: string; joinedAt?: Date | string; isHost?: boolean }>
): { currentTime: number; isPlaying: boolean } | null {
  const reports = freshPositions(roomId);
  if (reports.length === 0) return null;

  const sorted = [...reports].sort((a, b) => a.currentTime - b.currentTime);
  let best: PositionReport[] = [];
  let window: PositionReport[] = [];
  for (const rep of sorted) {
    if (window.length > 0 && rep.currentTime - window[0].currentTime > CLUSTER_TOLERANCE_SEC) {
      if (window.length > best.length) best = window;
      window = [];
    }
    window.push(rep);
  }
  if (window.length > best.length) best = window;

  // No majority (everyone apart): seniority wins — longest in the room first.
  const cluster =
    best.length >= 2 || sorted.length === 1
      ? best
      : [...sorted].sort(
          (a, b) => seniorityOf(a, participants) - seniorityOf(b, participants)
        ).slice(0, 1);

  const times = cluster.map((r) => r.currentTime).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const playingVotes = cluster.filter((r) => r.isPlaying).length;
  return { currentTime: median, isPlaying: playingVotes * 2 >= cluster.length };
}

function dropPosition(roomId: string, socketId: string): void {
  const bySocket = roomPositions.get(roomId);
  if (!bySocket) return;
  bySocket.delete(socketId);
  if (bySocket.size === 0) roomPositions.delete(roomId);
}

export function setupSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`⚡ Socket conectado: ${socket.id}`);

    // 1. Join Room
    socket.on('join-room', async (data: { roomId: string; userName: string; isHost?: boolean; userId?: string }) => {
      const { roomId, userName, isHost = false, userId } = data;
      if (!roomId || !userName) return;

      const cleanRoomId = roomId.toUpperCase().trim();
      const cleanName = userName.trim();

      // Rejoin on the SAME socket (e.g. state refresh): don't re-broadcast join
      const previousEntry = activeUsers.get(socket.id);
      const isSameSocketRejoin = previousEntry?.roomId === cleanRoomId;

      // Check if this room already exists and who is current host
      const existingRoom = await RoomService.getRoomById(cleanRoomId);

      // ── Ban check: banned users cannot re-enter ──
      const bannedEntry = (existingRoom?.kickedUsers || []).find((k) => {
        if (!k.banned) return false;
        if (userId && k.userId) return k.userId === userId;
        return k.name.toLowerCase() === cleanName.toLowerCase();
      });
      if (bannedEntry) {
        activeUsers.delete(socket.id);
        socket.emit('join-rejected', {
          reason: 'banned',
          message: 'Has sido baneado de esta sala y no puedes volver a entrar.',
        });
        return;
      }

      // Is this person ALREADY a participant? (identity = userId, name = legacy fallback)
      const alreadyParticipant = (existingRoom?.participants || []).some((p) => {
        if (userId && p.userId) return p.userId === userId;
        return !p.userId && p.name.toLowerCase() === cleanName.toLowerCase();
      });

      const participantMatch = (existingRoom?.participants || []).find((p) => {
        if (userId && p.userId) return p.userId === userId;
        return !p.userId && p.name.toLowerCase() === cleanName.toLowerCase();
      });

      const isActuallyHost =
        isHost ||
        (existingRoom && existingRoom.hostName.toLowerCase() === cleanName.toLowerCase()) ||
        Boolean(participantMatch?.isHost);

      // ── Manual approval (waiting list): hold newcomers until host approves ──
      const requireApproval = existingRoom?.settings?.requireApproval === true;
      if (requireApproval && !isActuallyHost && !alreadyParticipant) {
        activeUsers.set(socket.id, {
          socketId: socket.id,
          roomId: cleanRoomId,
          userName: cleanName,
          isHost: false,
          userId,
          pending: true,
        });
        const updated = await RoomService.addJoinRequest(cleanRoomId, {
          socketId: socket.id,
          userId,
          name: cleanName,
        });
        console.log(`⏳ Solicitud de unión de ${cleanName} en sala [${cleanRoomId}]`);
        socket.emit('join-pending', {
          message: 'Esperando aprobación del anfitrión para entrar a la sala.',
        });
        io.to(cleanRoomId).emit('join-requests-updated', {
          joinRequests: updated?.joinRequests || [],
        });
        return;
      }

      socket.join(cleanRoomId);

      const socketUser: SocketUser = {
        socketId: socket.id,
        roomId: cleanRoomId,
        userName: cleanName,
        isHost: !!isActuallyHost,
        userId,
      };
      activeUsers.set(socket.id, socketUser);

      // Add to database/memory participant list
      await RoomService.joinRoom(cleanRoomId, cleanName, 'Web Browser', userId);
      const room = await RoomService.getRoomById(cleanRoomId);

      console.log(`👤 ${cleanName} se unió a la sala [${cleanRoomId}] (Host: ${socketUser.isHost})`);

      // Build existing peers list and media states for WebRTC mesh
      const existingPeers: Array<{ socketId: string; userName: string; isHost: boolean }> = [];
      const existingMediaStates: Record<string, { isCameraOn: boolean; isMicOn: boolean; userName: string }> = {};
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
              const media = activeMediaStates.get(sockId) || { isCameraOn: false, isMicOn: false };
              existingMediaStates[sockId] = { ...media, userName: peer.userName };
              existingMediaStates[peer.userName.toLowerCase()] = { ...media, userName: peer.userName };
            }
          }
        }
      }

      // Notify others in room of new participant (skip for same-socket rejoins)
      if (!isSameSocketRejoin) {
        socket.to(cleanRoomId).emit('user-joined', {
          socketId: socket.id,
          userName: cleanName,
          isHost: socketUser.isHost,
          participants: room?.participants || [],
        });
      }

      // Reference time for the newcomer: member consensus first (the time
      // most of the room shares; seniority wins ties), last-action snapshot
      // as fallback.
      const consensus = resolveRoomTime(cleanRoomId, room?.participants || []);
      const playback = roomPlayback.get(cleanRoomId);
      let syncedCurrentTime: number | null = consensus ? consensus.currentTime : null;
      let syncedIsPlaying = consensus ? consensus.isPlaying : false;
      if (syncedCurrentTime === null && playback) {
        // Compensate for elapsed time since last sync snapshot
        const elapsedSec = (Date.now() - playback.updatedAt) / 1000;
        syncedCurrentTime = playback.isPlaying
          ? playback.currentTime + elapsedSec
          : playback.currentTime;
        syncedIsPlaying = playback.isPlaying;
      }

      // Send initial room state + peer list for WebRTC + playback position + media states
      socket.emit('room-state', {
        roomId: cleanRoomId,
        hostName: room?.hostName,
        isHost: socketUser.isHost,
        isTemporary: room?.isTemporary !== false,
        settings: room?.settings,
        video: room?.video || null,
        status: room?.status || 'waiting',
        participants: room?.participants || [],
        joinRequests: room?.joinRequests || [],
        kickedUsers: room?.kickedUsers || [],
        peers: existingPeers,
        mediaStates: existingMediaStates,
        playback: syncedCurrentTime !== null
          ? { currentTime: syncedCurrentTime, isPlaying: syncedIsPlaying }
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
      roomPositions.delete(cleanRoomId);
      await RoomService.deleteRoom(cleanRoomId, true);
    });

    // 3. User leaves voluntarily (with Host role transfer if host leaves)
    socket.on('leave-room', async (data: { roomId: string; userName: string; userId?: string }) => {
      const { roomId, userName, userId } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const entry = activeUsers.get(socket.id);
      socket.leave(cleanRoomId);
      activeUsers.delete(socket.id);
      dropPosition(cleanRoomId, socket.id);

      // Pending (waiting-list) users just cancel their request
      if (entry?.pending) {
        const updated = await RoomService.rejectJoinRequest(cleanRoomId, {
          userId: entry.userId,
          name: entry.userName,
        });
        io.to(cleanRoomId).emit('join-requests-updated', {
          joinRequests: updated?.joinRequests || [],
        });
        return;
      }

      const { room, newHostName } = await RoomService.removeParticipantAndTransferHost(
        cleanRoomId,
        userName,
        userId || entry?.userId
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

    // 4.1 Broadcast Peer Media State (Camera / Mic on/off)
    socket.on('peer-media-state', (data: { roomId: string; userName?: string; isCameraOn: boolean; isMicOn: boolean }) => {
      const { roomId, isCameraOn, isMicOn } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();
      const user = activeUsers.get(socket.id);
      const effectiveUserName = data.userName?.trim() || user?.userName || '';

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

    // 5.1 Playback position heartbeat (every few seconds per member).
    // Feeds the member-consensus time used when someone (re)joins.
    socket.on(
      'playback-heartbeat',
      (data: { roomId: string; currentTime: number; isPlaying: boolean }) => {
        const { roomId, currentTime, isPlaying } = data;
        if (!roomId || !Number.isFinite(currentTime) || currentTime < 0) return;
        const cleanRoomId = roomId.toUpperCase().trim();
        const user = activeUsers.get(socket.id);
        if (!user || user.roomId !== cleanRoomId || user.pending) return;
        let bySocket = roomPositions.get(cleanRoomId);
        if (!bySocket) {
          bySocket = new Map();
          roomPositions.set(cleanRoomId, bySocket);
        }
        bySocket.set(socket.id, {
          socketId: socket.id,
          userName: user.userName,
          userId: user.userId,
          currentTime,
          isPlaying: isPlaying === true,
          updatedAt: Date.now(),
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

    // 6.1 Upload Progress broadcast (so all members see live upload status)
    socket.on('upload-progress', (data: { roomId: string; progress: number | null; fileName?: string }) => {
      const { roomId, progress, fileName } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();
      socket.to(cleanRoomId).emit('upload-progress', { progress, fileName });
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

    // ── MODERATION & ROLE EVENTS ─────────────────────────────────────────────

    // Mute a specific user remotely (Host or Co-host)
    socket.on('moderate-mute-user', (data: { roomId: string; targetSocketId?: string; targetUserName: string }) => {
      const { roomId, targetSocketId, targetUserName } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      console.log(`🔇 Moderación: Silenciando a ${targetUserName} en sala [${cleanRoomId}]`);
      io.to(cleanRoomId).emit('force-mute-user', {
        targetSocketId,
        targetUserName,
      });
    });

    // Disable camera of a specific user remotely (Host or Co-host)
    socket.on('moderate-disable-camera', (data: { roomId: string; targetSocketId?: string; targetUserName: string }) => {
      const { roomId, targetSocketId, targetUserName } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      console.log(`📷 Moderación: Apagando cámara a ${targetUserName} en sala [${cleanRoomId}]`);
      io.to(cleanRoomId).emit('force-disable-camera', {
        targetSocketId,
        targetUserName,
      });
    });

    // Mute all participants (Host or Co-host)
    socket.on('moderate-mute-all', (data: { roomId: string }) => {
      const { roomId } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      console.log(`🔇 Moderación: Silenciando a TODOS en sala [${cleanRoomId}]`);
      io.to(cleanRoomId).emit('force-mute-all');
    });

    // Disable all cameras (Host or Co-host)
    socket.on('moderate-disable-all-cameras', (data: { roomId: string }) => {
      const { roomId } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      console.log(`📷 Moderación: Apagando cámaras de TODOS en sala [${cleanRoomId}]`);
      io.to(cleanRoomId).emit('force-disable-all-cameras');
    });

    // Kick (ban=false → can rejoin) or Ban (ban=true → rejoin blocked)
    socket.on(
      'kick-user',
      async (data: { roomId: string; targetUserName: string; targetUserId?: string; kickedBy: string; ban?: boolean }) => {
        const { roomId, targetUserName, targetUserId, kickedBy, ban = false } = data;
        if (!roomId || !targetUserName) return;
        const cleanRoomId = roomId.toUpperCase().trim();

        console.log(
          `${ban ? '⛔ Baneado' : '🚫 Expulsado'} ${targetUserName} por ${kickedBy} en sala [${cleanRoomId}]`
        );
        const updatedRoom = await RoomService.kickParticipant(
          cleanRoomId,
          { name: targetUserName, userId: targetUserId },
          kickedBy,
          ban
        );

        io.to(cleanRoomId).emit('user-kicked', {
          targetUserName,
          targetUserId,
          kickedBy,
          banned: ban,
          participants: updatedRoom?.participants || [],
          kickedUsers: updatedRoom?.kickedUsers || [],
        });
      }
    );

    // Unban / remove from the Expulsados list
    socket.on('unban-user', async (data: { roomId: string; targetUserName?: string; targetUserId?: string }) => {
      const { roomId, targetUserName, targetUserId } = data;
      if (!roomId || (!targetUserName && !targetUserId)) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const updatedRoom = await RoomService.unbanParticipant(cleanRoomId, {
        name: targetUserName,
        userId: targetUserId,
      });
      console.log(`✅ ${targetUserName || targetUserId} desbaneado en sala [${cleanRoomId}]`);

      io.to(cleanRoomId).emit('kicked-users-updated', {
        kickedUsers: updatedRoom?.kickedUsers || [],
      });
    });

    // ── WAITING LIST: approve / reject join requests ────────────────────────
    socket.on('approve-join', async (data: { roomId: string; userId?: string; name?: string }) => {
      const { roomId, userId, name } = data;
      if (!roomId || (!userId && !name)) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const { room, request } = await RoomService.approveJoinRequest(cleanRoomId, { userId, name });
      if (!request) return;
      console.log(`✅ Solicitud aprobada: ${request.name} en sala [${cleanRoomId}]`);

      io.to(cleanRoomId).emit('join-requests-updated', {
        joinRequests: room?.joinRequests || [],
      });

      // Locate the requester's current socket (they are NOT in the room channel yet)
      let requesterSocketId: string | undefined;
      for (const [, u] of activeUsers.entries()) {
        if (u.roomId !== cleanRoomId || !u.pending) continue;
        const matchById = Boolean(u.userId && request.userId && u.userId === request.userId);
        const matchByName = u.userName.toLowerCase() === (request.name || '').toLowerCase();
        if (matchById || matchByName) {
          requesterSocketId = u.socketId;
          if (matchById) break;
        }
      }

      if (requesterSocketId) {
        // Let them re-run join-room (they will receive room-state + peers)
        io.to(requesterSocketId).emit('join-approved', { roomId: cleanRoomId });
        // Tell everyone in the room (including the approver) that the user
        // joined — `socket.to` would skip the approver and their list would
        // never show the newcomer.
        io.to(cleanRoomId).emit('user-joined', {
          socketId: requesterSocketId,
          userName: request.name,
          isHost: false,
          participants: room?.participants || [],
        });
      }
    });

    socket.on(
      'reject-join',
      async (data: { roomId: string; userId?: string; name?: string; ban?: boolean; requestedBy?: string }) => {
        const { roomId, userId, name, ban = false, requestedBy } = data;
        if (!roomId || (!userId && !name)) return;
        const cleanRoomId = roomId.toUpperCase().trim();

        const updated = await RoomService.rejectJoinRequest(
          cleanRoomId,
          { userId, name },
          { ban, rejectedBy: requestedBy }
        );
        console.log(
          `${ban ? '⛔ Solicitud baneada' : '❌ Solicitud rechazada'}: ${name || userId} en sala [${cleanRoomId}]`
        );

        // Notify the requester so they can leave gracefully
        for (const [, u] of activeUsers.entries()) {
          const matchesUser =
            u.roomId === cleanRoomId &&
            ((userId && u.userId === userId) || (!userId && u.userName.toLowerCase() === (name || '').toLowerCase()));
          if (matchesUser) {
            io.to(u.socketId).emit('join-rejected', {
              reason: ban ? 'banned' : 'rejected',
              message: ban
                ? 'Has sido baneado de esta sala.'
                : 'El anfitrión rechazó tu solicitud para unirte a la sala.',
            });
            activeUsers.delete(u.socketId);
          }
        }

        io.to(cleanRoomId).emit('join-requests-updated', {
          joinRequests: updated?.joinRequests || [],
        });
        if (ban) {
          io.to(cleanRoomId).emit('kicked-users-updated', {
            kickedUsers: updated?.kickedUsers || [],
          });
        }
      }
    );

    // Toggle Co-host Role
    socket.on('set-role', async (data: { roomId: string; targetUserName: string; role: 'cohost' | 'member' }) => {
      const { roomId, targetUserName, role } = data;
      if (!roomId || !targetUserName) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const updatedRoom = await RoomService.setParticipantRole(cleanRoomId, targetUserName, role);
      console.log(`🎖️ Rol de ${targetUserName} cambiado a [${role}] en [${cleanRoomId}]`);

      io.to(cleanRoomId).emit('participant-role-updated', {
        targetUserName,
        role,
        participants: updatedRoom?.participants || [],
      });
    });

    // Rename Participant (identity = userId; name kept as legacy fallback)
    socket.on(
      'rename-participant',
      async (data: { roomId: string; oldName: string; newName: string; targetUserId?: string }) => {
        const { roomId, oldName, newName, targetUserId } = data;
        if (!roomId || !oldName || !newName.trim()) return;
        const cleanRoomId = roomId.toUpperCase().trim();
        const cleanNewName = newName.trim();

        const updatedRoom = await RoomService.renameParticipant(cleanRoomId, cleanNewName, {
          userId: targetUserId,
          oldName,
        });
        console.log(`✏️ Usuario ${oldName} renombrado a: ${cleanNewName}`);

        // Keep the in-memory socket directory in sync (prevents stale names on rejoin)
        for (const [, u] of activeUsers.entries()) {
          if (u.roomId !== cleanRoomId) continue;
          const matchesUser =
            (targetUserId && u.userId === targetUserId) ||
            (!targetUserId && u.userName.toLowerCase() === oldName.trim().toLowerCase());
          if (matchesUser) u.userName = cleanNewName;
        }

        // Re-key media states stored by lowercase name
        const oldKey = oldName.trim().toLowerCase();
        const media = activeMediaStates.get(oldKey);
        if (media) {
          activeMediaStates.delete(oldKey);
          activeMediaStates.set(cleanNewName.toLowerCase(), media);
        }

        io.to(cleanRoomId).emit('participant-renamed', {
          oldName,
          newName: cleanNewName,
          userId: targetUserId,
          participants: updatedRoom?.participants || [],
        });
      }
    );

    // Update Room Settings (Mute on entry, name, info, timer, etc.)
    socket.on('update-room-settings', async (data: { roomId: string; settings: any }) => {
      const { roomId, settings } = data;
      if (!roomId || !settings) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      // Only the host may change room settings
      const caller = activeUsers.get(socket.id);
      if (caller && !caller.isHost) return;

      // Normalize the auto-close timer (invalid dates are treated as "no timer")
      const payload = { ...settings };
      if ('timerEndsAt' in payload) {
        if (payload.timerEndsAt) {
          const parsed = new Date(payload.timerEndsAt);
          payload.timerEndsAt = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
        } else {
          payload.timerEndsAt = null;
        }
      }

      const updatedRoom = await RoomService.updateSettings(cleanRoomId, payload);
      io.to(cleanRoomId).emit('room-settings-updated', {
        settings: updatedRoom?.settings || payload,
      });
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
        dropPosition(user.roomId, socket.id);

        // Pending (waiting-list) users: never joined the participant list.
        // Drop their join request too, so it doesn't linger as an orphan.
        if (user.pending) {
          const updated = await RoomService.rejectJoinRequest(user.roomId, {
            userId: user.userId,
            name: user.userName,
          });
          io.to(user.roomId).emit('join-requests-updated', {
            joinRequests: updated?.joinRequests || [],
          });
          return;
        }

        const { room, newHostName } = await RoomService.removeParticipantAndTransferHost(
          user.roomId,
          user.userName,
          user.userId
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
          roomPositions.delete(user.roomId);
        }
      }
    });
  });

  // ⏱ Room auto-close timer sweep: closes rooms whose settings.timerEndsAt has passed.
  // Works for both storage modes (MongoDB and the in-memory fallback) and survives
  // because the deadline is persisted with the room itself.
  const timerSweep = setInterval(async () => {
    try {
      const expiredRooms = await RoomService.getRoomsPastTimer();
      for (const room of expiredRooms) {
        const cleanRoomId = room.roomId.toUpperCase().trim();
        console.log(`⏱ Temporizador finalizado: cerrando la sala [${cleanRoomId}]`);

        io.to(cleanRoomId).emit('room-closed', {
          message: 'El temporizador de la sala finalizó. La sala se ha cerrado.',
          reason: 'timer',
        });
        io.in(cleanRoomId).socketsLeave(cleanRoomId);
        roomPlayback.delete(cleanRoomId);
        roomPositions.delete(cleanRoomId);
        // Video is only removed when the room is temporary (deleteRoom handles that)
        await RoomService.deleteRoom(cleanRoomId, false);
      }
    } catch (err) {
      console.warn('⚠️ Error en el barrido de temporizadores de sala:', err);
    }
  }, 15_000);
  timerSweep.unref();
}
