import { RoomService } from '../services/room.service.js';

/** Caso de uso: aprobar una solicitud de unión en espera. Delgado: delega en RoomService. */
export class ApproveJoinUseCase {
  static async execute(input: { roomId: string; userId?: string; name?: string }) {
    return RoomService.approveJoinRequest(input.roomId, { userId: input.userId, name: input.name });
  }
}

/** Caso de uso: rechazar (o banear) una solicitud de unión. Delgado: delega en RoomService. */
export class RejectJoinUseCase {
  static async execute(
    input: { roomId: string; userId?: string; name?: string },
    opts: { ban?: boolean; rejectedBy?: string } = {},
  ) {
    return RoomService.rejectJoinRequest(
      input.roomId,
      { userId: input.userId, name: input.name },
      opts,
    );
  }
}
