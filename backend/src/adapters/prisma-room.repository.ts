import type { IRoom } from '../types/room.types.js';
import type { RoomRepository } from '../ports/room.repository.js';
import { PrismaClient, type Prisma } from '@prisma/client';

type PrismaJson = Prisma.InputJsonValue | null;

function asJson(value: unknown): PrismaJson {
  return (value ?? null) as PrismaJson;
}

/** Para el único Json obligatorio del schema (`participants`, siempre array). */
function asJsonRequired(value: unknown): Prisma.InputJsonValue {
  return (value ?? []) as Prisma.InputJsonValue;
}

function normalize(roomId: string): string {
  return roomId.toUpperCase().trim();
}

let client: PrismaClient | null = null;

/**
 * Singleton perezoso: no conecta hasta el primer uso (`$connect`).
 * La URL la resuelve `prisma.config.ts` (DATABASE_URL > MONGODB_URI > local).
 */
export function getPrismaClient(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

/** Cierre limpio (tests / apagado). */
export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect().catch(() => undefined);
    client = null;
  }
}

/** Fila Prisma → IRoom plano (misma forma que `.lean()` de Mongoose). */
export function fromPrismaRoom(row: {
  roomId: string;
  leaderName: string;
  leaderSecret: string;
  status: string;
  isTemporary: boolean | null;
  plan: string | null;
  video: unknown;
  participants: unknown;
  joinRequests: unknown;
  kickedUsers: unknown;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
}): IRoom {
  return {
    roomId: row.roomId,
    leaderName: row.leaderName,
    leaderSecret: row.leaderSecret,
    status: row.status as IRoom['status'],
    isTemporary: row.isTemporary ?? undefined,
    plan: (row.plan as IRoom['plan']) ?? undefined,
    video: (row.video as IRoom['video']) ?? undefined,
    participants: (row.participants as IRoom['participants']) ?? [],
    joinRequests: (row.joinRequests as IRoom['joinRequests']) ?? undefined,
    kickedUsers: (row.kickedUsers as IRoom['kickedUsers']) ?? undefined,
    settings: (row.settings as IRoom['settings']) ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** IRoom → fila Prisma (Json directo, sin esquemas intermedios). */
export function toPrismaRoom(room: IRoom): {
  roomId: string;
  leaderName: string;
  leaderSecret: string;
  status: string;
  isTemporary: boolean | null;
  plan: string | null;
  video: PrismaJson;
  participants: Prisma.InputJsonValue;
  joinRequests: PrismaJson;
  kickedUsers: PrismaJson;
  settings: PrismaJson;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    roomId: normalize(room.roomId),
    leaderName: room.leaderName,
    leaderSecret: room.leaderSecret,
    status: room.status,
    isTemporary: room.isTemporary ?? null,
    plan: room.plan ?? null,
    video: asJson(room.video),
    participants: asJsonRequired(room.participants),
    joinRequests: asJson(room.joinRequests),
    kickedUsers: asJson(room.kickedUsers),
    settings: asJson(room.settings),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

/**
 * Adaptador Prisma (MongoDB) del puerto RoomRepository.
 * Solo se usa con `ROOM_STORE=prisma`; por defecto el routing sigue con
 * Mongoose/memoria. Las listas van como Json: el mapeo es 1:1 con IRoom.
 */
export class PrismaRoomRepository implements RoomRepository {
  async exists(roomId: string): Promise<boolean> {
    const found = await getPrismaClient().room.findUnique({
      where: { roomId: normalize(roomId) },
      select: { roomId: true },
    });
    return found !== null;
  }

  async create(room: IRoom): Promise<IRoom> {
    const created = await getPrismaClient().room.create({ data: toPrismaRoom(room) });
    return fromPrismaRoom(created);
  }

  async findById(roomId: string): Promise<IRoom | null> {
    const row = await getPrismaClient().room.findUnique({
      where: { roomId: normalize(roomId) },
    });
    return row ? fromPrismaRoom(row) : null;
  }

  async save(room: IRoom): Promise<IRoom> {
    const data = toPrismaRoom(room);
    const { roomId, ...update } = data;
    const saved = await getPrismaClient().room.upsert({
      where: { roomId },
      create: data,
      update,
    });
    return fromPrismaRoom(saved);
  }

  async delete(roomId: string): Promise<boolean> {
    const result = await getPrismaClient().room.deleteMany({
      where: { roomId: normalize(roomId) },
    });
    return result.count > 0;
  }

  async findTimerCandidates(): Promise<IRoom[]> {
    // Pocas salas en la práctica: el filtro fino (`timerEndsAt`) es de
    // dominio (igual que el adaptador en memoria).
    const rows = await getPrismaClient().room.findMany();
    return rows
      .map(fromPrismaRoom)
      .filter((r) => (r.settings as { timerEndsAt?: string } | undefined)?.timerEndsAt != null);
  }

  async count(): Promise<number> {
    return getPrismaClient().room.count();
  }
}

/** Singleton del adaptador Prisma. */
export const prismaRoomRepository = new PrismaRoomRepository();
