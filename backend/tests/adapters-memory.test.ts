import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRoomRepository } from '../src/adapters/memory-room.repository.js';
import { roomRepository } from '../src/adapters/room-repository.routing.js';
import { getIsMongoConnected } from '../src/config/database.js';
import type { IRoom } from '../src/types/room.types.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const roomsFile = path.join(__dirname, '..', 'data', 'rooms.json');

let seq = 0;
function uniqueId(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`.toUpperCase().slice(0, 12);
}

function makeRoom(roomId: string): IRoom {
  const now = new Date();
  return {
    roomId,
    leaderName: 'Host',
    leaderSecret: 'secret',
    status: 'waiting',
    isTemporary: true,
    participants: [
      { name: 'Host', isLeader: true, role: 'leader', joinedAt: now },
    ],
    joinRequests: [],
    kickedUsers: [],
    createdAt: now,
    updatedAt: now,
  };
}

const createdThroughRouting: string[] = [];

beforeAll(() => {
  backupRoomsFile();
});

afterEach(async () => {
  while (createdThroughRouting.length > 0) {
    const id = createdThroughRouting.pop() as string;
    await roomRepository.delete(id).catch(() => false);
  }
});

afterAll(async () => {
  await restoreRoomsFile();
});

describe('MemoryRoomRepository: contrato del adaptador en memoria', () => {
  it('create + findById con normalización (minúsculas/espacios)', async () => {
    const repo = new MemoryRoomRepository();
    const id = uniqueId('ADP');
    await repo.create(makeRoom(id));
    expect(await repo.findById(`  ${id.toLowerCase()}  `)).toMatchObject({ roomId: id });
    expect(await repo.findById('ZZZZZZ')).toBeNull();
    expect(await repo.exists(id)).toBe(true);
    expect(await repo.exists('ZZZZZZ')).toBe(false);
  });

  it('save actualiza y delete elimina (false si no existía)', async () => {
    const repo = new MemoryRoomRepository();
    const id = uniqueId('ADP');
    await repo.create(makeRoom(id));
    const found = (await repo.findById(id)) as IRoom;
    found.leaderName = 'Otro';
    await repo.save(found);
    expect((await repo.findById(id))?.leaderName).toBe('Otro');
    expect(await repo.delete(` ${id.toLowerCase()} `)).toBe(true);
    expect(await repo.delete(id)).toBe(false);
    expect(await repo.findById(id)).toBeNull();
  });

  it('findTimerCandidates devuelve las salas crudas (el filtrado fino es de dominio)', async () => {
    const repo = new MemoryRoomRepository();
    const id = uniqueId('ADP');
    await repo.create(makeRoom(id));
    const candidates = await repo.findTimerCandidates();
    expect(candidates.map((r) => r.roomId)).toContain(id);
  });

  it('fichero corrupto en disco no tumba el adaptador (sigue utilizable)', async () => {
    fs.mkdirSync(path.dirname(roomsFile), { recursive: true });
    fs.writeFileSync(roomsFile, '{{{no-json', 'utf-8');
    try {
      let repo: MemoryRoomRepository | undefined;
      expect(() => {
        repo = new MemoryRoomRepository();
      }).not.toThrow();
      const id = uniqueId('ADP');
      await repo?.create(makeRoom(id));
      expect(await repo?.exists(id)).toBe(true);
    } finally {
      // Restauración inmediata: no depende del debounce de persistencia.
      await restoreRoomsFile();
      backupRoomsFile();
    }
  });
});

describe('RoutingRoomRepository: delega en memoria sin Mongo (auth-agnóstico, HTTP/WS comparten estado)', () => {
  it('sin Mongo conectado, el ciclo CRUD completo pasa por el adaptador en memoria', async () => {
    expect(getIsMongoConnected()).toBe(false);
    const id = uniqueId('RTE');
    createdThroughRouting.push(id);
    await roomRepository.create(makeRoom(id));
    expect(await roomRepository.exists(id)).toBe(true);
    expect(await roomRepository.findById(id.toLowerCase())).toMatchObject({ roomId: id });
    const room = (await roomRepository.findById(id)) as IRoom;
    room.status = 'active';
    await roomRepository.save(room);
    expect((await roomRepository.findById(id))?.status).toBe('active');
    expect((await roomRepository.findTimerCandidates()).map((r) => r.roomId)).toContain(id);
    expect(await roomRepository.delete(id)).toBe(true);
    expect(await roomRepository.findById(id)).toBeNull();
    createdThroughRouting.pop();
  });
});
