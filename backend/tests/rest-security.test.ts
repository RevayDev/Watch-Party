import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { RoomController } from '../src/controllers/room.controller.js';
import { RoomService } from '../src/services/room.service.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

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

function mockReq(params: any = {}, body: any = {}, headers: any = {}, extra: any = {}) {
  return { params, body, headers, ...extra };
}

const next = vi.fn();

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

describe('REST join: baneo (403) y colisión de nombres (409)', () => {
  it('403 si el usuario está baneado (espejo del socket)', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Troll', 'Web', 'u-troll');
    await RoomService.kickParticipant(room.roomId, { name: 'Troll', userId: 'u-troll' }, 'Host', true);

    const res = mockRes();
    await RoomController.join(
      mockReq({ roomId: room.roomId }, { userName: 'Troll', userId: 'u-troll' }),
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('403 por baneo también coincide por nombre legacy', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Pesado', 'Web');
    await RoomService.kickParticipant(room.roomId, { name: 'Pesado' }, 'Host', true);

    const res = mockRes();
    await RoomController.join(mockReq({ roomId: room.roomId }, { userName: 'pesado' }), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('409 si el nombre lo usa otra identidad', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Ana', 'Web', 'u-ana');

    const res = mockRes();
    await RoomController.join(
      mockReq({ roomId: room.roomId }, { userName: 'ana', userId: 'u-otro' }),
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body.error).toContain('ana');
  });

  it('rejoin con el mismo userId siempre permitido (200)', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Ana', 'Web', 'u-ana');

    const res = mockRes();
    await RoomController.join(
      mockReq({ roomId: room.roomId }, { userName: 'OtroNombre', userId: 'u-ana' }),
      res,
      next
    );
    expect(res.statusCode).toBe(200);
    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.participants.filter((p) => p.userId === 'u-ana')).toHaveLength(1);
  });
});

describe('REST privilegiado: solo host (403 sin secreto ni rol)', () => {
  it('DELETE sin auth → 403 y la sala sigue existiendo', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const res = mockRes();
    await RoomController.delete(mockReq({ roomId: room.roomId }, {}), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(await RoomService.getRoomById(room.roomId)).not.toBeNull();
  });

  it('DELETE con x-host-secret válido → 200', async () => {
    const { room, hostSecret } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const res = mockRes();
    await RoomController.delete(
      mockReq({ roomId: room.roomId }, {}, { 'x-host-secret': hostSecret }),
      res,
      next
    );
    expect(res.statusCode).toBe(200);
    expect(await RoomService.getRoomById(room.roomId)).toBeNull();
    created.pop();
  });

  it('DELETE con x-user-id del host (rol del servidor) → 200', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Host', 'Web', 'u-host');

    const res = mockRes();
    await RoomController.delete(
      mockReq({ roomId: room.roomId }, {}, { 'x-user-id': 'u-host' }),
      res,
      next
    );
    expect(res.statusCode).toBe(200);
    created.pop();
  });

  it('DELETE con x-user-id de miembro → 403', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);
    await RoomService.joinRoom(room.roomId, 'Miembro', 'Web', 'u-mem');

    const res = mockRes();
    await RoomController.delete(
      mockReq({ roomId: room.roomId }, {}, { 'x-user-id': 'u-mem' }),
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('POST video-url sin auth → 403 sin tocar la red (antes del probe)', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const res = mockRes();
    await RoomController.setVideoUrl(
      mockReq({ roomId: room.roomId }, { url: 'https://example.com/video.mp4' }),
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('POST video (upload) sin auth → 403', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const res = mockRes();
    await RoomController.uploadVideo(
      mockReq({ roomId: room.roomId }, {}, {}, { file: { filename: 'fake.mp4' } as any }),
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('REST PATCH settings: 403 / 400 / 200', () => {
  it('sin auth → 403', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const res = mockRes();
    await RoomController.updateSettings(
      mockReq({ roomId: room.roomId }, { settings: { muteOnEntry: true } }),
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('ajustes inválidos → 400 con mensaje claro y sin aplicar nada', async () => {
    const { room, hostSecret } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const res = mockRes();
    await RoomController.updateSettings(
      mockReq(
        { roomId: room.roomId },
        { settings: { muteOnEntry: 'yes', extra: 1 } },
        { 'x-host-secret': hostSecret }
      ),
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error).toContain('muteOnEntry');

    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.settings?.muteOnEntry).toBe(false);
  });

  it('ajustes válidos con secreto → 200 y se fusionan', async () => {
    const { room, hostSecret } = await RoomService.createRoom({ hostName: 'Host' });
    created.push(room.roomId);

    const res = mockRes();
    await RoomController.updateSettings(
      mockReq(
        { roomId: room.roomId },
        { settings: { muteOnEntry: true, requireApproval: true } },
        { 'x-host-secret': hostSecret }
      ),
      res,
      next
    );
    expect(res.statusCode).toBe(200);
    const stored = await RoomService.getRoomById(room.roomId);
    expect(stored?.settings).toMatchObject({ muteOnEntry: true, requireApproval: true });
  });
});
