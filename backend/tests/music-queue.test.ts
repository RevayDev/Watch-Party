import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RoomService } from '../src/services/room.service.js';
import { setDemoModeOverride, resetDemoModeCache } from '../src/config/demo-mode.js';
import type { IMusicQueueEntry } from '../src/types/room.types.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

/**
 * Cola musical compartida (RoomService): límites, duplicados, permisos,
 * modos fifo/votos y avance. Store en memoria (RoomService real).
 */

const TRACK = {
  trackId: '4uLU6hMCjMI75M1A2tKUQ',
  name: 'Canción',
  artists: 'Artista',
};

function entryOf(
  over: Partial<Parameters<typeof RoomService.addMusicEntry>[1]> = {}
): Parameters<typeof RoomService.addMusicEntry>[1] {
  return { ...TRACK, proposedBy: 'Ana', ...over } as Parameters<
    typeof RoomService.addMusicEntry
  >[1];
}

async function idsOf(roomId: string): Promise<string[]> {
  const room = await RoomService.getRoomById(roomId);
  return (room?.musicQueue ?? []).map((e) => e.id);
}

beforeEach(() => {
  backupRoomsFile();
  // Sin cuota demo: cada test crea/borra sus salas.
  setDemoModeOverride(false);
});

afterEach(async () => {
  const rooms = await RoomService.listRooms();
  for (const r of rooms) {
    await RoomService.deleteRoom(r.roomId, true).catch(() => false);
  }
  setDemoModeOverride(undefined);
  resetDemoModeCache();
  await restoreRoomsFile();
});

describe('RoomService.addMusicEntry', () => {
  it('encola un tema válido', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    const updated = await RoomService.addMusicEntry(room.roomId, entryOf());
    expect(updated?.musicQueue).toHaveLength(1);
    const e = updated!.musicQueue![0];
    expect(e.trackId).toBe(TRACK.trackId);
    expect(e.status).toBe('queued');
    expect(e.votes).toEqual([]);
    expect(e.id).toBeTruthy();
  });

  it('ignora duplicados (mismo trackId)', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    await RoomService.addMusicEntry(room.roomId, entryOf());
    const again = await RoomService.addMusicEntry(room.roomId, entryOf({ proposedBy: 'Beto' }));
    expect(again?.musicQueue).toHaveLength(1);
  });

  it('respeta el tope por usuario (musicMaxPerUser)', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    await RoomService.updateSettings(room.roomId, { musicMaxPerUser: 2 });
    for (const id of ['aaaaaaaaAA', 'bbbbbbbbBB', 'ccccccccCC']) {
      await RoomService.addMusicEntry(room.roomId, entryOf({ trackId: id, proposedBy: 'Ana' }));
    }
    const after = await RoomService.getRoomById(room.roomId);
    expect(after?.musicQueue).toHaveLength(2);
  });

  it('cuenta por userId (no por nombre) cuando hay identidad', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    await RoomService.updateSettings(room.roomId, { musicMaxPerUser: 1 });
    await RoomService.addMusicEntry(
      room.roomId,
      entryOf({ proposedBy: 'Ana', proposedByUserId: 'u-1' })
    );
    // Mismo userId con otro nombre visible: sigue siendo el mismo usuario.
    const blocked = await RoomService.addMusicEntry(
      room.roomId,
      entryOf({ trackId: 'bbbbbbbbBB', proposedBy: 'Otro', proposedByUserId: 'u-1' })
    );
    expect(blocked?.musicQueue).toHaveLength(1);
  });

  it('rechaza entradas inválidas (trackId corto, campos vacíos)', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    expect((await RoomService.addMusicEntry(room.roomId, entryOf({ trackId: 'corto' })))?.musicQueue).toHaveLength(0);
    expect((await RoomService.addMusicEntry(room.roomId, entryOf({ name: '  ' })))?.musicQueue).toHaveLength(0);
    expect((await RoomService.addMusicEntry(room.roomId, entryOf({ artists: '' })))?.musicQueue).toHaveLength(0);
  });

  it("status pending explícito se respeta (el handler lo decide por musicRequireApproval)", async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    const updated = await RoomService.addMusicEntry(room.roomId, entryOf({ status: 'pending' }));
    expect(updated?.musicQueue?.[0].status).toBe('pending');
  });

  it('10 adds concurrentes del mismo track → 1 entrada', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        RoomService.addMusicEntry(room.roomId, entryOf({ proposedBy: `U${Math.random()}` }))
      )
    );
    const after = await RoomService.getRoomById(room.roomId);
    expect(after?.musicQueue).toHaveLength(1);
  });
});

describe('RoomService.toggleMusicVote', () => {
  it('alterna el voto por identidad (userId o nombre)', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    await RoomService.updateSettings(room.roomId, { musicQueueMode: 'votes' });
    const updated = await RoomService.addMusicEntry(room.roomId, entryOf());
    const id = updated!.musicQueue![0].id;
    const voted = await RoomService.toggleMusicVote(room.roomId, id, { name: 'Beto' });
    expect(voted?.musicQueue?.[0].votes).toEqual(['beto']);
    const unvoted = await RoomService.toggleMusicVote(room.roomId, id, { name: 'beto' });
    expect(unvoted?.musicQueue?.[0].votes).toEqual([]);
    const byUser = await RoomService.toggleMusicVote(room.roomId, id, {
      userId: 'u-9',
      name: 'Cara',
    });
    expect(byUser?.musicQueue?.[0].votes).toEqual(['u-9']);
  });

  it('no vota entradas pendientes', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    const updated = await RoomService.addMusicEntry(room.roomId, entryOf({ status: 'pending' }));
    const id = updated!.musicQueue![0].id;
    const voted = await RoomService.toggleMusicVote(room.roomId, id, { name: 'Beto' });
    expect(voted?.musicQueue?.[0].votes).toEqual([]);
  });
});

describe('RoomService.removeMusicEntry', () => {
  async function roomWithEntry(mode?: 'proposer' | 'moderator') {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    if (mode) await RoomService.updateSettings(room.roomId, { musicCanRemove: mode });
    const updated = await RoomService.addMusicEntry(room.roomId, entryOf());
    return { roomId: room.roomId, entryId: updated!.musicQueue![0].id };
  }

  it('el proponente puede quitar su tema (default proposer)', async () => {
    const { roomId, entryId } = await roomWithEntry();
    const res = await RoomService.removeMusicEntry(roomId, entryId, {
      name: 'ana',
      isModerator: false,
    });
    expect(res?.musicQueue).toHaveLength(0);
  });

  it('otro usuario no puede quitar (default proposer)', async () => {
    const { roomId, entryId } = await roomWithEntry();
    const res = await RoomService.removeMusicEntry(roomId, entryId, {
      name: 'maloso',
      isModerator: false,
    });
    expect(res?.musicQueue).toHaveLength(1);
  });

  it("con musicCanRemove='moderator' ni el proponente puede", async () => {
    const { roomId, entryId } = await roomWithEntry('moderator');
    const res = await RoomService.removeMusicEntry(roomId, entryId, {
      name: 'Ana',
      isModerator: false,
    });
    expect(res?.musicQueue).toHaveLength(1);
  });

  it('el moderador siempre puede', async () => {
    const { roomId, entryId } = await roomWithEntry('moderator');
    const res = await RoomService.removeMusicEntry(roomId, entryId, {
      name: 'Cualquiera',
      isModerator: true,
    });
    expect(res?.musicQueue).toHaveLength(0);
  });
});

describe('RoomService.reorderMusicQueue', () => {
  async function roomWithQueue(): Promise<{ roomId: string; ids: string[] }> {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    await RoomService.updateSettings(room.roomId, { musicAllowReorder: true });
    for (const id of ['aaaaaaaaAA', 'bbbbbbbbBB', 'ccccccccCC']) {
      await RoomService.addMusicEntry(room.roomId, entryOf({ trackId: id }));
    }
    return { roomId: room.roomId, ids: await idsOf(room.roomId) };
  }

  it('reordena con moderador + musicAllowReorder', async () => {
    const { roomId, ids } = await roomWithQueue();
    const res = await RoomService.reorderMusicQueue(roomId, [ids[2], ids[0], ids[1]], true);
    expect((res?.musicQueue ?? []).map((e) => e.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('sin musicAllowReorder no reordena', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    await RoomService.addMusicEntry(room.roomId, entryOf());
    const ids = await idsOf(room.roomId);
    const res = await RoomService.reorderMusicQueue(room.roomId, [ids[0]], true);
    // No-op válido: la cola queda igual (el permiso falla silenciosamente).
    expect(res?.musicQueue).toHaveLength(1);
  });

  it('order con set distinto se ignora', async () => {
    const { roomId, ids } = await roomWithQueue();
    const res = await RoomService.reorderMusicQueue(roomId, [ids[0], ids[1]], true);
    expect((res?.musicQueue ?? []).map((e) => e.id)).toEqual(ids);
  });

  it('no moderador no reordena', async () => {
    const { roomId, ids } = await roomWithQueue();
    const res = await RoomService.reorderMusicQueue(roomId, [ids[1], ids[2], ids[0]], false);
    expect((res?.musicQueue ?? []).map((e) => e.id)).toEqual(ids);
  });
});

describe('RoomService.approveMusicEntry', () => {
  it('solo moderador aprueba pending→queued', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    const updated = await RoomService.addMusicEntry(room.roomId, entryOf({ status: 'pending' }));
    const id = updated!.musicQueue![0].id;
    const denied = await RoomService.approveMusicEntry(room.roomId, id, false);
    expect(denied?.musicQueue?.[0].status).toBe('pending');
    const ok = await RoomService.approveMusicEntry(room.roomId, id, true);
    expect(ok?.musicQueue?.[0].status).toBe('queued');
  });
});

describe('RoomService.advanceMusicQueue', () => {
  async function roomWithTwo(mode: 'fifo' | 'votes') {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    await RoomService.updateSettings(room.roomId, { musicQueueMode: mode });
    // Orden garantizado por createdAt (creciente por ejecución secuencial).
    const first = await RoomService.addMusicEntry(
      room.roomId,
      entryOf({ trackId: 'aaaaaaaaAA' })
    );
    await new Promise((r) => setTimeout(r, 5));
    await RoomService.addMusicEntry(room.roomId, entryOf({ trackId: 'bbbbbbbbBB' }));
    return { roomId: room.roomId, firstId: first!.musicQueue![0].id };
  }

  it('fifo avanza el más antiguo y fija video spotify', async () => {
    const { roomId, firstId } = await roomWithTwo('fifo');
    const res = await RoomService.advanceMusicQueue(roomId);
    expect(res?.musicNowPlaying?.entryId).toBe(firstId);
    expect(res?.musicNowPlaying?.startedBy).toBe('sala');
    expect(res?.video?.sourceType).toBe('spotify');
    expect(res?.video?.directUrl).toBe('https://open.spotify.com/embed/track/aaaaaaaaAA');
    expect(res?.musicQueue).toHaveLength(1);
  });

  it('votes avanza el más votado (empate: el más antiguo)', async () => {
    const { roomId } = await roomWithTwo('votes');
    const ids = await idsOf(roomId);
    // Voto al segundo: gana aunque sea más nuevo.
    await RoomService.toggleMusicVote(roomId, ids[1], { name: 'Beto' });
    const res = await RoomService.advanceMusicQueue(roomId);
    expect(res?.musicNowPlaying?.entryId).toBe(ids[1]);
  });

  it('cola vacía deja nowPlaying null', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    const res = await RoomService.advanceMusicQueue(room.roomId);
    expect(res?.musicNowPlaying ?? null).toBeNull();
  });
});

describe('RoomService.stopMusic', () => {
  it('limpia nowPlaying y el video solo si era spotify', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    await RoomService.addMusicEntry(room.roomId, entryOf());
    await RoomService.advanceMusicQueue(room.roomId);
    const stopped = await RoomService.stopMusic(room.roomId);
    expect(stopped?.musicNowPlaying ?? null).toBeNull();
    expect(stopped?.video ?? null).toBeNull();
  });

  it('no toca un video de archivo', async () => {
    const { room } = await RoomService.createRoom({ leaderName: 'L', isTemporary: true });
    await RoomService.updateRoomVideo(room.roomId, {
      originalName: 'película.mp4',
      fileName: 'pelicula.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 10,
      sourceType: 'file',
    });
    await RoomService.stopMusic(room.roomId);
    const after = await RoomService.getRoomById(room.roomId);
    expect(after?.video?.sourceType).toBe('file');
  });
});
