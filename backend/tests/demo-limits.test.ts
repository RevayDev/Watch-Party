import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { RoomService, DemoCapacityError } from '../src/services/room.service.js';
import { RoomController } from '../src/controllers/room.controller.js';
import { DemoController } from '../src/controllers/demo.controller.js';
import { demoUploadGuard } from '../src/middleware/upload.middleware.js';
import { sanitizeRoomSettings } from '../src/domain/settings-policy.js';
import {
  DEMO_MAX_ROOMS,
  DEMO_MAX_USERS_PER_ROOM,
  DEMO_ROOM_FULL_MESSAGE,
  DEMO_ROOM_LIMIT_MESSAGE,
  DEMO_UPLOAD_DISABLED_MESSAGE,
  isDemoMode,
  parseDemoModeValue,
  resetDemoModeCache,
  setDemoModeOverride,
} from '../src/config/demo-mode.js';
import { registerJoinApprovalHandlers } from '../src/sockets/handlers/join-approval.handler.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { clearAllPendingGraces } from '../src/sockets/disconnect-grace.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

/**
 * Cobertura demo-free (tareas 2–7): flag, topes 5 salas / 5 usuarios con
 * reserva atómica, 429/403 exactos, availability sin fugas y demo-off =
 * comportamiento original.
 *
 * Se usa `setDemoModeOverride` (NO se muta `process.env`: los ficheros vitest
 * comparten proceso y mutar el env provocaría carreras entre ficheros).
 */

const created: string[] = [];

async function drain(): Promise<void> {
  while (created.length > 0) {
    const id = created.pop()!;
    await RoomService.deleteRoom(id, true).catch(() => false);
  }
}

function mockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res;
  });
  return res;
}

function mockReq(params: any = {}, body: any = {}, headers: any = {}) {
  return { params, body, headers };
}

const next = vi.fn();

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

beforeAll(() => {
  backupRoomsFile();
});

beforeEach(() => {
  activeUsers.clear();
  clearAllPendingGraces();
});

afterEach(async () => {
  activeUsers.clear();
  clearAllPendingGraces();
  await drain();
});

afterAll(async () => {
  setDemoModeOverride(undefined);
  resetDemoModeCache();
  await restoreRoomsFile();
});

describe('DEMO_MODE: flag y parseo puro', () => {
  it('parseDemoModeValue: default true; solo valores explícitos desactivan', () => {
    expect(parseDemoModeValue(undefined)).toBe(true);
    expect(parseDemoModeValue('')).toBe(true);
    expect(parseDemoModeValue('   ')).toBe(true);
    for (const off of ['false', 'FALSE', ' False ', '0', 'no', 'NO', 'off', 'OFF', 'disabled']) {
      expect(parseDemoModeValue(off)).toBe(false);
    }
    for (const on of ['true', 'TRUE', '1', 'yes', 'cualquier-otra-cosa']) {
      expect(parseDemoModeValue(on)).toBe(true);
    }
  });

  it('isDemoMode: el override manda sin tocar el env; por defecto respeta el parseo', () => {
    setDemoModeOverride(undefined);
    resetDemoModeCache();
    // Sin mutar process.env (carrera entre ficheros): consistencia con el parseo.
    expect(isDemoMode()).toBe(parseDemoModeValue(process.env.DEMO_MODE));
    setDemoModeOverride(true);
    expect(isDemoMode()).toBe(true);
    setDemoModeOverride(false);
    expect(isDemoMode()).toBe(false);
    setDemoModeOverride(undefined);
  });

  it('constantes de cuota: 5 salas y 5 usuarios/sala', () => {
    expect(DEMO_MAX_ROOMS).toBe(5);
    expect(DEMO_MAX_USERS_PER_ROOM).toBe(5);
  });
});

describe('demo: límite de 5 salas por servidor', () => {
  beforeEach(() => {
    setDemoModeOverride(true);
  });

  it('crea 5 salas y la 6ª falla con DemoCapacityError 429 y mensaje EXACTO', async () => {
    await drain();
    expect(await RoomService.countLiveRooms()).toBe(0);
    for (let i = 0; i < 5; i++) {
      const { room } = await RoomService.createRoom({ hostName: `H${i}` });
      created.push(room.roomId);
    }
    expect(await RoomService.countLiveRooms()).toBe(5);
    const err = await RoomService.createRoom({ hostName: 'Extra' }).catch((e) => e);
    expect(err).toBeInstanceOf(DemoCapacityError);
    expect((err as DemoCapacityError).statusCode).toBe(429);
    expect((err as DemoCapacityError).code).toBe('DEMO_ROOM_LIMIT');
    expect((err as Error).message).toBe(DEMO_ROOM_LIMIT_MESSAGE);
    expect((err as Error).message).toBe(
      'La demo ha alcanzado el límite de 5 salas. Intenta nuevamente más tarde.'
    );
  });

  it('concurrencia: 7 creates paralelos → exactamente 5 OK y 2 rechazados 429', async () => {
    await drain();
    const results = await Promise.allSettled(
      Array.from({ length: 7 }, (_, i) => RoomService.createRoom({ hostName: `C${i}` }))
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const ko = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(5);
    expect(ko).toHaveLength(2);
    for (const r of ok) {
      created.push((r as PromiseFulfilledResult<{ room: { roomId: string } }>).value.room.roomId);
    }
    for (const r of ko) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(DemoCapacityError);
      expect((reason as Error).message).toBe(DEMO_ROOM_LIMIT_MESSAGE);
    }
    expect(await RoomService.countLiveRooms()).toBe(5);
  });

  it('REST create con cupo agotado → 429 con el mensaje exacto (no 500)', async () => {
    await drain();
    for (let i = 0; i < 5; i++) {
      const { room } = await RoomService.createRoom({ hostName: `H${i}` });
      created.push(room.roomId);
    }
    const res = mockRes();
    await RoomController.create(mockReq({}, { hostName: 'Extra' }, {}) as any, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.body).toEqual({ error: DEMO_ROOM_LIMIT_MESSAGE });
  });

  it('eliminar una sala libera cupo: se puede crear de nuevo', async () => {
    await drain();
    for (let i = 0; i < 5; i++) {
      const { room } = await RoomService.createRoom({ hostName: `H${i}` });
      created.push(room.roomId);
    }
    const doomed = created.shift()!;
    expect(await RoomService.deleteRoom(doomed, true)).toBe(true);
    expect(await RoomService.countLiveRooms()).toBe(4);
    const { room } = await RoomService.createRoom({ hostName: 'Nueva' });
    created.push(room.roomId);
    expect(await RoomService.countLiveRooms()).toBe(5);
  });

  it('GET /api/demo/availability: solo conteos, jamás códigos ni listas', async () => {
    await drain();
    const res0 = mockRes();
    await DemoController.availability({} as any, res0, next);
    expect(res0.body).toEqual({ roomsUsed: 0, roomsTotal: 5, roomsAvailable: 5 });

    for (let i = 0; i < 2; i++) {
      const { room } = await RoomService.createRoom({ hostName: `H${i}` });
      created.push(room.roomId);
    }
    const res = mockRes();
    await DemoController.availability({} as any, res, next);
    expect(res.body).toEqual({ roomsUsed: 2, roomsTotal: 5, roomsAvailable: 3 });
    expect(Object.keys(res.body).sort()).toEqual(['roomsAvailable', 'roomsTotal', 'roomsUsed']);
    const serialized = JSON.stringify(res.body);
    for (const id of created) {
      expect(serialized).not.toContain(id);
    }
  });
});

describe('demo: límite de 5 usuarios por sala (reserva atómica)', () => {
  beforeEach(() => {
    setDemoModeOverride(true);
  });

  async function makeFullRoom(): Promise<string> {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    for (let i = 1; i <= 4; i++) {
      await RoomService.joinRoom(room.roomId, `U${i}`, 'Web', `uid-${i}`);
    }
    expect((await RoomService.getRoomById(room.roomId))?.participants).toHaveLength(5);
    return room.roomId;
  }

  it('el 6º join (servicio) lanza DemoCapacityError 429 con mensaje exacto', async () => {
    const roomId = await makeFullRoom();
    const err = await RoomService.joinRoom(roomId, 'Nuevo', 'Web', 'uid-new').catch((e) => e);
    expect(err).toBeInstanceOf(DemoCapacityError);
    expect((err as DemoCapacityError).statusCode).toBe(429);
    expect((err as DemoCapacityError).code).toBe('DEMO_ROOM_FULL');
    expect((err as Error).message).toBe(DEMO_ROOM_FULL_MESSAGE);
    expect((err as Error).message).toBe('Esta sala está llena.');
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(5);
  });

  it('reserva atómica: 3 joins paralelos sobre 4 → solo 1 entra (total 5)', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    for (let i = 1; i <= 3; i++) {
      await RoomService.joinRoom(room.roomId, `U${i}`, 'Web', `uid-${i}`);
    }
    const results = await Promise.allSettled(
      [1, 2, 3].map((n) => RoomService.joinRoom(room.roomId, `N${n}`, 'Web', `uid-n${n}`))
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect((r.reason as Error).message).toBe(DEMO_ROOM_FULL_MESSAGE);
      }
    }
    expect((await RoomService.getRoomById(room.roomId))?.participants).toHaveLength(5);
  });

  it('REST join en sala llena → 429; rejoin con mismo userId sigue permitido', async () => {
    const roomId = await makeFullRoom();
    const res = mockRes();
    await RoomController.join(
      mockReq({ roomId }, { userName: 'Nuevo', userId: 'uid-new' }, {}) as any,
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.body).toEqual({ error: DEMO_ROOM_FULL_MESSAGE });

    const res2 = mockRes();
    await RoomController.join(
      mockReq({ roomId }, { userName: 'OtroNombre', userId: 'uid-1' }, {}) as any,
      res2,
      next
    );
    expect(res2.status).not.toHaveBeenCalledWith(429);
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(5);
  });

  it('merge legacy con cupo lleno no consume cupo (sigue en 5)', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Anon', 'Web');
    for (let i = 1; i <= 3; i++) {
      await RoomService.joinRoom(room.roomId, `U${i}`, 'Web', `uid-${i}`);
    }
    expect((await RoomService.getRoomById(room.roomId))?.participants).toHaveLength(5);

    const res = mockRes();
    await RoomController.join(
      mockReq({ roomId: room.roomId }, { userName: '  ANON  ' }, {}) as any,
      res,
      next
    );
    expect(res.status).not.toHaveBeenCalledWith(429);
    expect((await RoomService.getRoomById(room.roomId))?.participants).toHaveLength(5);
  });

  it('socket join-room en sala llena → join-rejected room-full sin agregar', async () => {
    const roomId = await makeFullRoom();
    const { io } = makeIo();
    const sock = makeSocket('s-full');
    registerJoinApprovalHandlers(io, sock.socket);

    await fire(sock.handlers, 'join-room', { roomId, userName: 'Nuevo', userId: 'uid-new' });

    const rejected = sock.emitted.filter((e) => e.event === 'join-rejected').map((e) => e.args[0]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toEqual({ reason: 'room-full', message: DEMO_ROOM_FULL_MESSAGE });
    expect(sock.emitted.some((e) => e.event === 'room-state')).toBe(false);
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(5);
  });

  it('salir libera el cupo: tras removeParticipant cabe un join nuevo', async () => {
    const roomId = await makeFullRoom();
    await RoomService.removeParticipantAndTransferHost(roomId, 'U1', 'uid-1');
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(4);
    await RoomService.joinRoom(roomId, 'Nuevo', 'Web', 'uid-new');
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(5);
  });

  it('sala que queda vacía se elimina y libera cupo de salas', async () => {
    const before = await RoomService.countLiveRooms();
    const { room } = await RoomService.createRoom({ hostName: 'Solo' });
    created.push(room.roomId);
    expect(await RoomService.countLiveRooms()).toBe(before + 1);
    await RoomService.removeParticipantAndTransferHost(room.roomId, 'Solo');
    expect(await RoomService.getRoomById(room.roomId)).toBeNull();
    expect(await RoomService.countLiveRooms()).toBe(before);
    created.pop();
  });

  it('approve en sala llena no desencola: la solicitud sigue en espera', async () => {
    const roomId = await makeFullRoom();
    await RoomService.addJoinRequest(roomId, { socketId: 's-p', userId: 'uid-wait', name: 'Espera' });
    const err = await RoomService.approveJoinRequest(roomId, { userId: 'uid-wait' }).catch((e) => e);
    expect(err).toBeInstanceOf(DemoCapacityError);
    expect((err as Error).message).toBe(DEMO_ROOM_FULL_MESSAGE);
    const stored = await RoomService.getRoomById(roomId);
    expect(stored?.joinRequests?.some((j) => j.userId === 'uid-wait')).toBe(true);
    expect(stored?.participants).toHaveLength(5);
  });

  it('demo fuerza isTemporary=true en create y en update de settings', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'H', isTemporary: false });
    created.push(room.roomId);
    expect(room.isTemporary).toBe(true);
    expect(room.settings?.isTemporary).toBe(true);
    const updated = await RoomService.updateSettings(room.roomId, { isTemporary: false });
    expect(updated?.isTemporary).toBe(true);
    expect(updated?.settings?.isTemporary).toBe(true);
  });
});

describe('demo: upload deshabilitado (Drive/proxy intactos por código)', () => {
  beforeEach(() => {
    setDemoModeOverride(true);
  });

  it('controlador responde 403 con mensaje claro (respaldo tras multer)', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    const res = mockRes();
    await RoomController.uploadVideo(
      {
        params: { roomId: room.roomId },
        file: { filename: 'huerfano-demo.mp4', originalname: 'a.mp4', mimetype: 'video/mp4', size: 1 },
        headers: {},
      } as any,
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({ error: DEMO_UPLOAD_DISABLED_MESSAGE });
  });

  it('guard previo a multer: 403 sin next en demo; transparente sin demo', async () => {
    const res = mockRes();
    const nextFn = vi.fn();
    demoUploadGuard({} as any, res, nextFn);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({ error: DEMO_UPLOAD_DISABLED_MESSAGE });
    expect(nextFn).not.toHaveBeenCalled();

    setDemoModeOverride(false);
    const res2 = mockRes();
    const next2 = vi.fn();
    demoUploadGuard({} as any, res2, next2);
    expect(next2).toHaveBeenCalledTimes(1);
    expect(res2.status).not.toHaveBeenCalled();
    setDemoModeOverride(true);
  });
});

describe('demo: validación mínima del temporizador (servidor)', () => {
  const NOW = Date.parse('2026-01-01T00:00:00.000Z');

  it('rechaza minutos fuera de 1–480 (0 y >480); acepta 1–480 y null', () => {
    expect(sanitizeRoomSettings({ timerMinutes: 0 }, { demo: true, now: NOW }).errors.length).toBeGreaterThan(0);
    expect(sanitizeRoomSettings({ timerMinutes: 481 }, { demo: true, now: NOW }).errors.length).toBeGreaterThan(0);
    expect(sanitizeRoomSettings({ timerMinutes: 1 }, { demo: true, now: NOW })).toMatchObject({ errors: [] });
    expect(sanitizeRoomSettings({ timerMinutes: 480 }, { demo: true, now: NOW })).toMatchObject({ errors: [] });
    expect(sanitizeRoomSettings({ timerMinutes: null }, { demo: true, now: NOW })).toMatchObject({ errors: [] });
  });

  it('rechaza timerEndsAt pasado o más allá de 8h; acepta dentro del rango', () => {
    const inRange = new Date(NOW + 60 * 60 * 1000).toISOString();
    const tooFar = new Date(NOW + 9 * 60 * 60 * 1000).toISOString();
    const past = new Date(NOW - 1000).toISOString();
    expect(sanitizeRoomSettings({ timerEndsAt: inRange }, { demo: true, now: NOW })).toMatchObject({ errors: [] });
    expect(sanitizeRoomSettings({ timerEndsAt: tooFar }, { demo: true, now: NOW }).errors.length).toBeGreaterThan(0);
    expect(sanitizeRoomSettings({ timerEndsAt: past }, { demo: true, now: NOW }).errors.length).toBeGreaterThan(0);
    expect(sanitizeRoomSettings({ timerEndsAt: null }, { demo: true, now: NOW })).toMatchObject({ errors: [] });
  });

  it('sin demo el comportamiento original admite tiempo arbitrario', () => {
    expect(sanitizeRoomSettings({ timerMinutes: 10000 })).toMatchObject({ errors: [] });
    expect(sanitizeRoomSettings({ timerEndsAt: '2030-01-01T00:00:00.000Z' })).toMatchObject({ errors: [] });
  });
});

describe('demo off: comportamiento original restaurado', () => {
  beforeEach(() => {
    setDemoModeOverride(false);
  });

  afterEach(() => {
    setDemoModeOverride(true);
  });

  it('sin tope de salas: 6 salas simultáneas OK', async () => {
    await drain();
    for (let i = 0; i < 6; i++) {
      const { room } = await RoomService.createRoom({ hostName: `H${i}` });
      created.push(room.roomId);
    }
    expect(await RoomService.countLiveRooms()).toBe(6);
  });

  it('sin tope de usuarios: 11 participantes OK', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    for (let i = 1; i <= 10; i++) {
      await RoomService.joinRoom(room.roomId, `U${i}`, 'Web', `uid-${i}`);
    }
    expect((await RoomService.getRoomById(room.roomId))?.participants).toHaveLength(11);
  });

  it('isTemporary:false se conserva (create servicio + REST + update settings)', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'H', isTemporary: false });
    created.push(room.roomId);
    expect(room.isTemporary).toBe(false);
    const updated = await RoomService.updateSettings(room.roomId, { isTemporary: false });
    expect(updated?.isTemporary).toBe(false);
    expect(updated?.settings?.isTemporary).toBe(false);

    const res = mockRes();
    await RoomController.create(mockReq({}, { hostName: 'X', isTemporary: false }, {}) as any, res, next);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body.isTemporary).toBe(false);
    created.push(res.body.roomId);
  });
});
