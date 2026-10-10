import type { Request, Response, NextFunction } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import { RoomService } from '../services/room.service.js';
import {
  KickUserUseCase,
  UnbanUserUseCase,
  SetRoleUseCase,
  RenameParticipantUseCase,
} from '../application/moderate-user.usecase.js';
import { sanitizeRoomSettings } from '../domain/settings-policy.js';
import {
  activeUsers,
  activeMediaStates,
  clearCinematicTrigger,
} from '../sockets/socket-state.js';
import { dropPosition, roomPlayback, roomPositions } from '../domain/playback-policy.js';
import { clearVideoReady, pruneVideoReadySocket } from '../sockets/handlers/video-ready.handler.js';
import type { IParticipant, IRoom } from '../types/room.types.js';

/**
 * Panel Admin REST (docs/admin-panel-spotify.md §1).
 * Todo pasa por `requireAdmin` (ver routes/admin.routes.ts).
 * Reglas heredadas: sin `leaderSecret`/`socketId` en las respuestas,
 * mismos eventos socket que la moderación en sala, estado efímero.
 */

function getIo(req: Request): SocketIOServer | null {
  try {
    const io = req.app.get('io') as SocketIOServer | undefined;
    return io ?? null;
  } catch {
    return null;
  }
}

function emit(io: SocketIOServer | null, roomId: string, event: string, payload: unknown): void {
  try {
    io?.to(roomId).emit(event, payload);
  } catch {
    /* best-effort: la mutación ya quedó persistida */
  }
}

/** Estado de medios en vivo por nombre (best-effort, puede no existir). */
function liveMediaFor(roomId: string, name: string): { isMicOn?: boolean; isCameraOn?: boolean } {
  const lower = name.trim().toLowerCase();
  const byName = activeMediaStates.get(lower);
  if (byName) return { isMicOn: byName.isMicOn, isCameraOn: byName.isCameraOn };
  for (const [sid, u] of activeUsers.entries()) {
    if (u.roomId === roomId && u.userName.toLowerCase() === lower) {
      const bySocket = activeMediaStates.get(sid);
      if (bySocket) return { isMicOn: bySocket.isMicOn, isCameraOn: bySocket.isCameraOn };
    }
  }
  return {};
}

function sanitizeParticipant(roomId: string, p: IParticipant) {
  const { socketId: _sid, ...rest } = p as IParticipant & { socketId?: string };
  void _sid;
  return { ...rest, ...liveMediaFor(roomId, p.name) };
}

function toAdminSummary(room: IRoom) {
  const { leaderSecret: _secret, ...rest } = room as IRoom & { leaderSecret?: string };
  void _secret;
  return {
    roomId: room.roomId,
    name: room.settings?.name ?? null,
    status: room.status,
    isTemporary: room.isTemporary !== false,
    participantCount: (room.participants || []).length,
    participants: (room.participants || []).map((p) => sanitizeParticipant(room.roomId, p)),
    video: room.video
      ? {
          originalName: room.video.originalName,
          sourceType: room.video.sourceType,
          directUrl: room.video.directUrl,
        }
      : null,
    timerEndsAt: room.settings?.timerEndsAt ?? null,
    joinRequestsCount: (room.joinRequests || []).length,
    kickedCount: (room.kickedUsers || []).length,
    createdAt: room.createdAt,
    settings: rest.settings,
  };
}

function toAdminDetail(room: IRoom) {
  const summary = toAdminSummary(room);
  return {
    ...summary,
    leaderName: room.leaderName,
    joinRequests: room.joinRequests || [],
    kickedUsers: room.kickedUsers || [],
  };
}

function findParticipant(room: IRoom, targetUserName?: unknown, targetUserId?: unknown): IParticipant | undefined {
  if (typeof targetUserId === 'string' && targetUserId.trim()) {
    const byId = room.participants.find((p) => p.userId === targetUserId);
    if (byId) return byId;
  }
  if (typeof targetUserName === 'string' && targetUserName.trim()) {
    return room.participants.find(
      (p) => p.name.toLowerCase() === targetUserName.trim().toLowerCase()
    );
  }
  return undefined;
}

/** Cierre total de sala (emite, saca sockets y limpia estado efímero + disco). */
async function closeRoomEverywhere(
  io: SocketIOServer | null,
  cleanRoomId: string,
  message: string,
  forceDeleteVideo: boolean
): Promise<boolean> {
  try {
    io?.to(cleanRoomId).emit('room-closed', { message });
  } catch { /* noop */ }
  try {
    io?.in(cleanRoomId).socketsLeave(cleanRoomId);
  } catch { /* noop */ }
  roomPlayback.delete(cleanRoomId);
  roomPositions.delete(cleanRoomId);
  clearVideoReady(cleanRoomId);
  clearCinematicTrigger(cleanRoomId);
  return RoomService.deleteRoom(cleanRoomId, forceDeleteVideo);
}

export class AdminController {
  public static async listRooms(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rooms = await RoomService.listRooms();
      res.json({ rooms: rooms.map(toAdminSummary), total: rooms.length });
    } catch (error) {
      next(error);
    }
  }

  public static async getRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }
      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      res.json(toAdminDetail(room));
    } catch (error) {
      next(error);
    }
  }

  public static async updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }
      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      const raw = (req.body as { settings?: unknown } | null)?.settings ?? req.body;
      const { settings, errors } = sanitizeRoomSettings(raw);
      if (errors.length > 0) {
        res.status(400).json({ error: `Ajustes inválidos: ${errors.join(' ')}` });
        return;
      }
      const updated = await RoomService.updateSettings(roomId, settings);
      emit(getIo(req), room.roomId, 'room-settings-updated', { settings: updated?.settings });
      res.json({ message: 'Ajustes actualizados', settings: updated?.settings });
    } catch (error) {
      next(error);
    }
  }

  public static async deleteRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }
      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      const cleanRoomId = room.roomId;
      await closeRoomEverywhere(
        getIo(req),
        cleanRoomId,
        'La sala ha sido cerrada por un administrador.',
        true
      );
      res.json({ message: 'Sala cerrada y eliminada', roomId: cleanRoomId });
    } catch (error) {
      next(error);
    }
  }

  public static async kick(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      const { targetUserName, targetUserId, ban = false, kickedBy = 'admin' } = req.body ?? {};
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }
      if (
        (typeof targetUserName !== 'string' || !targetUserName.trim()) &&
        (typeof targetUserId !== 'string' || !targetUserId.trim())
      ) {
        res.status(400).json({ error: 'targetUserName o targetUserId es requerido' });
        return;
      }
      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      const cleanRoomId = room.roomId;
      const target = findParticipant(room, targetUserName, targetUserId);
      if (!target) {
        res.status(404).json({ error: 'Participante no encontrado en la sala.' });
        return;
      }
      if (target.isLeader) {
        res.status(400).json({ error: 'No se puede expulsar al anfitrión: transfiere el liderazgo primero.' });
        return;
      }
      const updatedRoom = await KickUserUseCase.execute({
        roomId: cleanRoomId,
        targetUserName: target.name,
        targetUserId: target.userId,
        kickedBy: typeof kickedBy === 'string' && kickedBy.trim() ? kickedBy.trim() : 'admin',
        ban: ban === true,
      });
      const io = getIo(req);
      // Sale del consenso de inmediato (igual que `kick-user` por socket).
      for (const [sid, u] of activeUsers.entries()) {
        if (u.roomId !== cleanRoomId) continue;
        const matches =
          (target.userId && u.userId === target.userId) ||
          (!target.userId && u.userName.toLowerCase() === target.name.toLowerCase());
        if (matches) {
          dropPosition(cleanRoomId, sid);
          if (io) pruneVideoReadySocket(io, cleanRoomId, sid);
        }
      }
      emit(io, cleanRoomId, 'user-kicked', {
        targetUserName: target.name,
        targetUserId: target.userId,
        kickedBy,
        banned: ban === true,
        participants: updatedRoom?.participants || [],
        kickedUsers: updatedRoom?.kickedUsers || [],
      });
      res.json({
        message: ban === true ? 'Usuario baneado' : 'Usuario expulsado',
        participants: updatedRoom?.participants || [],
        kickedUsers: updatedRoom?.kickedUsers || [],
      });
    } catch (error) {
      next(error);
    }
  }

  public static async unban(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      const { targetUserName, targetUserId } = req.body ?? {};
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }
      if (
        (typeof targetUserName !== 'string' || !targetUserName.trim()) &&
        (typeof targetUserId !== 'string' || !targetUserId.trim())
      ) {
        res.status(400).json({ error: 'targetUserName o targetUserId es requerido' });
        return;
      }
      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      const updatedRoom = await UnbanUserUseCase.execute({
        roomId: room.roomId,
        targetUserName,
        targetUserId,
      });
      emit(getIo(req), room.roomId, 'kicked-users-updated', {
        kickedUsers: updatedRoom?.kickedUsers || [],
      });
      res.json({ message: 'Usuario desbaneado', kickedUsers: updatedRoom?.kickedUsers || [] });
    } catch (error) {
      next(error);
    }
  }

  public static async setRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      const { targetUserName, role } = req.body ?? {};
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }
      if (role !== 'coleader' && role !== 'member') {
        res.status(400).json({ error: 'role debe ser coleader o member' });
        return;
      }
      if (typeof targetUserName !== 'string' || !targetUserName.trim()) {
        res.status(400).json({ error: 'targetUserName es requerido' });
        return;
      }
      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      const target = findParticipant(room, targetUserName);
      if (!target) {
        res.status(404).json({ error: 'Participante no encontrado en la sala.' });
        return;
      }
      const updatedRoom = await SetRoleUseCase.execute({
        roomId: room.roomId,
        targetUserName: target.name,
        role,
      });
      emit(getIo(req), room.roomId, 'participant-role-updated', {
        targetUserName: target.name,
        role,
        participants: updatedRoom?.participants || [],
      });
      res.json({ message: 'Rol actualizado', participants: updatedRoom?.participants || [] });
    } catch (error) {
      next(error);
    }
  }

  public static async transferLeader(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      const { targetUserName, targetUserId } = req.body ?? {};
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }
      if (
        (typeof targetUserName !== 'string' || !targetUserName.trim()) &&
        (typeof targetUserId !== 'string' || !targetUserId.trim())
      ) {
        res.status(400).json({ error: 'targetUserName o targetUserId es requerido' });
        return;
      }
      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      const cleanRoomId = room.roomId;
      const previousLeaderName = room.leaderName;
      // ¿Está conectado? Rota el secreto solo entonces (igual que por socket).
      let targetSocketId: string | undefined;
      for (const [sid, u] of activeUsers.entries()) {
        if (u.roomId !== cleanRoomId || u.pending) continue;
        const matches =
          (typeof targetUserId === 'string' &&
            targetUserId &&
            u.userId === targetUserId) ||
          (!targetUserId &&
            typeof targetUserName === 'string' &&
            u.userName.toLowerCase() === targetUserName.trim().toLowerCase());
        if (matches) {
          targetSocketId = sid;
          break;
        }
      }
      const result = await RoomService.transferLeader(
        cleanRoomId,
        { userId: targetUserId, name: targetUserName },
        targetSocketId ? {} : { rotateSecret: false }
      );
      if (!result.room || !result.newLeaderName) {
        res.status(404).json({ error: 'Participante no encontrado en la sala.' });
        return;
      }
      const io = getIo(req);
      for (const [, u] of activeUsers.entries()) {
        if (u.roomId !== cleanRoomId || u.pending) continue;
        const isNewHost =
          (typeof targetUserId === 'string' &&
            targetUserId &&
            u.userId === targetUserId) ||
          u.userName.toLowerCase() === result.newLeaderName.toLowerCase();
        if (isNewHost) u.isLeader = true;
        else if (previousLeaderName && u.userName.toLowerCase() === previousLeaderName.trim().toLowerCase()) {
          u.isLeader = false;
        }
      }
      if (io && targetSocketId && result.leaderSecret) {
        try {
          io.to(targetSocketId).emit('leader-secret', { leaderSecret: result.leaderSecret });
        } catch { /* noop */ }
      }
      emit(io, cleanRoomId, 'leader-changed', {
        newLeaderName: result.newLeaderName,
        participants: result.room.participants || [],
      });
      res.json({ message: 'Liderazgo transferido', newLeaderName: result.newLeaderName, participants: result.room.participants || [] });
    } catch (error) {
      next(error);
    }
  }

  public static async rename(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      const { oldName, targetUserId, newName } = req.body ?? {};
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }
      if (typeof newName !== 'string' || !newName.trim()) {
        res.status(400).json({ error: 'newName es requerido' });
        return;
      }
      if (
        (typeof oldName !== 'string' || !oldName.trim()) &&
        (typeof targetUserId !== 'string' || !targetUserId.trim())
      ) {
        res.status(400).json({ error: 'oldName o targetUserId es requerido' });
        return;
      }
      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      const cleanRoomId = room.roomId;
      const cleanNewName = newName.trim();
      const target = targetUserId
        ? room.participants.find((p) => p.userId === targetUserId)
        : room.participants.find((p) => p.name.toLowerCase() === oldName.trim().toLowerCase());
      if (!target) {
        res.status(404).json({ error: 'Participante no encontrado en la sala.' });
        return;
      }
      const occupiedByOther = room.participants.some(
        (p) =>
          p.name.toLowerCase() === cleanNewName.toLowerCase() &&
          (!targetUserId || p.userId !== targetUserId) &&
          p.name.toLowerCase() !== (typeof oldName === 'string' ? oldName.trim().toLowerCase() : '')
      );
      if (occupiedByOther) {
        res.status(409).json({ error: 'Ese nombre ya está en uso en la sala.' });
        return;
      }
      const updatedRoom = await RenameParticipantUseCase.execute({
        roomId: cleanRoomId,
        oldName: typeof oldName === 'string' ? oldName : target.name,
        newName: cleanNewName,
        targetUserId: typeof targetUserId === 'string' ? targetUserId : undefined,
      });
      for (const [, u] of activeUsers.entries()) {
        if (u.roomId !== cleanRoomId) continue;
        const matchesUser =
          (typeof targetUserId === 'string' &&
            targetUserId &&
            u.userId === targetUserId) ||
          (!targetUserId &&
            typeof oldName === 'string' &&
            u.userName.toLowerCase() === oldName.trim().toLowerCase());
        if (matchesUser) u.userName = cleanNewName;
      }
      if (typeof oldName === 'string') {
        const oldKey = oldName.trim().toLowerCase();
        const media = activeMediaStates.get(oldKey);
        if (media) {
          activeMediaStates.delete(oldKey);
          activeMediaStates.set(cleanNewName.toLowerCase(), media);
        }
      }
      emit(getIo(req), cleanRoomId, 'participant-renamed', {
        oldName: target.name,
        newName: cleanNewName,
        userId: target.userId,
        participants: updatedRoom?.participants || [],
      });
      res.json({ message: 'Participante renombrado', participants: updatedRoom?.participants || [] });
    } catch (error) {
      next(error);
    }
  }

  public static async mute(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      const { kind, targetUserName, targetUserId } = req.body ?? {};
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }
      if (kind !== 'mic' && kind !== 'camera') {
        res.status(400).json({ error: 'kind debe ser mic o camera' });
        return;
      }
      const room = await RoomService.getRoomById(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      const cleanRoomId = room.roomId;
      const io = getIo(req);
      const hasTarget =
        (typeof targetUserName === 'string' && targetUserName.trim()) ||
        (typeof targetUserId === 'string' && targetUserId.trim());
      if (hasTarget) {
        const target = findParticipant(room, targetUserName, targetUserId);
        if (!target) {
          res.status(404).json({ error: 'Participante no encontrado en la sala.' });
          return;
        }
        let targetSocketId: string | undefined;
        for (const [sid, u] of activeUsers.entries()) {
          if (u.roomId !== cleanRoomId || u.pending) continue;
          if (
            (target.userId && u.userId === target.userId) ||
            (!target.userId && u.userName.toLowerCase() === target.name.toLowerCase())
          ) {
            targetSocketId = sid;
            break;
          }
        }
        const event = kind === 'mic' ? 'force-mute-user' : 'force-disable-camera';
        emit(io, cleanRoomId, event, {
          targetSocketId,
          targetUserName: target.name,
        });
        res.json({ message: 'Silenciado', event, targetUserName: target.name });
        return;
      }
      const event = kind === 'mic' ? 'force-mute-all' : 'force-disable-all-cameras';
      emit(io, cleanRoomId, event, {});
      res.json({ message: 'Sala silenciada', event });
    } catch (error) {
      next(error);
    }
  }
}
