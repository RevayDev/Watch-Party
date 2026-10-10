import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server as IOServer, Socket } from 'socket.io';
import { registerMusicQueueHandlers } from '../src/sockets/handlers/music-queue.handler.js';
import { RoomService } from '../src/services/room.service.js';
import { activeUsers, type SocketUser } from '../src/sockets/socket-state.js';
import { __resetSocketLimitsForTests } from '../src/sockets/socket-limits.js';
import { setDemoModeOverride, resetDemoModeCache } from '../src/config/demo-mode.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

/**
 * music-queue.handler: identidad servidor, gates de settings, rate-limit y
 * aislamiento entre salas. io mockeado (capta los emits por sala).
 */

const TRACK = { id: '4uLU6hMCjMI75M1A2tKUQ', name: 'Tema', artists: 'Artista' };

interface EmitRecord {
  room: string;
  event: string;
  payload: unknown;
}

function makeIo() {
  const emitted: EmitRecord[] = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
  } as unknown as IOServer;
  return { io, emitted };
}

function admit(socketId: string, roomId: string, name: string, userId?: string): void {
  const user: SocketUser = { socketId, roomId, userName: name, isLeader: false };
  if (userId) user.userId = userId;
  activeUsers.set(socketId, user);
}

async function queuePayload(
  emitted: EmitRecord[],
  roomId: string
): Promise<{ queue: Array<Record<string, unknown>>; nowPlaying: unknown } | null> {
  const last = [...emitted]
    .reverse()
    .find((e) => e.room === roomId && e.event === 'music-queue-updated');
  if (!last) return null;
  return last.payload as { queue: Array<Record<string, unknown>>; nowPlaying: unknown };
}

let roomId: string;

beforeEach(async () => {
  backupRoomsFile();
  setDemoModeOverride(false);
  __resetSocketLimitsForTests();
  const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
  roomId = room.roomId;
});

afterEach(async () => {
  const rooms = await RoomService.listRooms();
  for (const r of rooms) {
    await RoomService.deleteRoom(r.roomId, true).catch(() => false);
  }
  setDemoModeOverride(undefined);
  resetDemoModeCache();
  await restoreRoomsFile();
  activeUsers.clear();
});

describe('music-queue.handler', () => {
  it('un no-miembro es ignorado en silencio', async () => {
    // Socket admitido en OTRA sala (no en roomId): el handler lo ignora.
    const registered = new Map<string, (data: unknown) => void>();
    const socket = {
      id: 's1',
      on: (event: string, cb: (data: unknown) => void) => {
        registered.set(event, cb);
      },
      emit: () => {},
    } as unknown as Socket;
    const { io, emitted } = makeIo();
    registerMusicQueueHandlers(io, socket);
    admit('s1', 'OTRA', 'Fantasma');
    await registered.get('music-add')?.({ roomId, track: TRACK });
    expect(emitted).toHaveLength(0);
  });

  it('musicEnabled=false deniega vía action-denied', async () => {
    const registered = new Map<string, (data: unknown) => void>();
    const denied: Array<{ event: string; message: string }> = [];
    const socket = {
      id: 's1',
      on: (event: string, cb: (data: unknown) => void) => registered.set(event, cb),
      emit: (event: string, payload: unknown) => {
        if (event === 'action-denied') denied.push(payload as { event: string; message: string });
      },
    } as unknown as Socket;
    const { io } = makeIo();
    registerMusicQueueHandlers(io, socket);
    admit('s1', roomId, 'Ana', 'u-1');
    await registered.get('music-add')?.({ roomId, track: TRACK });
    expect(denied).toHaveLength(1);
    expect(denied[0].event).toBe('music-add');
  });

  it('add encola y difunde a su sala; otra sala no lo recibe', async () => {
    const { room: other } = await RoomService.createRoom({ leaderName: 'O', isTemporary: true });
    await RoomService.updateSettings(roomId, { musicEnabled: true });
    const registered = new Map<string, (data: unknown) => void>();
    const socket = {
      id: 's1',
      on: (event: string, cb: (data: unknown) => void) => registered.set(event, cb),
    } as unknown as Socket;
    const { io, emitted } = makeIo();
    registerMusicQueueHandlers(io, socket);
    admit('s1', roomId, 'Ana', 'u-1');
    await registered.get('music-add')?.({ roomId, track: TRACK });
    const mine = await queuePayload(emitted, roomId);
    expect(mine?.queue).toHaveLength(1);
    expect(emitted.every((e) => e.room !== other.roomId)).toBe(true);
  });

  it("musicCanAdd='moderator' deniega a un miembro común", async () => {
    await RoomService.updateSettings(roomId, { musicEnabled: true, musicCanAdd: 'moderator' });
    const registered = new Map<string, (data: unknown) => void>();
    const denied: string[] = [];
    const socket = {
      id: 's1',
      on: (event: string, cb: (data: unknown) => void) => registered.set(event, cb),
      emit: (event: string, payload: unknown) => {
        if (event === 'action-denied') denied.push((payload as { event: string }).event);
      },
    } as unknown as Socket;
    const { io } = makeIo();
    registerMusicQueueHandlers(io, socket);
    admit('s1', roomId, 'Miembro', 'u-2');
    await registered.get('music-add')?.({ roomId, track: TRACK });
    expect(denied).toContain('music-add');
  });

  it('rate-limit: el excedente de music-add se ignora', async () => {
    await RoomService.updateSettings(roomId, { musicEnabled: true });
    const registered = new Map<string, (data: unknown) => void>();
    const socket = {
      id: 's1',
      on: (event: string, cb: (data: unknown) => void) => registered.set(event, cb),
    } as unknown as Socket;
    const { io, emitted } = makeIo();
    registerMusicQueueHandlers(io, socket);
    admit('s1', roomId, 'Ana', 'u-1');
    // 12 permitidos por minuto: manda 20 temas DISTINTOS (sin dedup).
    for (let i = 0; i < 20; i++) {
      await registered.get('music-add')?.({
        roomId,
        track: { ...TRACK, id: `track${String(i).padStart(6, '0')}` },
      });
    }
    const payload = await queuePayload(emitted, roomId);
    expect(payload?.queue.length).toBeLessThanOrEqual(12);
  });

  it('music-next emite music-queue-updated y video-changed', async () => {
    await RoomService.updateSettings(roomId, { musicEnabled: true });
    await RoomService.addMusicEntry(roomId, {
      trackId: TRACK.id,
      name: TRACK.name,
      artists: TRACK.artists,
      proposedBy: 'Ana',
    });
    const registered = new Map<string, (data: unknown) => void>();
    const socket = {
      id: 's1',
      on: (event: string, cb: (data: unknown) => void) => registered.set(event, cb),
    } as unknown as Socket;
    const { io, emitted } = makeIo();
    registerMusicQueueHandlers(io, socket);
    admit('s1', roomId, 'L', 'leader-1');
    // El creador es leader en el store: requireModerator pasa.
    const room = await RoomService.getRoomById(roomId);
    const leader = room?.participants[0];
    if (leader) leader.userId = 'leader-1';
    await RoomService.save ? undefined : undefined;
    const saved = await (RoomService as unknown as { 
      // save no es público: usar updateSettings para persistir el userId
    }).constructor;
    void saved;
    // Persistir el userId del leader vía rename (simplemente reclamamos con secret).
    // Más simple: usar leaderSecret como claim.
    const secret = (await RoomService.getRoomById(roomId))!.leaderSecret;
    await registered.get('music-next')?.({
      roomId,
      leaderSecret: secret,
      requesterName: 'L',
    });
    const update = emitted.find((e) => e.event === 'music-queue-updated');
    const video = emitted.find((e) => e.event === 'video-changed');
    expect(update).toBeDefined();
    expect(video).toBeDefined();
    expect((video!.payload as { video: { sourceType: string } }).video.sourceType).toBe('spotify');
  });
});
