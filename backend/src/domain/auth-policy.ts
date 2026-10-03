import type { IParticipant, IRoom } from '../types/room.types.js';
import { isHostParticipant } from './room.entity.js';

/**
 * Política de autorización para acciones privilegiadas (H5/H6).
 *
 * Toda la autorización se basa en estado del SERVIDOR (participantes
 * persistidos + `hostSecret` de la sala). Nunca se confía en flags
 * enviados por el cliente (`isHost`, etc.).
 *
 * Contrato con frontend:
 * - Los payloads socket privilegiados pueden traer `hostSecret?`,
 *   `requesterUserId?`, `requesterName?`.
 * - REST usa los headers `x-host-secret`, `x-user-id`, `x-user-name`.
 * - Se autoriza si `hostSecret === room.hostSecret`, o si el solicitante
 *   coincide (userId, fallback nombre) con un participante con rol adecuado.
 */
export type RequiredRole = 'host' | 'moderator';

export interface AuthClaim {
  hostSecret?: string;
  requesterUserId?: string;
  requesterName?: string;
}

/** ¿Es este participante moderador (host o cohost)? */
export function isModeratorParticipant(p: IParticipant): boolean {
  return p.isHost === true || p.role === 'host' || p.role === 'cohost';
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
    return participants.find((p) => p.userId === claim.requesterUserId);
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
 * - 'host': solo el host (secreto válido o participante host).
 * - 'moderator': host o cohost (secreto válido o participante con rol adecuado).
 */
export function isAuthorized(
  room: IRoom | null | undefined,
  claim: AuthClaim,
  required: RequiredRole,
): boolean {
  if (!room) return false;
  if (claim.hostSecret && room.hostSecret && claim.hostSecret === room.hostSecret) return true;
  const requester = findRequesterParticipant(room, claim);
  if (!requester) return false;
  if (required === 'host') return isHostParticipant(requester);
  return isModeratorParticipant(requester);
}

/** Alias expresivos para los handlers (H5/H6). */
export function requireHost(
  room: IRoom | null | undefined,
  claim: AuthClaim,
): boolean {
  return isAuthorized(room, claim, 'host');
}

export function requireModerator(
  room: IRoom | null | undefined,
  claim: AuthClaim,
): boolean {
  return isAuthorized(room, claim, 'moderator');
}
