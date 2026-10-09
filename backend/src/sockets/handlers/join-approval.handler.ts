import { Server, Socket } from 'socket.io';
import { RoomService } from '../../services/room.service.js';
import { DemoCapacityError, maxUsersForRoom } from '../../services/room.service.js';
import {
  DEMO_ROOM_FULL_MESSAGE,
  isDemoMode,
} from '../../config/demo-mode.js';
import { ApproveJoinUseCase, RejectJoinUseCase } from '../../application/approve-join.usecase.js';
import { ResolveSyncTimeUseCase } from '../../application/sync-playback.usecase.js';
import { dropPosition, roomPlayback, roomPositions } from '../../domain/playback-policy.js';
import { clearVideoReady, pruneVideoReadySocket } from './video-ready.handler.js';
import { findBannedEntry, isNameTaken } from '../../domain/room.entity.js';
import { requireLeader, requireModerator } from '../../domain/auth-policy.js';
import { SocketUser, activeUsers, activeMediaStates } from '../socket-state.js';
import { PrivilegedPayload, denySocket, resolveSocketClaim } from '../socket-auth.js';
import {
  cancelPendingGrace,
  hasPendingGrace,
  schedulePendingGrace,
} from '../disconnect-grace.js';
import { checkSocketRateLimit, clearSocketLimits } from '../socket-limits.js';

const MODERATOR_ONLY = 'Solo el anfitrión o un co-anfitrión puede realizar esta acción.';

// Anti-raid: un socket no puede intentar unirse más de 15 veces por minuto
// (rejoin legítimo + aprobación reintentada caben de sobra; el flood no).
const JOIN_LIMIT = { max: 15, windowMs: 60_000 };

/** Handler de unión / aprobación / salida. Nombres de eventos y payloads idénticos al original. */
export function registerJoinApprovalHandlers(io: Server, socket: Socket): void {
  // 1. Join Room
  socket.on(
    'join-room',
    async (data: { roomId: string; userName: string; isLeader?: boolean; userId?: string } | undefined) => {
      if (!data || typeof data !== 'object') return;
      const { roomId, userName, isLeader: _clientIsHost = false, userId } = data;
      void _clientIsHost; // ignorado a propósito: el leader se valida en el servidor
      if (!roomId || !userName) return;
      if (!checkSocketRateLimit(socket.id, 'join-room', JOIN_LIMIT.max, JOIN_LIMIT.windowMs)) return;

      const cleanRoomId = roomId.toUpperCase().trim();
      const cleanName = userName.trim();

      // Rejoin on the SAME socket (e.g. state refresh): don't re-broadcast join
      const previousEntry = activeUsers.get(socket.id);
      const isSameSocketRejoin = previousEntry?.roomId === cleanRoomId;

      // Check if this room already exists and who is current leader
      const existingRoom = await RoomService.getRoomById(cleanRoomId);

      // ── Ban check: banned users cannot re-enter (H4: espejo del chequeo REST) ──
      const bannedEntry = findBannedEntry(existingRoom, userId, cleanName);
      if (bannedEntry) {
        activeUsers.delete(socket.id);
        socket.emit('join-rejected', {
          reason: 'banned',
          message: 'Has sido baneado de esta sala y no puedes volver a entrar.',
        });
        return;
      }

      // ── Gracia de refresh (H3): si reaparece dentro de la ventana, se cancela
      // la eliminación diferida y conserva participante + rol (nunca se eliminó).
      if (userId && hasPendingGrace(cleanRoomId, userId)) {
        cancelPendingGrace(cleanRoomId, userId);
      }

      // ── Colisión de nombres (H8): el nombre lo usa otra identidad ──
      if (isNameTaken(existingRoom?.participants || [], userId, cleanName)) {
        activeUsers.delete(socket.id);
        socket.emit('join-rejected', {
          reason: 'name-taken',
          message: `El nombre "${cleanName}" ya está en uso por otro participante. Elige otro nombre.`,
        });
        return;
      }

      // Is this person ALREADY a participant? (identity = userId, name = legacy fallback)
      // NOTA merge legacy: dos sockets sin userId y mismo nombre casan aquí y se
      // fusionan (un solo participante en RoomService.joinRoom). No es colisión:
      // `isNameTaken` arriba ya rechazó (name-taken) al anónimo que intentaba usar
      // el nombre de una identidad registrada. Ver RoomService.joinRoom.
      const alreadyParticipant = (existingRoom?.participants || []).some((p) => {
        if (userId && p.userId) return p.userId === userId;
        return !p.userId && p.name.toLowerCase() === cleanName.toLowerCase();
      });

      const participantMatch = (existingRoom?.participants || []).find((p) => {
        if (userId && p.userId) return p.userId === userId;
        return !p.userId && p.name.toLowerCase() === cleanName.toLowerCase();
      });

      // El leader se reconoce por estado del servidor (nombre o registro),
      // NUNCA por el flag `isLeader` que envía el cliente.
      const isActuallyLeader =
        (existingRoom && existingRoom.leaderName.toLowerCase() === cleanName.toLowerCase()) ||
        Boolean(participantMatch?.isLeader);

      // ── Cuota demo: sala llena (según plan) → `join-rejected` con el
      // mensaje exacto. Rejoin/merge (alreadyParticipant) no consumen cupo.
      // Va antes de la lista de espera: una sala llena tampoco encola.
      if (
        !alreadyParticipant &&
        isDemoMode() &&
        existingRoom &&
        (existingRoom.participants?.length ?? 0) >= maxUsersForRoom(existingRoom)
      ) {
        activeUsers.delete(socket.id);
        socket.emit('join-rejected', {
          reason: 'room-full',
          message: DEMO_ROOM_FULL_MESSAGE,
        });
        return;
      }

      // ── Manual approval (waiting list): hold newcomers until leader approves ──
      const requireApproval = existingRoom?.settings?.requireApproval === true;
      if (requireApproval && !isActuallyLeader && !alreadyParticipant) {
        activeUsers.set(socket.id, {
          socketId: socket.id,
          roomId: cleanRoomId,
          userName: cleanName,
          isLeader: false,
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
        isLeader: !!isActuallyLeader,
        userId,
      };
      activeUsers.set(socket.id, socketUser);

      // Add to database/memory participant list (reserva atómica del cupo en
      // el servicio; la carrera residual se traduce a `join-rejected`).
      try {
        await RoomService.joinRoom(cleanRoomId, cleanName, 'Web Browser', userId);
      } catch (error) {
        if (error instanceof DemoCapacityError) {
          activeUsers.delete(socket.id);
          socket.leave(cleanRoomId);
          socket.emit('join-rejected', {
            reason: 'room-full',
            message: DEMO_ROOM_FULL_MESSAGE,
          });
          return;
        }
        throw error;
      }
      const room = await RoomService.getRoomById(cleanRoomId);

      console.log(`👤 ${cleanName} se unió a la sala [${cleanRoomId}] (Host: ${socketUser.isLeader})`);

      // Build existing peers list and media states for WebRTC mesh
      const existingPeers: Array<{ socketId: string; userName: string; isLeader: boolean }> = [];
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
                isLeader: peer.isLeader,
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
          isLeader: socketUser.isLeader,
          participants: room?.participants || [],
          settings: room?.settings,
          status: room?.status || 'waiting',
        });
      }

      // Reference time for the newcomer: member consensus first (the time
      // most of the room shares; seniority wins ties), last-action snapshot
      // as fallback.
      const synced = ResolveSyncTimeUseCase.execute(cleanRoomId, room?.participants || []);

      // Send initial room state + peer list for WebRTC + playback position + media states
      socket.emit('room-state', {
        roomId: cleanRoomId,
        leaderName: room?.leaderName,
        isLeader: socketUser.isLeader,
        isTemporary: room?.isTemporary !== false,
        settings: room?.settings,
        video: room?.video || null,
        status: room?.status || 'waiting',
        participants: room?.participants || [],
        joinRequests: room?.joinRequests || [],
        kickedUsers: room?.kickedUsers || [],
        peers: existingPeers,
        mediaStates: existingMediaStates,
        playback: synced !== null
          ? { currentTime: synced.currentTime, isPlaying: synced.isPlaying }
          : null,
      });
    }
  );

  // 2. Host deletes/closes the entire room (solo leader: secreto o rol leader del servidor)
  socket.on('close-room', async (data: { roomId: string } & PrivilegedPayload | undefined) => {
    if (!data || typeof data !== 'object') return;
    const { roomId } = data;
    if (!roomId) return;
    const cleanRoomId = roomId.toUpperCase().trim();

    const room = await RoomService.getRoomById(cleanRoomId);
    if (!requireLeader(room, resolveSocketClaim(socket, data))) {
      denySocket(socket, 'close-room', 'Solo el anfitrión puede cerrar la sala.');
      return;
    }

    console.log(`🚨 Host cerró la sala [${cleanRoomId}] para todos los participantes`);

    io.to(cleanRoomId).emit('room-closed', {
      message: 'La sala ha sido cerrada y eliminada por el anfitrión.',
    });

    io.in(cleanRoomId).socketsLeave(cleanRoomId);
    roomPlayback.delete(cleanRoomId);
    roomPositions.delete(cleanRoomId);
    clearVideoReady(cleanRoomId);
    await RoomService.deleteRoom(cleanRoomId, true);
  });

  // 3. User leaves voluntarily (with Host role transfer if leader leaves).
  // Salida voluntaria: inmediata (sin gracia) y cancela cualquier gracia pendiente.
  socket.on('leave-room', async (data: { roomId: string; userName: string; userId?: string } | undefined) => {
    if (!data || typeof data !== 'object') return;
    const { roomId, userName, userId } = data;
    if (!roomId) return;
    const cleanRoomId = roomId.toUpperCase().trim();

    const entry = activeUsers.get(socket.id);
    const effectiveUserId = userId || entry?.userId;
    if (effectiveUserId) cancelPendingGrace(cleanRoomId, effectiveUserId);

    socket.leave(cleanRoomId);
    activeUsers.delete(socket.id);
    dropPosition(cleanRoomId, socket.id);
    // Quien sale deja de contar para el consenso y para el auto-play.
    pruneVideoReadySocket(io, cleanRoomId, socket.id);

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

    const { room, newLeaderName } = await RoomService.removeParticipantAndTransferHost(
      cleanRoomId,
      userName,
      effectiveUserId
    );

    if (newLeaderName) {
      for (const [_sId, u] of activeUsers.entries()) {
        if (u.roomId === cleanRoomId && u.userName.toLowerCase() === newLeaderName.toLowerCase()) {
          u.isLeader = true;
        }
      }

      io.to(cleanRoomId).emit('leader-changed', {
        newLeaderName,
        participants: room?.participants || [],
      });
    }

    socket.to(cleanRoomId).emit('user-left', {
      socketId: socket.id,
      userName,
      participants: room?.participants || [],
    });
  });

  // ── WAITING LIST: approve / reject join requests (moderador: leader o coleader) ──
  socket.on(
    'approve-join',
    async (data: { roomId: string; userId?: string; name?: string } & PrivilegedPayload) => {
      const { roomId, userId, name } = data;
      if (!roomId || (!userId && !name)) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const roomState = await RoomService.getRoomById(cleanRoomId);
      if (!requireModerator(roomState, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'approve-join', MODERATOR_ONLY);
        return;
      }

      // Demo: aprobar contra una sala llena lanza DemoCapacityError SIN
      // desencolar (la solicitud sigue en espera). Se avisa a la sala
      // (lista intacta) y al solicitante (mismo mensaje de sala llena).
      let room: Awaited<ReturnType<typeof RoomService.getRoomById>>;
      let request: Awaited<ReturnType<typeof ApproveJoinUseCase.execute>>['request'];
      try {
        const result = await ApproveJoinUseCase.execute({ roomId: cleanRoomId, userId, name });
        room = result.room;
        request = result.request;
      } catch (error) {
        if (error instanceof DemoCapacityError) {
          const current = await RoomService.getRoomById(cleanRoomId);
          io.to(cleanRoomId).emit('join-requests-updated', {
            joinRequests: current?.joinRequests || [],
          });
          for (const [, u] of activeUsers.entries()) {
            if (u.roomId !== cleanRoomId || !u.pending) continue;
            const matchById = Boolean(u.userId && userId && u.userId === userId);
            const matchByName =
              !userId && name && u.userName.toLowerCase() === name.trim().toLowerCase();
            if (matchById || matchByName) {
              io.to(u.socketId).emit('join-rejected', {
                reason: 'room-full',
                message: DEMO_ROOM_FULL_MESSAGE,
              });
            }
          }
          return;
        }
        throw error;
      }
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
          isLeader: false,
          participants: room?.participants || [],
        });
      }
    }
  );

  socket.on(
    'reject-join',
    async (
      data: { roomId: string; userId?: string; name?: string; ban?: boolean; requestedBy?: string } & PrivilegedPayload
    ) => {
      const { roomId, userId, name, ban = false, requestedBy } = data;
      if (!roomId || (!userId && !name)) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const roomState = await RoomService.getRoomById(cleanRoomId);
      if (!requireModerator(roomState, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'reject-join', MODERATOR_ONLY);
        return;
      }

      const updated = await RejectJoinUseCase.execute(
        { roomId: cleanRoomId, userId, name },
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

  // 9. Disconnection (Handle auto-leader transfer when leader drops out).
  // Con userId: eliminación + transferencia diferidas 20s (gracia de refresh).
  // Sin userId o pendiente: comportamiento inmediato original.
  // `user-left` solo se emite al eliminar de verdad.
  socket.on('disconnect', async () => {
    // Estado efímero de rate-limit/throttle/dedup: se libera con el socket.
    clearSocketLimits(socket.id);
    const user = activeUsers.get(socket.id);
    if (user) {
      activeUsers.delete(socket.id);
      dropPosition(user.roomId, socket.id);
      // La desconexión también saca al socket del conteo de auto-play (la
      // gracia de 20 s solo difiere participante + leader, nunca el consenso).
      pruneVideoReadySocket(io, user.roomId, socket.id);

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

      // ── Gracia de refresh (H3): diferir eliminación + transferencia ──
      if (user.userId) {
        const { roomId, userName, userId } = user;
        const socketId = socket.id;
        schedulePendingGrace(roomId, userId, async () => {
          // Si el usuario sigue conectado por otro socket, no eliminar.
          for (const [, u] of activeUsers.entries()) {
            if (u.roomId === roomId && !u.pending && u.userId === userId) return;
          }
          const { room, newLeaderName } = await RoomService.removeParticipantAndTransferHost(
            roomId,
            userName,
            userId
          );

          console.log(`🔌 ${userName} se desconectó de la sala [${roomId}]`);

          if (newLeaderName) {
            for (const [_sId, u] of activeUsers.entries()) {
              if (
                u.roomId === roomId &&
                u.userName.toLowerCase() === newLeaderName.toLowerCase()
              ) {
                u.isLeader = true;
              }
            }

            socket.to(roomId).emit('leader-changed', {
              newLeaderName,
              participants: room?.participants || [],
            });
          }

          socket.to(roomId).emit('user-left', {
            socketId,
            userName,
            participants: room?.participants || [],
          });

          // Clean up empty rooms
          const roomSockets = io.sockets.adapter.rooms.get(roomId);
          if (!roomSockets || roomSockets.size === 0) {
            roomPlayback.delete(roomId);
            roomPositions.delete(roomId);
            clearVideoReady(roomId);
          }
        });
        return;
      }

      const { room, newLeaderName } = await RoomService.removeParticipantAndTransferHost(
        user.roomId,
        user.userName,
        user.userId
      );

      console.log(`🔌 ${user.userName} se desconectó de la sala [${user.roomId}]`);

      if (newLeaderName) {
        for (const [_sId, u] of activeUsers.entries()) {
          if (
            u.roomId === user.roomId &&
            u.userName.toLowerCase() === newLeaderName.toLowerCase()
          ) {
            u.isLeader = true;
          }
        }

        socket.to(user.roomId).emit('leader-changed', {
          newLeaderName,
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
        clearVideoReady(user.roomId);
      }
    }
  });
}
