import { RoomService } from '../services/room.service.js';

/** Casos de uso de moderación. Delgados: delegan en RoomService; la emisión la hace el handler. */
export class KickUserUseCase {
  static async execute(input: {
    roomId: string;
    targetUserName: string;
    targetUserId?: string;
    kickedBy: string;
    ban?: boolean;
  }) {
    return RoomService.kickParticipant(
      input.roomId,
      { name: input.targetUserName, userId: input.targetUserId },
      input.kickedBy,
      input.ban ?? false,
    );
  }
}

export class UnbanUserUseCase {
  static async execute(input: { roomId: string; targetUserName?: string; targetUserId?: string }) {
    return RoomService.unbanParticipant(input.roomId, {
      name: input.targetUserName,
      userId: input.targetUserId,
    });
  }
}

export class SetRoleUseCase {
  static async execute(input: { roomId: string; targetUserName: string; role: 'coleader' | 'member' }) {
    return RoomService.setParticipantRole(input.roomId, input.targetUserName, input.role);
  }
}

export class RenameParticipantUseCase {
  static async execute(input: { roomId: string; oldName: string; newName: string; targetUserId?: string }) {
    return RoomService.renameParticipant(input.roomId, input.newName.trim(), {
      userId: input.targetUserId,
      oldName: input.oldName,
    });
  }
}
