import type { IParticipant, IRoom } from '../types/room.types.js';
import { isLeaderParticipant } from './room.entity.js';

/**
 * Política de autorización para acciones privilegiadas (H5/H6).
 *
 * Toda la autorización se basa en estado del SERVIDOR (participantes
 * persistidos + `leaderSecret` de la sala). Nunca se confía en flags
 * enviados por el cliente (`isLeader`, etc.).
 *
 * Contrato con frontend:
 * - Los payloads socket privilegiados pueden traer `leaderSecret?`,
 *   `requesterUserId?`, `requesterName?`.
 * - REST usa los headers `x-leader-secret`, `x-user-id`, `x-user-name`.
 * - Se autoriza si `leaderSecret === room.leaderSecret`, o si el solicitante
 *   coincide (userId, fallback nombre) con un participante con rol adecuado.
 */
export type RequiredRole = 'leader' | 'moderator';

export interface AuthClaim {
  leaderSecret?: string;
  requesterUserId?: string;
  requesterName?: string;
}

/** ¿Es este participante moderador (leader o coleader)? */
export function isModeratorParticipant(p: IParticipant): boolean {
  return p.isLeader === true || p.role === 'leader' || p.role === 'coleader';
}

/**
 * Localiza al participante solicitante en el estado persistido.
 * userId tiene prioridad; el nombre solo se usa como fallback cuando no se
 * proporcionó userId (si se proporcionó un userId desconocido NO se cae al
 * nombre, para evitar suplantación).
 */
export function findRequesterParticipant(
  room: IRoom | null | undefined,
  claim: AuthClaim,
): IParticipant | undefined {
  const participants = room?.participants || [];
  if (claim.requesterUserId) {
    const byId = participants.find((p) => p.userId === claim.requesterUserId);
    if (byId) return byId;
    if (claim.requesterName) {
      const lower = claim.requesterName.trim().toLowerCase();
      if (!lower) return undefined;
      return participants.find((p) => p.name.toLowerCase() === lower && !p.userId);
    }
    return undefined;
  }
  if (claim.requesterName) {
    const lower = claim.requesterName.trim().toLowerCase();
    if (!lower) return undefined;
    return participants.find((p) => p.name.toLowerCase() === lower);
  }
  return undefined;
}

/**
 * ¿Está autorizado el solicitante para una acción que requiere `required`?
 * - 'leader': solo el leader (secreto válido o participante leader).
 * - 'moderator': leader o coleader (secreto válido o participante con rol adecuado).
 */
export function isAuthorized(
  room: IRoom | null | undefined,
  claim: AuthClaim,
  required: RequiredRole,
): boolean {
  if (!room) return false;
  if (claim.leaderSecret && room.leaderSecret && claim.leaderSecret === room.leaderSecret) return true;
  const requester = findRequesterParticipant(room, claim);
  if (requester) {
    if (required === 'leader') return isLeaderParticipant(requester);
    return isModeratorParticipant(requester);
  }
  if (claim.requesterName && room.leaderName.toLowerCase() === claim.requesterName.trim().toLowerCase()) {
    return true;
  }
  return false;
}

/** Alias expresivos para los handlers (H5/H6). */
export function requireLeader(
  room: IRoom | null | undefined,
  claim: AuthClaim,
): boolean {
  return isAuthorized(room, claim, 'leader');
}

export function requireModerator(
  room: IRoom | null | undefined,
  claim: AuthClaim,
): boolean {
  return isAuthorized(room, claim, 'moderator');
}
