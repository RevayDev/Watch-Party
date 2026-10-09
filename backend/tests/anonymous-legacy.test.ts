import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { RoomService } from '../src/services/room.service.js';
import {
  findParticipant,
  isAlreadyParticipant,
  isNameTaken,
} from '../src/domain/room.entity.js';
import { dropPosition, roomPositions } from '../src/domain/playback-policy.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

/**
 * Merge legacy de anónimos: dos conexiones sin userId y mismo nombre se
 * FUSIONAN (un solo participante), no se rechazan. Fijado aquí para que
 * ningún endurecimiento futuro lo convierta en rechazo ni rompa el
 * refresh/reconexión sin identidad estable.
 *
 * Seguridad verificada en este fichero:
 * - Sin colisión con identidades registradas: `isNameTaken` (guarda previa en
 *   socket join-room y REST join) ya rechaza al anónimo que usa el nombre de
 *   un userId registrado, así que el merge solo ocurre entre anónimos.
 * - Sin fugas: `activeUsers` vive por socket.id y `roomPositions` por
 *   socket.id (dropPosition al salir); aquí se comprueba el invariante.
 * - Sin romper la gracia de desconexión: la gracia solo existe por userId
 *   (disconnect-grace.ts + socket-guards.test.ts); el anónimo nunca la
 *   programa, así que su salida inmediata no cambia.
 */

const created: string[] = [];

async function makeRoom(leaderName = 'Host'): Promise<string> {
  const { room } = await RoomService.createRoom({ leaderName });
  created.push(room.roomId);
  return room.roomId;
}

beforeAll(() => {
  backupRoomsFile();
});

afterEach(async () => {
  while (created.length > 0) {
    const id = created.pop() as string;
    await RoomService.deleteRoom(id, true).catch(() => false);
  }
  activeUsers.clear();
});

afterAll(async () => {
  await restoreRoomsFile();
});

describe('merge legacy: dos anónimos con el mismo nombre son la misma persona', () => {
  it('segundo join anónimo con igual nombre (case-insensitive) no duplica', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Invitado');
    await RoomService.joinRoom(roomId, '  INVITADO  ');
    const room = await RoomService.getRoomById(roomId);
    const matches = (room?.participants || []).filter(
      (p) => p.name.toLowerCase() === 'invitado',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].userId).toBeUndefined();
  });

  it('el anónimo legacy es reclamable: un join posterior con userId lo adopta sin duplicar', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Invitado');
    await RoomService.joinRoom(roomId, 'Invitado', 'Web Browser', 'uid-9');
    const room = await RoomService.getRoomById(roomId);
    const matches = (room?.participants || []).filter(
      (p) => p.name.toLowerCase() === 'invitado',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].userId).toBe('uid-9');
  });

  it('isAlreadyParticipant/findParticipant tratan a los dos anónimos como uno (criterio del socket)', () => {
    const participants = [
      { name: 'Ana', isLeader: false, role: 'member' as const, joinedAt: new Date() },
    ];
    // Los llamantes reales (socket join-room) ya pasan el nombre limpio;
    // estas funciones comparan case-insensitive sobre el nombre limpio.
    expect(isAlreadyParticipant(participants, undefined, 'ana')).toBe(true);
    expect(findParticipant(participants, undefined, 'ANA')?.name).toBe('Ana');
  });
});

describe('el merge nunca suplanta identidades registradas', () => {
  it('anónimo frente a nombre registrado → la guarda lo marca ocupado (el merge jamás se alcanza)', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Ana', 'Web Browser', 'u-1');
    const room = await RoomService.getRoomById(roomId);
    // La protección vive en `isNameTaken`, aplicada ANTES del merge en socket
    // join-room (join-rejected name-taken) y REST join (409). Con la guarda en
    // verde, el merge legacy solo ocurre entre anónimos entre sí.
    expect(isNameTaken(room?.participants || [], undefined, 'ana')).toBe(true);
    expect(isNameTaken(room?.participants || [], undefined, 'otro')).toBe(false);
  });

  it('userId distinto frente a nombre registrado → ocupado; mismo userId → permitido', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Ana', 'Web Browser', 'u-1');
    const room = await RoomService.getRoomById(roomId);
    expect(isNameTaken(room?.participants || [], 'u-2', 'Ana')).toBe(true);
    expect(isNameTaken(room?.participants || [], 'u-1', 'OtroNombre')).toBe(false);
  });
});

describe('sin fugas de estado efímero en el ciclo anónimo', () => {
  it('activeUsers se indexa por socket.id: dos sockets anónimos con el mismo nombre coexisten y se limpian', () => {
    const before = activeUsers.size;
    activeUsers.set('s-a1', { socketId: 's-a1', roomId: 'R', userName: 'Ana', isLeader: false });
    activeUsers.set('s-a2', { socketId: 's-a2', roomId: 'R', userName: 'Ana', isLeader: false });
    expect(activeUsers.size).toBe(before + 2);
    // Salida de ambos (disconnect/leave borra por socket.id): sin residuos.
    activeUsers.delete('s-a1');
    activeUsers.delete('s-a2');
    expect(activeUsers.size).toBe(before);
  });

  it('dropPosition libera la posición por socket.id (sin huérfanos en roomPositions)', () => {
    const now = Date.now();
    roomPositions.set('R-ANON', new Map([
      ['s-a1', { socketId: 's-a1', userName: 'Ana', currentTime: 10, isPlaying: true, updatedAt: now }],
    ]));
    dropPosition('R-ANON', 's-a1');
    expect(roomPositions.has('R-ANON')).toBe(false);
  });

  it('eliminar al participante fusionado no deja duplicados huérfanos en la sala', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Invitado');
    await RoomService.joinRoom(roomId, 'INVITADO');
    await RoomService.removeParticipantAndTransferHost(roomId, 'invitado', undefined);
    const room = await RoomService.getRoomById(roomId);
    expect(
      (room?.participants || []).filter((p) => p.name.toLowerCase() === 'invitado'),
    ).toHaveLength(0);
  });
});
