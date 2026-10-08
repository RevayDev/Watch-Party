import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveRoomTime,
  resolveSyncedPlayback,
  setPlaybackSnapshot,
  roomPositions,
  roomPlayback,
  POSITION_TTL_MS,
  type PositionReport,
} from '../src/domain/playback-policy.js';
import {
  SyncPlaybackUseCase,
  RecordHeartbeatUseCase,
  ResolveSyncTimeUseCase,
} from '../src/application/sync-playback.usecase.js';

const ROOM = 'TEST01';

interface ReportInput {
  socketId: string;
  userName: string;
  userId?: string;
  currentTime: number;
  isPlaying: boolean;
  /** Antigüedad simulada del reporte en ms (por defecto 0 = recién llegado) */
  ageMs?: number;
}

/** Inyecta reportes directamente en el mapa exportado (código real, sin seams). */
function setPositions(roomId: string, reports: ReportInput[]): void {
  const now = Date.now();
  const bySocket = new Map<string, PositionReport>();
  for (const r of reports) {
    bySocket.set(r.socketId, {
      socketId: r.socketId,
      userName: r.userName,
      userId: r.userId,
      currentTime: r.currentTime,
      isPlaying: r.isPlaying,
      updatedAt: now - (r.ageMs ?? 0),
    });
  }
  roomPositions.set(roomId.toUpperCase().trim(), bySocket);
}

function participants() {
  return [
    { userId: 'u-senior', name: 'Senior', joinedAt: new Date('2024-01-01T10:00:00Z') },
    { userId: 'u-mid', name: 'Mid', joinedAt: new Date('2024-01-01T11:00:00Z') },
    { userId: 'u-junior', name: 'Junior', joinedAt: new Date('2024-01-01T12:00:00Z') },
  ];
}

beforeEach(() => {
  roomPositions.clear();
  roomPlayback.clear();
});

describe('resolveRoomTime: fallback sin reportes', () => {
  it('devuelve null cuando nadie ha reportado posición', () => {
    expect(resolveRoomTime(ROOM, participants())).toBeNull();
  });

  it('ignora reportes caducados (TTL) y devuelve null', () => {
    setPositions(ROOM, [
      {
        socketId: 's1',
        userName: 'Senior',
        userId: 'u-senior',
        currentTime: 42,
        isPlaying: true,
        ageMs: POSITION_TTL_MS + 1000,
      },
    ]);
    expect(resolveRoomTime(ROOM, participants())).toBeNull();
  });

  it('ignora valores no finitos o negativos', () => {
    setPositions(ROOM, [
      { socketId: 's1', userName: 'Senior', currentTime: NaN, isPlaying: true },
      { socketId: 's2', userName: 'Mid', currentTime: -5, isPlaying: true },
      { socketId: 's3', userName: 'Junior', currentTime: Infinity, isPlaying: true },
    ]);
    expect(resolveRoomTime(ROOM, participants())).toBeNull();
  });
});

describe('resolveRoomTime: cluster y mediana', () => {
  it('un solo reporte se adopta tal cual', () => {
    setPositions(ROOM, [
      { socketId: 's1', userName: 'Senior', userId: 'u-senior', currentTime: 77.5, isPlaying: true },
    ]);
    expect(resolveRoomTime(ROOM, participants())).toEqual({ currentTime: 77.5, isPlaying: true });
  });

  it('el cluster mayoritario gana y se usa su mediana', () => {
    setPositions(ROOM, [
      { socketId: 's1', userName: 'Senior', userId: 'u-senior', currentTime: 100, isPlaying: true },
      { socketId: 's2', userName: 'Mid', userId: 'u-mid', currentTime: 101, isPlaying: true },
      { socketId: 's3', userName: 'Junior', userId: 'u-junior', currentTime: 102, isPlaying: true },
      { socketId: 's4', userName: 'Extra', currentTime: 200, isPlaying: true },
    ]);
    expect(resolveRoomTime(ROOM, participants())).toEqual({ currentTime: 101, isPlaying: true });
  });

  it('con cluster par, la mediana es el elemento central superior', () => {
    setPositions(ROOM, [
      { socketId: 's1', userName: 'A', currentTime: 100, isPlaying: false },
      { socketId: 's2', userName: 'B', currentTime: 100.5, isPlaying: false },
      { socketId: 's3', userName: 'C', currentTime: 101, isPlaying: false },
      { socketId: 's4', userName: 'D', currentTime: 101.5, isPlaying: false },
    ]);
    // times ordenados [100,100.5,101,101.5] -> mediana times[floor(4/2)] = 101
    expect(resolveRoomTime(ROOM, participants())).toEqual({ currentTime: 101, isPlaying: false });
  });

  it('el subgrupo más numeroso gana aunque no sea el primero', () => {
    setPositions(ROOM, [
      { socketId: 's1', userName: 'A', currentTime: 10, isPlaying: true },
      { socketId: 's2', userName: 'B', currentTime: 11, isPlaying: true },
      { socketId: 's3', userName: 'C', currentTime: 50, isPlaying: false },
      { socketId: 's4', userName: 'D', currentTime: 51, isPlaying: false },
      { socketId: 's5', userName: 'E', currentTime: 52, isPlaying: false },
    ]);
    expect(resolveRoomTime(ROOM, participants())).toEqual({ currentTime: 51, isPlaying: false });
  });

  it('reportes a exactamente la tolerancia (2s) siguen en el mismo cluster', () => {
    setPositions(ROOM, [
      { socketId: 's1', userName: 'A', currentTime: 100, isPlaying: true },
      { socketId: 's2', userName: 'B', currentTime: 102, isPlaying: true },
    ]);
    expect(resolveRoomTime(ROOM, participants())).toEqual({ currentTime: 102, isPlaying: true });
  });

  it('reportes fuera de tolerancia forman clusters separados (decide seniority)', () => {
    setPositions(ROOM, [
      { socketId: 's1', userName: 'A', currentTime: 100, isPlaying: true },
      { socketId: 's2', userName: 'B', currentTime: 102.5, isPlaying: true },
    ]);
    const res = resolveRoomTime(ROOM, []);
    expect(res).not.toBeNull();
    expect([100, 102.5]).toContain(res!.currentTime);
  });
});

describe('resolveRoomTime: seniority ante desacuerdo', () => {
  it('sin mayoría, gana el miembro con más antigüedad (por userId)', () => {
    setPositions(ROOM, [
      { socketId: 's-junior', userName: 'Junior', userId: 'u-junior', currentTime: 10, isPlaying: true },
      { socketId: 's-senior', userName: 'Senior', userId: 'u-senior', currentTime: 90, isPlaying: false },
    ]);
    expect(resolveRoomTime(ROOM, participants())).toEqual({ currentTime: 90, isPlaying: false });
  });

  it('seniority también funciona con coincidencia legacy por nombre', () => {
    setPositions(ROOM, [
      { socketId: 's1', userName: 'Junior', currentTime: 10, isPlaying: true },
      { socketId: 's2', userName: 'Senior', currentTime: 90, isPlaying: false },
    ]);
    expect(resolveRoomTime(ROOM, participants())).toEqual({ currentTime: 90, isPlaying: false });
  });

  it('isPlaying se vota por mayoría del cluster ganador', () => {
    const base: ReportInput[] = [
      { socketId: 's1', userName: 'A', currentTime: 100, isPlaying: true },
      { socketId: 's2', userName: 'B', currentTime: 101, isPlaying: true },
      { socketId: 's3', userName: 'C', currentTime: 102, isPlaying: false },
    ];
    setPositions(ROOM, base);
    expect(resolveRoomTime(ROOM, [])?.isPlaying).toBe(true);

    setPositions(ROOM, base.map((r) => ({ ...r, isPlaying: !r.isPlaying })));
    expect(resolveRoomTime(ROOM, [])?.isPlaying).toBe(false);
  });

  it('empate 1-1 en isPlaying se resuelve como playing (votos*2 >= n)', () => {
    setPositions(ROOM, [
      { socketId: 's1', userName: 'A', currentTime: 100, isPlaying: true },
      { socketId: 's2', userName: 'B', currentTime: 101, isPlaying: false },
    ]);
    expect(resolveRoomTime(ROOM, [])).toEqual({ currentTime: 101, isPlaying: true });
  });

  it('los reportes caducados no participan en el cluster', () => {
    setPositions(ROOM, [
      { socketId: 's1', userName: 'A', currentTime: 500, isPlaying: true, ageMs: 60_000 },
      { socketId: 's2', userName: 'B', currentTime: 60, isPlaying: false },
    ]);
    expect(resolveRoomTime(ROOM, [])).toEqual({ currentTime: 60, isPlaying: false });
  });
});

describe('resolveSyncedPlayback: consenso primero, snapshot como fallback', () => {
  it('prefiere el consenso de miembros sobre el snapshot', () => {
    setPlaybackSnapshot(ROOM, 10, false);
    setPositions(ROOM, [
      { socketId: 's1', userName: 'A', currentTime: 88, isPlaying: true },
      { socketId: 's2', userName: 'B', currentTime: 89, isPlaying: true },
    ]);
    expect(resolveSyncedPlayback(ROOM, [])).toEqual({ currentTime: 89, isPlaying: true });
  });

  it('sin consenso usa el snapshot y compensa el tiempo transcurrido si estaba en play', () => {
    setPlaybackSnapshot(ROOM, 100, true);
    // Simular 5s de reproducción desde el snapshot
    const entry = roomPlayback.get(ROOM)!;
    entry.updatedAt = Date.now() - 5000;
    const res = resolveSyncedPlayback(ROOM, []);
    expect(res?.isPlaying).toBe(true);
    expect(res!.currentTime).toBeGreaterThanOrEqual(104.5);
    expect(res!.currentTime).toBeLessThan(107);
  });

  it('con snapshot en pausa no compensa tiempo', () => {
    setPlaybackSnapshot(ROOM, 100, false);
    const entry = roomPlayback.get(ROOM)!;
    entry.updatedAt = Date.now() - 5000;
    expect(resolveSyncedPlayback(ROOM, [])).toEqual({ currentTime: 100, isPlaying: false });
  });

  it('devuelve null sin consenso ni snapshot', () => {
    expect(resolveSyncedPlayback(ROOM, [])).toBeNull();
  });
});

describe('SyncPlaybackUseCase / RecordHeartbeatUseCase', () => {
  it('play guarda snapshot playing y devuelve payload con sentAt', () => {
    const before = Date.now();
    const payload = SyncPlaybackUseCase.execute({ roomId: ROOM, action: 'play', currentTime: 12.5 });
    expect(payload).toMatchObject({ action: 'play', currentTime: 12.5 });
    expect(payload.sentAt).toBeGreaterThanOrEqual(before);
    expect(roomPlayback.get(ROOM)).toMatchObject({ currentTime: 12.5, isPlaying: true });
  });

  it('seek conserva el estado previo del snapshot (no lo marca pausado)', () => {
    // Corregido 2026-10-04: SyncPlaybackUseCase preserva isPlaying en seek.
    SyncPlaybackUseCase.execute({ roomId: ROOM, action: 'play', currentTime: 50 });
    SyncPlaybackUseCase.execute({ roomId: ROOM, action: 'seek', currentTime: 60 });
    expect(roomPlayback.get(ROOM)).toMatchObject({ currentTime: 60, isPlaying: true });
  });

  it('heartbeat válido de un miembro se registra y alimenta el consenso', () => {
    const ok = RecordHeartbeatUseCase.execute({
      roomId: ROOM,
      socketId: 's1',
      userName: 'Ana',
      currentTime: 33,
      isPlaying: true,
      isMember: true,
    });
    expect(ok).toBe(true);
    expect(ResolveSyncTimeUseCase.execute(ROOM, [])).toEqual({ currentTime: 33, isPlaying: true });
  });

  it.each([
    ['tiempo negativo', { currentTime: -1, isMember: true }],
    ['NaN', { currentTime: NaN, isMember: true }],
    ['no miembro (pending)', { currentTime: 10, isMember: false }],
  ])('heartbeat rechazado: %s', (_label, extra) => {
    const ok = RecordHeartbeatUseCase.execute({
      roomId: ROOM,
      socketId: 's1',
      userName: 'Ana',
      currentTime: 10,
      isPlaying: true,
      isMember: true,
      ...extra,
    });
    expect(ok).toBe(false);
    expect(resolveRoomTime(ROOM, [])).toBeNull();
  });
});
