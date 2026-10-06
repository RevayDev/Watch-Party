import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomService } from '../src/services/room.service.js';
import { RoomController } from '../src/controllers/room.controller.js';
import { DemoController } from '../src/controllers/demo.controller.js';
import {
  DEMO_MAX_ROOMS,
  DEMO_MAX_USERS_PER_ROOM,
  DEMO_ROOM_FULL_MESSAGE,
  DEMO_ROOM_LIMIT_MESSAGE,
  setDemoModeOverride,
  resetDemoModeCache,
} from '../src/config/demo-mode.js';
import { registerJoinApprovalHandlers } from '../src/sockets/handlers/join-approval.handler.js';
import { activeUsers } from '../src/sockets/socket-state.js';
import { clearAllPendingGraces, hasPendingGrace } from '../src/sockets/disconnect-grace.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

/**
 * SUBAGENTE 3 (TESTER) — verificación INTEGRADA demo-free y huecos.
 *
 * supertest NO instalado: integración vía llamadas directas a
 * controller (REST) + service + handlers socket con sockets mockeados
 * (mismo patrón que los tests existentes). Todo en memoria.
 *
 * Cubre: (1) salas 1–5 OK + 6ª 429 vía REST; (2) usuarios 5/5, 6º
 * rechazado REST+socket, salida libera cupo, gracia 20s con timers falsos,
 * close-room libera cupo global; (3) privacidad; (4) Drive sin red;
 * (5) temporizador server-side; (6) simulación 5×5 en memoria.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_SRC = path.join(__dirname, '..', 'src');
const FRONTEND_SRC = path.join(__dirname, '..', '..', 'frontend', 'src');

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
  const toEmitted: Array<{ room: string; event: string; payload: unknown }> = [];
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
    to: (room: string) => ({
      emit: (event: string, payload?: unknown) => {
        toEmitted.push({ room, event, payload });
      },
    }),
  };
  return { socket, handlers, emitted, toEmitted };
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

async function makeFullRoom(): Promise<string> {
  const { room } = await RoomService.createRoom({ hostName: 'Host' });
  created.push(room.roomId);
  for (let i = 1; i <= 4; i++) {
    await RoomService.joinRoom(room.roomId, `U${i}`, 'Web', `uid-${i}`);
  }
  expect((await RoomService.getRoomById(room.roomId))?.participants).toHaveLength(5);
  return room.roomId;
}

beforeAll(() => {
  backupRoomsFile();
});

beforeEach(() => {
  setDemoModeOverride(true);
  activeUsers.clear();
  clearAllPendingGraces();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  activeUsers.clear();
  clearAllPendingGraces();
  await drain();
});

afterAll(async () => {
  setDemoModeOverride(undefined);
  resetDemoModeCache();
  await restoreRoomsFile();
});

// ── 1. Salas: 1–5 OK vía REST, la 6ª 429 exacto ─────────────────────────────
describe('integrado salas: 5×201 vía REST y la 6ª 429 exacto', () => {
  it('PROBADO: crea 1–5 por REST (201) y la 6ª responde 429 con mensaje exacto', async () => {
    await drain();
    expect(await RoomService.countLiveRooms()).toBe(0);
    for (let i = 0; i < DEMO_MAX_ROOMS; i++) {
      const res = mockRes();
      await RoomController.create(mockReq({}, { hostName: `H${i}` }, {}) as any, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.body.roomId).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      created.push(res.body.roomId);
    }
    expect(await RoomService.countLiveRooms()).toBe(5);
    const res6 = mockRes();
    await RoomController.create(mockReq({}, { hostName: 'Extra' }, {}) as any, res6, next);
    expect(res6.status).toHaveBeenCalledWith(429);
    expect(res6.body).toEqual({ error: DEMO_ROOM_LIMIT_MESSAGE });
    expect(res6.body).toEqual({
      error: 'La demo ha alcanzado el límite de 5 salas. Intenta nuevamente más tarde.',
    });
  });
});

// ── 2. Usuarios 5/5, 6º rechazado, salida/gracia/cierre ──────────────────
describe('integrado usuarios: 5/5, 6º rechazado, liberación de cupo', () => {
  it('PROBADO: sala llena 5/5 — 6º REST 429 exacto y socket join-rejected room-full', async () => {
    const roomId = await makeFullRoom();
    const rest = mockRes();
    await RoomController.join(
      mockReq({ roomId }, { userName: 'Nuevo', userId: 'uid-new' }, {}) as any,
      rest,
      next
    );
    expect(rest.status).toHaveBeenCalledWith(429);
    expect(rest.body).toEqual({ error: DEMO_ROOM_FULL_MESSAGE });
    expect(rest.body).toEqual({ error: 'Esta sala está llena.' });

    const { io } = makeIo();
    const sock = makeSocket('s-11');
    registerJoinApprovalHandlers(io, sock.socket);
    await fire(sock.handlers, 'join-room', { roomId, userName: 'Nuevo', userId: 'uid-new' });
    const rejected = sock.emitted.filter((e) => e.event === 'join-rejected').map((e) => e.args[0]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toEqual({ reason: 'room-full', message: DEMO_ROOM_FULL_MESSAGE });
    expect(sock.emitted.some((e) => e.event === 'room-state')).toBe(false);
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(5);
    expect(DEMO_MAX_USERS_PER_ROOM).toBe(5);
  });

  it('PROBADO: leave-room voluntario libera cupo de inmediato (4 → join nuevo → 5)', async () => {
    const roomId = await makeFullRoom();
    const { io } = makeIo();
    const sock = makeSocket('s-u1');
    activeUsers.set('s-u1', {
      socketId: 's-u1',
      roomId,
      userName: 'U1',
      isHost: false,
      userId: 'uid-1',
    });
    registerJoinApprovalHandlers(io, sock.socket);
    await fire(sock.handlers, 'leave-room', { roomId, userName: 'U1', userId: 'uid-1' });
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(4);

    const res = mockRes();
    await RoomController.join(
      mockReq({ roomId }, { userName: 'Nuevo', userId: 'uid-new' }, {}) as any,
      res,
      next
    );
    expect(res.statusCode).toBe(200);
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(5);
  });

  it('PROBADO: gracia 20s — disconnect retiene cupo (429 durante la gracia) y al expirar libera', async () => {
    vi.useFakeTimers();
    const roomId = await makeFullRoom();
    const { io } = makeIo();
    const sock = makeSocket('s-u1');
    activeUsers.set('s-u1', {
      socketId: 's-u1',
      roomId,
      userName: 'U1',
      isHost: false,
      userId: 'uid-1',
    });
    registerJoinApprovalHandlers(io, sock.socket);
    await fire(sock.handlers, 'disconnect', undefined);

    // Dentro de la ventana: el participante SIGUE en sala (cupo retenido).
    expect(hasPendingGrace(roomId, 'uid-1')).toBe(true);
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(5);
    const during = mockRes();
    await RoomController.join(
      mockReq({ roomId }, { userName: 'Nuevo', userId: 'uid-new' }, {}) as any,
      during,
      next
    );
    expect(during.status).toHaveBeenCalledWith(429);
    expect(during.body).toEqual({ error: DEMO_ROOM_FULL_MESSAGE });

    // Expira la gracia (20s): eliminación diferida y cupo libre.
    await vi.advanceTimersByTimeAsync(20_000);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(hasPendingGrace(roomId, 'uid-1')).toBe(false);
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(4);

    const after = mockRes();
    await RoomController.join(
      mockReq({ roomId }, { userName: 'Nuevo', userId: 'uid-new' }, {}) as any,
      after,
      next
    );
    expect(after.statusCode).toBe(200);
    expect((await RoomService.getRoomById(roomId))?.participants).toHaveLength(5);
  });

  it('PROBADO: close-room por socket libera cupo global (5→4→5)', async () => {
    await drain();
    const secrets: Array<{ id: string; secret: string }> = [];
    for (let i = 0; i < 5; i++) {
      const { room, hostSecret } = await RoomService.createRoom({ hostName: `H${i}` });
      created.push(room.roomId);
      secrets.push({ id: room.roomId, secret: hostSecret });
    }
    expect(await RoomService.countLiveRooms()).toBe(5);

    const { io, roomEmits } = makeIo();
    const sock = makeSocket('s-host0');
    registerJoinApprovalHandlers(io, sock.socket);
    await fire(sock.handlers, 'close-room', { roomId: secrets[0].id, hostSecret: secrets[0].secret });
    expect(await RoomService.getRoomById(secrets[0].id)).toBeNull();
    expect(roomEmits.some((e) => e.event === 'room-closed')).toBe(true);
    expect(await RoomService.countLiveRooms()).toBe(4);
    created.splice(
      created.indexOf(secrets[0].id),
      1
    );

    const res = mockRes();
    await RoomController.create(mockReq({}, { hostName: 'Nueva' }, {}) as any, res, next);
    expect(res.status).toHaveBeenCalledWith(201);
    created.push(res.body.roomId);
    expect(await RoomService.countLiveRooms()).toBe(5);
  });
});

// ── 3. Privacidad ────────────────────────────────────────────────────────────
describe('integrado privacidad: sin código no se entra; sin listado; sin fugas', () => {
  it('PROBADO: REST join a sala inexistente → 404 exacto sin fugas', async () => {
    const res = mockRes();
    await RoomController.join(
      mockReq({ roomId: 'ZZZZZZ' }, { userName: 'X', userId: 'u-x' }, {}) as any,
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.body).toEqual({ error: 'Room not found' });
  });

  it('PROBADO: getById inexistente → 404; existente jamás expone hostSecret', async () => {
    const missing = mockRes();
    await RoomController.getById({ params: { roomId: 'ZZZZZZ' } } as any, missing, next);
    expect(missing.status).toHaveBeenCalledWith(404);
    expect(missing.body).toEqual({ error: 'Room not found' });

    const { room } = await RoomService.createRoom({ hostName: 'H' });
    created.push(room.roomId);
    const ok = mockRes();
    await RoomController.getById({ params: { roomId: room.roomId } } as any, ok, next);
    expect(ok.body.roomId).toBe(room.roomId);
    expect(ok.body.hostSecret).toBeUndefined();
    expect(JSON.stringify(ok.body)).not.toContain(room.hostSecret);
  });

  it('PROBADO: no existe endpoint de listado de salas en el backend', () => {
    const roomRoutes = fs.readFileSync(path.join(BACKEND_SRC, 'routes', 'room.routes.ts'), 'utf-8');
    const demoRoutes = fs.readFileSync(path.join(BACKEND_SRC, 'routes', 'demo.routes.ts'), 'utf-8');
    const app = fs.readFileSync(path.join(BACKEND_SRC, 'app.ts'), 'utf-8');
    expect(roomRoutes).not.toMatch(/router\.get\(['"]\/['"]/);
    expect(roomRoutes + demoRoutes + app).not.toMatch(/listRooms|getAllRooms|findAll/);
    // Montajes /api conocidos: rooms, demo (solo availability) y proxy. Nada más lista salas.
    expect(app).toContain("app.use('/api/rooms'");
    expect(app).toContain("app.use('/api/demo'");
  });

  it('PROBADO: el frontend Home no consume ningún listado (solo availability + create/join por código)', () => {
    const api = fs.readFileSync(path.join(FRONTEND_SRC, 'services', 'api.ts'), 'utf-8');
    const home = fs.readFileSync(path.join(FRONTEND_SRC, 'features', 'home', 'Home.tsx'), 'utf-8');
    expect(api).not.toMatch(/listRooms|getAllRooms|allRooms/i);
    expect(home).not.toContain('fetch(');
    expect(home).not.toContain('/api/rooms');
    expect(home).toContain('getDemoAvailability');
  });

  it('PROBADO: availability solo conteos y errores sin códigos ni participantes', async () => {
    await drain();
    for (let i = 0; i < 2; i++) {
      const { room } = await RoomService.createRoom({ hostName: `H${i}` });
      created.push(room.roomId);
    }
    const res = mockRes();
    await DemoController.availability({} as any, res, next);
    expect(res.body).toEqual({ roomsUsed: 2, roomsTotal: 5, roomsAvailable: 3 });
    expect(Object.keys(res.body).sort()).toEqual(['roomsAvailable', 'roomsTotal', 'roomsUsed']);

    // Errores exactos, sin participantes ni códigos filtrados.
    const fullId = await makeFullRoom();
    const join429 = mockRes();
    await RoomController.join(
      mockReq({ roomId: fullId }, { userName: 'Nuevo', userId: 'uid-new' }, {}) as any,
      join429,
      next
    );
    expect(join429.body).toEqual({ error: DEMO_ROOM_FULL_MESSAGE });
    expect(JSON.stringify(join429.body)).not.toContain(fullId);

    const denied = mockRes();
    await RoomController.delete(mockReq({ roomId: fullId }, {}, {}) as any, denied, next);
    expect(denied.status).toHaveBeenCalledWith(403);
    expect(denied.body).toEqual({ error: 'Solo el anfitrión puede eliminar la sala.' });
    expect(JSON.stringify(denied.body)).not.toContain(fullId);
  });

  it('HALLAZGO-1 (documenta comportamiento actual): socket join-room a sala inexistente emite room-state en vez de 404', async () => {
    // Inconsistente con REST join (404). Ver reporte: se REPORTA, no se corrige
    // aquí (cambiarlo alteraría el contrato socket con clientes conectados).
    const { io } = makeIo();
    const sock = makeSocket('s-ghost');
    registerJoinApprovalHandlers(io, sock.socket);
    await fire(sock.handlers, 'join-room', { roomId: 'ZZZZZZ', userName: 'Fan', userId: 'u-fan' });
    expect(sock.emitted.some((e) => e.event === 'join-rejected')).toBe(false);
    const states = sock.emitted.filter((e) => e.event === 'room-state').map((e) => e.args[0]);
    expect(states).toHaveLength(1);
    expect((states[0] as any).hostName).toBeUndefined();
    expect((states[0] as any).participants).toEqual([]);
  });
});

// ── 4. Vídeo Drive (lógica, sin red) ─────────────────────────────────────────
describe('integrado vídeo Drive: conversión de enlace sin red', () => {
  it('PROBADO: setVideoUrl convierte enlace Drive a usercontent sin tocar la red (fetch stub)', async () => {
    const { room, hostSecret } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-host');

    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/file/d/') && url.includes('/view')) {
        return {
          ok: true,
          text: async () => '<html><head><title>Mi Pelicula - Google Drive</title></head></html>',
        } as any;
      }
      return {
        status: 200,
        headers: { get: () => 'video/mp4' },
        body: { cancel: async () => {} },
      } as any;
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await RoomController.setVideoUrl(
      mockReq(
        { roomId: room.roomId },
        { url: 'https://drive.google.com/file/d/ABC123XYZ/view?usp=sharing' },
        { 'x-host-secret': hostSecret }
      ) as any,
      res,
      next
    );
    expect(res.statusCode).toBe(200);
    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.video?.directUrl).toBe(
      'https://drive.usercontent.google.com/download?id=ABC123XYZ&export=download&confirm=t'
    );
    expect(stored?.video?.sourceType).toBe('url');
    // Nombre real leído de la página pública (stub), sin red real.
    expect(stored?.video?.originalName).toBe('Mi Pelicula');
    expect(fetchMock).toHaveBeenCalled();
  });
  // Sync play/pause/seek + consenso de recién llegado: YA cubierto, no se
  // duplica. Verificado en verde: tests/sync-usecases.test.ts (snapshot,
  // consenso>snapshot, heartbeat válido/inválido), tests/sync-hardening.test.ts
  // (difusión sync-video con sentAt, dedup, throttle heartbeat, video-changed)
  // y tests/resolveRoomTime.test.ts (cluster/mediana/seniority/TTL).
});

// ── 5. Temporizador server-side ──────────────────────────────────────────────
describe('integrado temporizador: server-side, estable ante rejoins', () => {
  it('PROBADO: rejoins y varios usuarios NO reinician ni tocan timerEndsAt', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    const endsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await RoomService.updateSettings(room.roomId, { timerEndsAt: endsAt });
    const before = (await RoomService.getRoomById(room.roomId))?.settings?.timerEndsAt;

    // Varios usuarios entran y uno reentra con otro nombre (misma identidad).
    await RoomService.joinRoom(room.roomId, 'A', 'Web', 'u-a');
    await RoomService.joinRoom(room.roomId, 'B', 'Web', 'u-b');
    await RoomService.joinRoom(room.roomId, 'A-renombrado', 'Web', 'u-a');

    const { io } = makeIo();
    const sock = makeSocket('s-re');
    registerJoinApprovalHandlers(io, sock.socket);
    await fire(sock.handlers, 'join-room', { roomId: room.roomId, userName: 'C', userId: 'u-c' });

    const after = await RoomService.getRoomById(room.roomId);
    expect(after?.settings?.timerEndsAt).toBe(before);
    expect(after?.participants.length).toBeGreaterThanOrEqual(4);
  });

  it('PROBADO: getRoomsPastTimer detecta sala vencida con varios usuarios; futura/sin timer no', async () => {
    const { room: expired } = await RoomService.createRoom({ hostName: 'H1' });
    created.push(expired.roomId);
    await RoomService.joinRoom(expired.roomId, 'M1', 'Web', 'u-m1');
    await RoomService.joinRoom(expired.roomId, 'M2', 'Web', 'u-m2');
    await RoomService.updateSettings(expired.roomId, {
      timerEndsAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const { room: future } = await RoomService.createRoom({ hostName: 'H2' });
    created.push(future.roomId);
    await RoomService.updateSettings(future.roomId, {
      timerEndsAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const ids = (await RoomService.getRoomsPastTimer()).map((r) => r.roomId);
    expect(ids).toContain(expired.roomId);
    expect(ids).not.toContain(future.roomId);
    // El barrido server-side vive en src/sockets/room.socket.ts (setInterval
    // 15s → room-closed reason timer → deleteRoom); el deadline persiste en la
    // sala, por eso sobrevive a rejoins. Cobertura de validación del rango demo
    // 1–480min en tests/demo-limits.test.ts (sección temporizador).
  });
});

// ── 6. Simulación 5×5 en memoria ────────────────────────────────────────────
describe('simulación 5×5 en memoria (PROBADO memoria; 25 reales = ESTIMADO)', () => {
  it('PROBADO: 5 salas × 5 usuarios en memoria + sockets mock rechazados al 6º; mide CPU', async () => {
    await drain();
    const t0 = performance.now();
    const ids: string[] = [];
    for (let s = 0; s < 5; s++) {
      const { room } = await RoomService.createRoom({ hostName: `Host${s}` });
      created.push(room.roomId);
      ids.push(room.roomId);
      for (let u = 1; u <= 4; u++) {
        await RoomService.joinRoom(room.roomId, `S${s}U${u}`, 'Web', `uid-s${s}u${u}`);
      }
    }
    const setupMs = performance.now() - t0;
    expect(await RoomService.countLiveRooms()).toBe(5);
    for (const id of ids) {
      expect((await RoomService.getRoomById(id))?.participants).toHaveLength(5);
    }

    // 25 conexiones socket mockeadas extra (1 por cupo ya ocupado no basta:
    // una por sala) → todas room-full, nadie agregado.
    const t1 = performance.now();
    for (const id of ids) {
      const { io } = makeIo();
      const sock = makeSocket(`s-extra-${id}`);
      registerJoinApprovalHandlers(io, sock.socket);
      await fire(sock.handlers, 'join-room', { roomId: id, userName: 'Extra', userId: 'uid-extra' });
      const rejected = sock.emitted.filter((e) => e.event === 'join-rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].args[0]).toEqual({ reason: 'room-full', message: DEMO_ROOM_FULL_MESSAGE });
    }
    const socketsMs = performance.now() - t1;
    for (const id of ids) {
      expect((await RoomService.getRoomById(id))?.participants).toHaveLength(5);
    }

    // Tiempos de CPU en memoria (referencia, NO equivalen a 25 usuarios reales
    // con WebRTC/red). Se reportan como PROBADO-memoria; producción = ESTIMADO.
    expect(setupMs).toBeGreaterThanOrEqual(0);
    expect(socketsMs).toBeGreaterThanOrEqual(0);
    console.log(`[5x5-mem] setup 5 salas×5 users: ${setupMs.toFixed(1)}ms; 5 sockets mock: ${socketsMs.toFixed(1)}ms`);
  });
});
