import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { RoomController } from '../src/controllers/room.controller.js';
import { RoomService } from '../src/services/room.service.js';
import { setDemoModeOverride } from '../src/config/demo-mode.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

// Este fichero verifica el comportamiento ORIGINAL (p. ej. modo persistente
// con `isTemporary: false`), así que fija la demo desactivada con override
// (sin mutar process.env: los ficheros vitest comparten proceso). La
// cobertura del modo demo vive en tests/demo-limits.test.ts.
setDemoModeOverride(false);

const created: string[] = [];

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

const next = vi.fn();

it('transfers music to the main video at a checkpoint and only permits moderators to clear it', async () => {
  const { room, leaderSecret } = await RoomService.createRoom({ leaderName: 'Host' });
  created.push(room.roomId);
  await RoomService.addMusicEntry(room.roomId, { trackId: 'PW6ZSzdjrlo', name: 'Song', artists: 'Artist', proposedBy: 'Host' });
  await RoomService.advanceMusicQueue(room.roomId);
  const emit = vi.fn();
  const req: any = {
    params: { roomId: room.roomId }, headers: { 'x-leader-secret': leaderSecret },
    body: { url: 'https://youtu.be/PW6ZSzdjrlo', startTime: 42, transferMusic: true },
    app: { get: () => ({ to: () => ({ emit }) }) },
  };
  const response = mockRes();
  await RoomController.setVideoUrl(req, response, next);
  expect(response.body.video.startTime).toBe(42);
  expect((await RoomService.getRoomById(room.roomId))?.musicNowPlaying).toBeNull();
  expect(emit).toHaveBeenCalledWith('music-queue-updated', expect.objectContaining({ nowPlaying: null }));
  const denied = mockRes();
  await RoomController.clearVideo({ ...req, headers: {} }, denied, next);
  expect(denied.statusCode).toBe(403);
  await RoomController.clearVideo(req, mockRes(), next);
  const cleared = await RoomService.getRoomById(room.roomId);
  expect(cleared?.video).toBeUndefined();
  expect(cleared?.status).toBe('waiting');
});

beforeAll(() => {
  backupRoomsFile();
});

afterEach(async () => {
  while (created.length > 0) {
    const id = created.pop()!;
    await RoomService.deleteRoom(id, true).catch(() => false);
  }
});

afterAll(async () => {
  await restoreRoomsFile();
});

describe('RoomController.create: validaciones', () => {
  it.each([[undefined], [''], ['   '], [123]])(
    'responde 400 cuando leaderName es inválido (%s)',
    async (leaderName) => {
      const req: any = { body: { leaderName } };
      const res = mockRes();
      await RoomController.create(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body).toMatchObject({ error: 'leaderName is required' });
    }
  );

  it('crea la sala y responde 201', async () => {
    const req: any = { body: { leaderName: 'Anfitriona', isTemporary: false } };
    const res = mockRes();
    await RoomController.create(req, res, next);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body.roomId).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6,8}$/);
    expect(res.body.isTemporary).toBe(false);
    created.push(res.body.roomId);
  });

  it('rechaza una configuración mixta que no sea booleana', async () => {
    const req: any = { body: { leaderName: 'Anfitriona', hostOnlySync: 'sí' } };
    const res = mockRes();
    await RoomController.create(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toMatchObject({ error: 'hostOnlySync must be a boolean' });
  });
});

describe('RoomController.join: validaciones y puerta de aprobación', () => {
  it('responde 400 sin userName', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'H' });
    created.push(room.roomId);
    const req: any = { params: { roomId: room.roomId }, body: {} };
    const res = mockRes();
    await RoomController.join(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('responde 404 ante sala inexistente', async () => {
    const req: any = { params: { roomId: 'ZZZZZZ' }, body: { userName: 'X' } };
    const res = mockRes();
    await RoomController.join(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('con requireApproval, el invitado NO entra a participantes (pendingApproval)', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'H' });
    created.push(room.roomId);
    await RoomService.updateSettings(room.roomId, { requireApproval: true });

    const req: any = { params: { roomId: room.roomId }, body: { userName: 'Invitado' } };
    const res = mockRes();
    await RoomController.join(req, res, next);
    expect(res.body.pendingApproval).toBe(true);

    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.participants.some((p) => p.name === 'Invitado')).toBe(false);
  });

  it('con requireApproval, el leader sí entra sin puerta', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'ElHost' });
    created.push(room.roomId);
    await RoomService.updateSettings(room.roomId, { requireApproval: true });

    const req: any = { params: { roomId: room.roomId }, body: { userName: 'elhost' } };
    const res = mockRes();
    await RoomController.join(req, res, next);
    expect(res.body.pendingApproval).toBeUndefined();
  });
});

describe('RoomController.getById', () => {
  it('responde 404 ante sala inexistente y 200 con datos públicos', async () => {
    const missing: any = { params: { roomId: 'ZZZZZZ' } };
    const resMissing = mockRes();
    await RoomController.getById(missing, resMissing, next);
    expect(resMissing.status).toHaveBeenCalledWith(404);

    const { room } = await RoomService.createRoom({ leaderName: 'H' });
    created.push(room.roomId);
    const req: any = { params: { roomId: room.roomId } };
    const res = mockRes();
    await RoomController.getById(req, res, next);
    expect(res.body.roomId).toBe(room.roomId);
    // Nunca exponer el secreto del leader por GET público
    expect(res.body.leaderSecret).toBeUndefined();
  });
});
