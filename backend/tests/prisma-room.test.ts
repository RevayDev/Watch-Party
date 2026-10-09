import { describe, it, expect, afterEach } from 'vitest';
import type { IRoom } from '../src/types/room.types.js';
import { isPrismaStore } from '../src/config/database.js';
import { fromPrismaRoom, toPrismaRoom } from '../src/adapters/prisma-room.repository.js';
import { roomRepository } from '../src/adapters/room-repository.routing.js';

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

function sampleRoom(): IRoom {
  const now = new Date();
  return {
    roomId: 'ab12cd',
    leaderName: 'Ana',
    leaderSecret: 's3cr3t',
    status: 'waiting',
    isTemporary: true,
    participants: [
      { name: 'Ana', userId: 'u-1', isLeader: true, role: 'leader', joinedAt: now },
    ],
    joinRequests: [],
    kickedUsers: [],
    settings: { muteOnEntry: false, cameraOffOnEntry: false },
    createdAt: now,
    updatedAt: now,
  };
}

describe('adaptador Prisma (mapeo puro, sin DB)', () => {
  it('toPrismaRoom normaliza el id y conserva las listas', () => {
    const row = toPrismaRoom(sampleRoom());
    expect(row.roomId).toBe('AB12CD');
    expect(row.participants).toHaveLength(1);
    expect(row.video).toBeNull();
  });

  it('fromPrismaRoom devuelve un IRoom plano (round-trip)', () => {
    const room = fromPrismaRoom({ ...toPrismaRoom(sampleRoom()) } as never);
    expect(room.roomId).toBe('AB12CD');
    expect(room.leaderName).toBe('Ana');
    expect(room.participants).toHaveLength(1);
    expect(room.createdAt).toBeInstanceOf(Date);
  });
});

describe('routing ROOM_STORE', () => {
  it('default auto: no es store prisma', () => {
    delete process.env.ROOM_STORE;
    expect(isPrismaStore()).toBe(false);
  });

  it('ROOM_STORE=prisma se detecta (insensible a mayúsculas/espacios)', () => {
    process.env.ROOM_STORE = '  Prisma ';
    expect(isPrismaStore()).toBe(true);
  });

  it('ROOM_STORE=prisma sin conexión cae a memoria sin reventar', async () => {
    process.env.ROOM_STORE = 'prisma';
    // Sin $connect, getIsPrismaConnected() es false → delega en memoria.
    await expect(roomRepository.exists('ZZZZZZ')).resolves.toBe(false);
    await expect(roomRepository.count()).resolves.toEqual(expect.any(Number));
  });
});
