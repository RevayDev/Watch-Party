import type { IParticipant, IRoom } from '../types/room.types.js';

/** Normaliza un roomId público (mayúsculas + trim). Regla pura. */
export function normalizeRoomId(roomId: string): string {
  return roomId.toUpperCase().trim();
}

/** ¿Es este participante el leader de la sala? */
export function isLeaderParticipant(p: IParticipant): boolean {
  return p.isLeader === true || p.role === 'leader';
}

/** Identidad estable: userId si existe, si no nombre (legacy). */
export function participantIdentity(p: Pick<IParticipant, 'userId' | 'name'>): string {
  if (p.userId) return `id:${p.userId}`;
  return `name:${p.name.trim().toLowerCase()}`;
}

/** ¿Coincide un participante con un objetivo {userId?, name?/oldName?}? */
export function matchesParticipant(
  p: IParticipant,
  target: { userId?: string; name?: string; oldName?: string },
): boolean {
  const targetName = target.name ?? target.oldName;
  if (target.userId && p.userId) return p.userId === target.userId;
  if (targetName) return p.name.toLowerCase() === targetName.trim().toLowerCase();
  return false;
}

/** Busca una entrada de baneo aplicable a (userId, name). Pura. */
export function findBannedEntry(
  room: IRoom | null | undefined,
  userId: string | undefined,
  cleanName: string,
): { name: string; userId?: string; banned?: boolean } | undefined {
  const list = (room?.kickedUsers || []) as Array<{ name: string; userId?: string; banned?: boolean }>;
  return list.find((k) => {
    if (!k.banned) return false;
    if (userId && k.userId) return k.userId === userId;
    return k.name.toLowerCase() === cleanName.toLowerCase();
  });
}

/** ¿Es esta persona ya participante? (identidad = userId, nombre = fallback legacy) */
export function isAlreadyParticipant(
  participants: IParticipant[],
  userId: string | undefined,
  cleanName: string,
): boolean {
  return participants.some((p) => {
    if (userId && p.userId) return p.userId === userId;
    return !p.userId && p.name.toLowerCase() === cleanName.toLowerCase();
  });
}

/** Encuentra el participante coincidente (mismo criterio que isAlreadyParticipant). */
export function findParticipant(
  participants: IParticipant[],
  userId: string | undefined,
  cleanName: string,
): IParticipant | undefined {
  return participants.find((p) => {
    if (userId && p.userId) return p.userId === userId;
    return !p.userId && p.name.toLowerCase() === cleanName.toLowerCase();
  });
}

/** Resuelve si alguien es leader efectivo (flag del cliente, nombre del leader o rol). */
export function resolveIsHost(
  clientClaimedHost: boolean,
  room: IRoom | null | undefined,
  cleanName: string,
  participantMatch: IParticipant | undefined,
): boolean {
  return (
    clientClaimedHost ||
    (room != null && room.leaderName.toLowerCase() === cleanName.toLowerCase()) ||
    Boolean(participantMatch?.isLeader)
  );
}

/**
 * ¿Está el nombre ocupado por OTRA identidad? (H8: colisión de nombres)
 * - Rejoin con el mismo userId siempre permitido (aunque cambie el nombre).
 * - Con userId: ocupado solo si el nombre lo tiene un participante con OTRO
 *   userId registrado. Las entradas legacy sin userId son reclamables (mismo
 *   criterio que `joinRoom`), así que no bloquean.
 * - Sin userId (legacy): ocupado solo si el nombre pertenece a una identidad
 *   registrada (con userId). Dos anónimos con el mismo nombre se siguen
 *   tratando como la misma persona (comportamiento legacy preservado).
 *
 * Dónde se aplica: guarda previa en socket `join-room`
 * (join-approval.handler.ts) y REST join (room.controller.ts), ANTES del merge
 * de `RoomService.joinRoom`. Por eso el merge nunca puede suplantar a una
 * identidad registrada: si el nombre tenía userId, el anónimo ya fue rechazado.
 */
export function isNameTaken(
  participants: IParticipant[],
  userId: string | undefined,
  cleanName: string,
): boolean {
  const lower = cleanName.trim().toLowerCase();
  if (!lower) return false;
  if (userId) {
    if (participants.some((p) => p.userId === userId)) return false;
    return participants.some(
      (p) => p.name.toLowerCase() === lower && !!p.userId && p.userId !== userId,
    );
  }
  return participants.some((p) => p.name.toLowerCase() === lower && !!p.userId);
}
