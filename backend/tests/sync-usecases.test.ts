import { describe, it, expect, beforeEach } from 'vitest';
import {
  SyncPlaybackUseCase,
  RecordHeartbeatUseCase,
  ResolveSyncTimeUseCase,
} from '../src/application/sync-playback.usecase.js';
import { roomPlayback, roomPositions } from '../src/domain/playback-policy.js';

let n = 0;
function freshRoom(prefix: string): string {
  n += 1;
  return `${prefix}${n}${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
}

beforeEach(() => {
  roomPlayback.clear();
  roomPositions.clear();
});

describe('RecordHeartbeatUseCase: guards de entrada', () => {
  it('rechaza currentTime negativo', () => {
    const roomId = freshRoom('HB');
    const ok = RecordHeartbeatUseCase.execute({
      roomId,
      socketId: 's1',
      userName: 'Ana',
      currentTime: -5,
      isPlaying: true,
      isMember: true,
    });
    expect(ok).toBe(false);
    expect(ResolveSyncTimeUseCase.execute(roomId, [])).toBeNull();
  });

  it('rechaza currentTime NaN / no finito', () => {
    const roomId = freshRoom('HB');
    expect(
      RecordHeartbeatUseCase.execute({
        roomId,
        socketId: 's1',
        userName: 'Ana',
        currentTime: NaN,
        isPlaying: false,
        isMember: true,
      }),
    ).toBe(false);
  });

  it('rechaza heartbeats de no-miembros (pending / fuera de sala)', () => {
    const roomId = freshRoom('HB');
    const ok = RecordHeartbeatUseCase.execute({
      roomId,
      socketId: 's-pending',
      userName: 'Espera',
      currentTime: 12,
      isPlaying: true,
      isMember: false,
    });
    expect(ok).toBe(false);
    expect(ResolveSyncTimeUseCase.execute(roomId, [])).toBeNull();
  });

  it('rechaza roomId vacío', () => {
    expect(
      RecordHeartbeatUseCase.execute({
        roomId: '',
        socketId: 's1',
        userName: 'Ana',
        currentTime: 3,
        isPlaying: true,
        isMember: true,
      }),
    ).toBe(false);
  });

  it('acepta un miembro válido y alimenta el consenso (normaliza roomId)', () => {
    const roomId = freshRoom('hb');
    const ok = RecordHeartbeatUseCase.execute({
      roomId: roomId.toLowerCase(),
      socketId: 's1',
      userName: 'Ana',
      userId: 'u-ana',
      currentTime: 42,
      isPlaying: true,
      isMember: true,
    });
    expect(ok).toBe(true);
    const ref = ResolveSyncTimeUseCase.execute(roomId.toUpperCase(), [
      { userId: 'u-ana', name: 'Ana', joinedAt: new Date().toISOString() },
    ]);
    expect(ref).toMatchObject({ currentTime: 42, isPlaying: true });
  });
});

describe('SyncPlaybackUseCase: snapshot y payload', () => {
  it('devuelve payload play con sentAt y normaliza el roomId del snapshot', () => {
    const roomId = freshRoom('SP');
    const payload = SyncPlaybackUseCase.execute({
      roomId: roomId.toLowerCase(),
      action: 'play',
      currentTime: 10,
    });
    expect(payload).toMatchObject({ action: 'play', currentTime: 10 });
    expect(typeof payload.sentAt).toBe('number');
    // El snapshot queda disponible como fallback para recién llegados.
    // OJO: si isPlaying, el snapshot suma elapsed desde updatedAt → closeTo.
    const ref = ResolveSyncTimeUseCase.execute(roomId, []);
    expect(ref).not.toBeNull();
    expect(ref!.currentTime).toBeCloseTo(10, 0);
    expect(ref!.isPlaying).toBe(true);
  });

  it('pause guarda isPlaying=false en el snapshot', () => {
    const roomId = freshRoom('SP');
    SyncPlaybackUseCase.execute({ roomId, action: 'pause', currentTime: 25 });
    expect(ResolveSyncTimeUseCase.execute(roomId, [])).toMatchObject({
      currentTime: 25,
      isPlaying: false,
    });
  });

  it('el consenso de heartbeats tiene prioridad sobre el snapshot', () => {    const roomId = freshRoom('SP');
    SyncPlaybackUseCase.execute({ roomId, action: 'pause', currentTime: 5 });
    const stamp = new Date().toISOString();
    for (const [i, sid] of ['s-a', 's-b'].entries()) {
      RecordHeartbeatUseCase.execute({
        roomId,
        socketId: sid,
        userName: `M${i}`,
        currentTime: 100,
        isPlaying: true,
        isMember: true,
      });
    }
    const ref = ResolveSyncTimeUseCase.execute(roomId, [
      { name: 'M0', joinedAt: stamp },
      { name: 'M1', joinedAt: stamp },
    ]);
    expect(ref).toMatchObject({ currentTime: 100, isPlaying: true });
  });
  it('entradas inválidas devuelven null y no envenenan el snapshot', () => {
    const roomId = freshRoom('SP');
    expect(
      SyncPlaybackUseCase.execute({ roomId, action: 'play', currentTime: NaN })
    ).toBeNull();
    expect(
      SyncPlaybackUseCase.execute({ roomId, action: 'pause', currentTime: -5 })
    ).toBeNull();
    expect(
      SyncPlaybackUseCase.execute({
        roomId,
        action: 'bogus-action' as 'play',
        currentTime: 10,
      })
    ).toBeNull();
    expect(ResolveSyncTimeUseCase.execute(roomId, [])).toBeNull();
  });
});

describe('ResolveSyncTimeUseCase: lectura', () => {
  it('null cuando no hay snapshot ni heartbeats', () => {
    expect(ResolveSyncTimeUseCase.execute(freshRoom('SP'), [])).toBeNull();
  });
});
