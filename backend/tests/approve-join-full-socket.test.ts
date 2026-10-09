/**
 * SUBAGENTE 4 (testing): `approve-join` vía socket contra sala LLENA (demo).
 *
 * Cubre el hueco entre:
 * - `tests/demo-limits.test.ts:360` (nivel SERVICIO: `approveJoinRequest`
 *   lanza `DemoCapacityError` sin desencolar), y
 * - el HANDLER socket (`src/sockets/handlers/join-approval.handler.ts:302-379`):
 *   ante sala llena debe avisar con `join-requests-updated` (lista intacta)
 *   + `join-rejected { reason: 'room-full' }` al solicitante en espera, sin
 *   agregar a nadie.
 *
 * Barato: mocks de socket/io como en `socket-guards.test.ts`, sin red real.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { RoomService } from '../src/services/room.service.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { clearAllPendingGraces } from '../src/sockets/disconnect-grace.js';
import { registerJoinApprovalHandlers } from '../src/sockets/handlers/join-approval.handler.js';
import { DEMO_ROOM_FULL_MESSAGE, setDemoModeOverride, resetDemoModeCache } from '../src/config/demo-mode.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

const created: string[] = [];

function makeSocket(id: string) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const emitted: Array<{ event: string; args: unknown[] }> = [];
  const socket: any = {
    id,
    on: (event: string, fn: (...args: any[]) => unknown) => {
      handlers.set(event, fn);
    },
    emit: (event: string, ...args: unknown[]) => {
      emitted.push({ event, args });
    },
    join: (_room: string) => {},
    leave: (_room: string) => {},
    to: (_room: string) => ({ emit: (_e: string, _p?: unknown) => {} }),
  };
  return { socket, handlers, emitted };
}

function makeIo() {
  const roomEmits: Array<{ room: string; event: string; payload: unknown }> = [];
  const io: any = {
    to: (room: string) => ({
      emit: (event: string, payload?: unknown) => {
        roomEmits.push({ room, event, payload });
      },
    }),
    in: (_room: string) => ({ socketsLeave: (_r: string) => {} }),
    sockets: { adapter: { rooms: new Map<string, Set<string>>() } },
  };
  return { io, roomEmits };
}

async function fire(handlers: Map<string, (...args: any[]) => unknown>, event: string, data: unknown) {
  await (handlers.get(event) as (...args: any[]) => unknown)(data);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Sala demo llena 5/5 con aprobación manual activada + 1 solicitud en espera. */
async function makeFullRoomWithWaiter() {
  const { room } = await RoomService.createRoom({ leaderName: 'Host', userId: 'uid-leader' });
  created.push(room.roomId);
  await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'uid-leader');
  await RoomService.joinRoom(room.roomId, 'U2', 'Web', 'uid-2');
  await RoomService.joinRoom(room.roomId, 'U3', 'Web', 'uid-3');
  await RoomService.joinRoom(room.roomId, 'U4', 'Web', 'uid-4');
  await RoomService.joinRoom(room.roomId, 'U5', 'Web', 'uid-5');
  await RoomService.updateSettings(room.roomId, { requireApproval: true });
  await RoomService.addJoinRequest(room.roomId, { socketId: 's-wait', userId: 'uid-wait', name: 'Espera' });
  return room.roomId;
}

beforeAll(() => {
  backupRoomsFile();
});

beforeEach(() => {
  activeUsers.clear();
  clearAllPendingGraces();
  setDemoModeOverride(true);
});

afterEach(async () => {
  activeUsers.clear();
  clearAllPendingGraces();
  while (created.length > 0) {
    const id = created.pop()!;
    await RoomService.deleteRoom(id, true).catch(() => false);
  }
});

afterAll(async () => {
  setDemoModeOverride(undefined);
  resetDemoModeCache();
  await restoreRoomsFile();
});

describe('approve-join vía socket en sala llena (demo 5/5)', () => {
  it('el leader aprueba → room-full al solicitante, solicitud ENCOLADA, nadie agregado', async () => {
    const roomId = await makeFullRoomWithWaiter();
    const { io, roomEmits } = makeIo();

    // Solicitante en espera (pendiente, como lo deja el handler join-room).
    activeUsers.set('s-wait', {
      socketId: 's-wait',
      roomId,
      userName: 'Espera',
      isLeader: false,
      userId: 'uid-wait',
      pending: true,
    });
    // Host aprobador (rol leader persistido del servidor).
    const leader = makeSocket('s-leader');
    activeUsers.set('s-leader', {
      socketId: 's-leader',
      roomId,
      userName: 'Host',
      isLeader: true,
      userId: 'uid-leader',
    });
    registerJoinApprovalHandlers(io, leader.socket);

    await fire(leader.handlers, 'approve-join', { roomId, userId: 'uid-wait' });

    // 1) La solicitud sigue en espera (no se desencola ante sala llena).
    const stored = await RoomService.getRoomById(roomId);
    expect(stored?.joinRequests?.some((j) => j.userId === 'uid-wait')).toBe(true);
    // 2) Nadie agregado: sigue 5/5 y sin el solicitante.
    expect(stored?.participants).toHaveLength(5);
    expect(stored?.participants.some((p) => p.userId === 'uid-wait')).toBe(false);
    // 3) La sala recibe la lista intacta…
    const listUpdates = roomEmits.filter((e) => e.event === 'join-requests-updated');
    expect(listUpdates.length).toBeGreaterThanOrEqual(1);
    expect(((listUpdates[0].payload as any)?.joinRequests ?? []).length).toBe(1);
    // 4) …y el solicitante recibe room-full dirigido a SU socket.
    const toWaiter = roomEmits.filter((e) => e.room === 's-wait' && e.event === 'join-rejected');
    expect(toWaiter).toHaveLength(1);
    expect(toWaiter[0].payload).toEqual({ reason: 'room-full', message: DEMO_ROOM_FULL_MESSAGE });
    // 5) Sin aprobación fantasma: nadie recibe join-approved/user-joined.
    expect(roomEmits.some((e) => e.event === 'join-approved' || e.event === 'user-joined')).toBe(false);
    expect(leader.emitted.some((e) => e.event === 'action-denied')).toBe(false);
  });

  it('tras liberar un cupo, el mismo approve sí entra al solicitante', async () => {
    const roomId = await makeFullRoomWithWaiter();
    await RoomService.removeParticipantAndTransferHost(roomId, 'U5', 'uid-5');
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(4);

    const { io, roomEmits } = makeIo();
    activeUsers.set('s-wait', {
      socketId: 's-wait',
      roomId,
      userName: 'Espera',
      isLeader: false,
      userId: 'uid-wait',
      pending: true,
    });
    const leader = makeSocket('s-host2');
    activeUsers.set('s-host2', {
      socketId: 's-host2',
      roomId,
      userName: 'Host',
      isLeader: true,
      userId: 'uid-leader',
    });
    registerJoinApprovalHandlers(io, leader.socket);

    await fire(leader.handlers, 'approve-join', { roomId, userId: 'uid-wait' });

    const stored = await RoomService.getRoomById(roomId);
    expect(stored?.joinRequests?.some((j) => j.userId === 'uid-wait')).toBe(false);
    expect(stored?.participants.some((p) => p.userId === 'uid-wait')).toBe(true);
    expect(roomEmits.some((e) => e.event === 'join-approved')).toBe(true);
  });
});
