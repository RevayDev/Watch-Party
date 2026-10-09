import { Server, Socket } from 'socket.io';
import {
  KickUserUseCase,
  RenameParticipantUseCase,
  SetRoleUseCase,
  UnbanUserUseCase,
} from '../../application/moderate-user.usecase.js';
import { RoomService } from '../../services/room.service.js';
import { findRequesterParticipant, requireLeader, requireModerator } from '../../domain/auth-policy.js';
import { isLeaderParticipant } from '../../domain/room.entity.js';
import { activeMediaStates, activeUsers } from '../socket-state.js';
import { PrivilegedPayload, denySocket, resolveSocketClaim } from '../socket-auth.js';
import { dropPosition } from '../../domain/playback-policy.js';
import { pruneVideoReadySocket } from './video-ready.handler.js';

const MODERATOR_ONLY = 'Solo el anfitrión o un co-anfitrión puede realizar esta acción.';

/** Handler de moderación y roles. Nombres de eventos y payloads idénticos al original. */
export function registerModerationHandlers(io: Server, socket: Socket): void {
  // Mute a specific user remotely (Host or Co-leader)
  socket.on(
    'moderate-mute-user',
    async (data: { roomId: string; targetSocketId?: string; targetUserName: string } & PrivilegedPayload) => {
      const { roomId, targetSocketId, targetUserName } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const room = await RoomService.getRoomById(cleanRoomId);
      if (!requireModerator(room, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'moderate-mute-user', MODERATOR_ONLY);
        return;
      }

      console.log(`🔇 Moderación: Silenciando a ${targetUserName} en sala [${cleanRoomId}]`);
      io.to(cleanRoomId).emit('force-mute-user', {
        targetSocketId,
        targetUserName,
      });
    }
  );

  // Disable camera of a specific user remotely (Host or Co-leader)
  socket.on(
    'moderate-disable-camera',
    async (data: { roomId: string; targetSocketId?: string; targetUserName: string } & PrivilegedPayload) => {
      const { roomId, targetSocketId, targetUserName } = data;
      if (!roomId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const room = await RoomService.getRoomById(cleanRoomId);
      if (!requireModerator(room, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'moderate-disable-camera', MODERATOR_ONLY);
        return;
      }

      console.log(`📷 Moderación: Apagando cámara a ${targetUserName} en sala [${cleanRoomId}]`);
      io.to(cleanRoomId).emit('force-disable-camera', {
        targetSocketId,
        targetUserName,
      });
    }
  );

  // Mute all participants (Host or Co-leader)
  socket.on('moderate-mute-all', async (data: { roomId: string } & PrivilegedPayload) => {
    const { roomId } = data;
    if (!roomId) return;
    const cleanRoomId = roomId.toUpperCase().trim();

    const room = await RoomService.getRoomById(cleanRoomId);
    if (!requireModerator(room, resolveSocketClaim(socket, data))) {
      denySocket(socket, 'moderate-mute-all', MODERATOR_ONLY);
      return;
    }

    console.log(`🔇 Moderación: Silenciando a TODOS en sala [${cleanRoomId}]`);
    io.to(cleanRoomId).emit('force-mute-all');
  });

  // Disable all cameras (Host or Co-leader)
  socket.on('moderate-disable-all-cameras', async (data: { roomId: string } & PrivilegedPayload) => {
    const { roomId } = data;
    if (!roomId) return;
    const cleanRoomId = roomId.toUpperCase().trim();

    const room = await RoomService.getRoomById(cleanRoomId);
    if (!requireModerator(room, resolveSocketClaim(socket, data))) {
      denySocket(socket, 'moderate-disable-all-cameras', MODERATOR_ONLY);
      return;
    }

    console.log(`📷 Moderación: Apagando cámaras de TODOS en sala [${cleanRoomId}]`);
    io.to(cleanRoomId).emit('force-disable-all-cameras');
  });

  // Kick (ban=false → can rejoin) or Ban (ban=true → rejoin blocked)
  socket.on(
    'kick-user',
    async (
      data: { roomId: string; targetUserName: string; targetUserId?: string; kickedBy: string; ban?: boolean } & PrivilegedPayload
    ) => {
      const { roomId, targetUserName, targetUserId, kickedBy, ban = false } = data;
      if (!roomId || !targetUserName) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const room = await RoomService.getRoomById(cleanRoomId);
      if (!requireModerator(room, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'kick-user', MODERATOR_ONLY);
        return;
      }

      // El leader no puede ser expulsado por un coleader: solo el propio leader
      // (secreto válido o participante leader) puede expulsar al anfitrión.
      const targetLeader = (room?.participants || []).some((p) => {
        if (targetUserId && p.userId) return p.userId === targetUserId && isLeaderParticipant(p);
        return (
          p.name.toLowerCase() === targetUserName.trim().toLowerCase() && isLeaderParticipant(p)
        );
      });
      if (targetLeader && !requireLeader(room, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'kick-user', 'No puedes expulsar al anfitrión.');
        return;
      }

      console.log(
        `${ban ? '⛔ Baneado' : '🚫 Expulsado'} ${targetUserName} por ${kickedBy} en sala [${cleanRoomId}]`
      );
      const updatedRoom = await KickUserUseCase.execute({
        roomId: cleanRoomId,
        targetUserName,
        targetUserId,
        kickedBy,
        ban,
      });

      // Quien es expulsado/baneado sale del consenso de inmediato (su socket
      // se cerrará en el cliente, pero el consenso no espera a eso).
      for (const [sid, u] of activeUsers.entries()) {
        if (u.roomId !== cleanRoomId) continue;
        const matches =
          (targetUserId && u.userId === targetUserId) ||
          (!targetUserId && u.userName.toLowerCase() === targetUserName.trim().toLowerCase());
        if (matches) {
          dropPosition(cleanRoomId, sid);
          pruneVideoReadySocket(io, cleanRoomId, sid);
        }
      }

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
  socket.on(
    'unban-user',
    async (data: { roomId: string; targetUserName?: string; targetUserId?: string } & PrivilegedPayload) => {
      const { roomId, targetUserName, targetUserId } = data;
      if (!roomId || (!targetUserName && !targetUserId)) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const room = await RoomService.getRoomById(cleanRoomId);
      if (!requireModerator(room, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'unban-user', MODERATOR_ONLY);
        return;
      }

      const updatedRoom = await UnbanUserUseCase.execute({
        roomId: cleanRoomId,
        targetUserName,
        targetUserId,
      });
      console.log(`✅ ${targetUserName || targetUserId} desbaneado en sala [${cleanRoomId}]`);

      io.to(cleanRoomId).emit('kicked-users-updated', {
        kickedUsers: updatedRoom?.kickedUsers || [],
      });
    }
  );

  // Toggle Co-leader Role
  socket.on(
    'set-role',
    async (data: { roomId: string; targetUserName: string; role: 'coleader' | 'member' } & PrivilegedPayload) => {
      const { roomId, targetUserName, role } = data;
      if (!roomId || !targetUserName) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const room = await RoomService.getRoomById(cleanRoomId);
      if (!requireLeader(room, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'set-role', 'Solo el anfitrión puede dar o quitar roles.');
        return;
      }

      const updatedRoom = await SetRoleUseCase.execute({ roomId: cleanRoomId, targetUserName, role });
      console.log(`🎖️ Rol de ${targetUserName} cambiado a [${role}] en [${cleanRoomId}]`);

      io.to(cleanRoomId).emit('participant-role-updated', {
        targetUserName,
        role,
        participants: updatedRoom?.participants || [],
      });
    }
  );

  // Transferencia de sala: solo el leader actual puede regalar la sala.
  socket.on(
    'transfer-leader',
    async (
      data: { roomId: string; targetUserName?: string; targetUserId?: string } & PrivilegedPayload
    ) => {
      if (!data || !data.roomId) return;
      const { roomId, targetUserName, targetUserId } = data;
      if (!targetUserName && !targetUserId) return;
      const cleanRoomId = roomId.toUpperCase().trim();

      const room = await RoomService.getRoomById(cleanRoomId);
      if (!requireLeader(room, resolveSocketClaim(socket, data))) {
        denySocket(socket, 'transfer-leader', 'Solo el anfitrión puede transferir la sala.');
        return;
      }

      // ¿Está el nuevo leader conectado? (misma sala, no pending; userId o nombre lower)
      let targetSocketId: string | undefined;
      for (const [sid, u] of activeUsers.entries()) {
        if (u.roomId !== cleanRoomId || u.pending) continue;
        const matches =
          (targetUserId && u.userId === targetUserId) ||
          (!targetUserId &&
            targetUserName &&
            u.userName.toLowerCase() === targetUserName.trim().toLowerCase());
        if (matches) {
          targetSocketId = sid;
          break;
        }
      }

      const previousLeaderName = room?.leaderName;
      let result: Awaited<ReturnType<typeof RoomService.transferLeader>>;
      if (!targetSocketId) {
        console.warn(
          `⚠️ transfer-leader: nuevo anfitrión sin socket activo en sala [${cleanRoomId}]; no se rota el secreto.`
        );
        result = await RoomService.transferLeader(
          cleanRoomId,
          { userId: targetUserId, name: targetUserName },
          { rotateSecret: false }
        );
      } else {
        result = await RoomService.transferLeader(cleanRoomId, {
          userId: targetUserId,
          name: targetUserName,
        });
      }
      if (!result.room || !result.newLeaderName) {
        denySocket(socket, 'transfer-leader', 'No se encontró al participante.');
        return;
      }

      // Sincroniza flags isLeader del directorio efímero (misma sala).
      for (const [, u] of activeUsers.entries()) {
        if (u.roomId !== cleanRoomId || u.pending) continue;
        const isNewHost =
          (targetUserId && u.userId === targetUserId) ||
          u.userName.toLowerCase() === result.newLeaderName.toLowerCase();
        if (isNewHost) {
          u.isLeader = true;
        } else if (
          previousLeaderName &&
          u.userName.toLowerCase() === previousLeaderName.trim().toLowerCase()
        ) {
          u.isLeader = false;
        }
      }

      // Entrega el secreto rotado solo al nuevo leader conectado.
      if (targetSocketId && result.leaderSecret) {
        io.to(targetSocketId).emit('leader-secret', { leaderSecret: result.leaderSecret });
      }

      console.log(`👑 Sala [${cleanRoomId}] transferida a ${result.newLeaderName}`);
      io.to(cleanRoomId).emit('leader-changed', {
        newLeaderName: result.newLeaderName,
        participants: result.room.participants || [],
      });
    }
  );

  // Rename Participant (identity = userId; name kept as legacy fallback).
  // El propio usuario siempre puede renombrarse; renombrar a OTROS requiere moderador.
  socket.on(
    'rename-participant',
    async (
      data: { roomId: string; oldName: string; newName: string; targetUserId?: string } & PrivilegedPayload
    ) => {
      const { roomId, oldName, newName, targetUserId } = data;
      if (!roomId || !oldName || !newName.trim()) return;
      const cleanRoomId = roomId.toUpperCase().trim();
      const cleanNewName = newName.trim();

      const room = await RoomService.getRoomById(cleanRoomId);
      if (!room) return;
      const claim = resolveSocketClaim(socket, data);
      const requester = findRequesterParticipant(room, claim);
      const target = targetUserId
        ? room.participants.find((p) => p.userId === targetUserId)
        : room.participants.find((p) => p.name.toLowerCase() === oldName.trim().toLowerCase());
      const isSelfRename = !!requester && !!target && requester === target;
      if (!isSelfRename && !requireModerator(room, claim)) {
        denySocket(socket, 'rename-participant', MODERATOR_ONLY);
        return;
      }
      // No robar el nombre de otro participante (H8 también al renombrar)
      const occupiedByOther = room.participants.some(
        (p) =>
          p.name.toLowerCase() === cleanNewName.toLowerCase() &&
          (!targetUserId || p.userId !== targetUserId) &&
          p.name.toLowerCase() !== oldName.trim().toLowerCase()
      );
      if (occupiedByOther) {
        denySocket(socket, 'rename-participant', 'Ese nombre ya está en uso en la sala.');
        return;
      }

      const updatedRoom = await RenameParticipantUseCase.execute({
        roomId: cleanRoomId,
        oldName,
        newName: cleanNewName,
        targetUserId,
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
}
