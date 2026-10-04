import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getRecentRooms,
  saveRecentRoom,
  updateRecentRoomMeta,
  removeRecentRoom,
  getLastUsername,
} from '../src/services/recentRooms';

function installStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const api = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    _dump: () => Object.fromEntries(store),
  };
  vi.stubGlobal('localStorage', api);
  return api;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  installStorage();
});

describe('getRecentRooms', () => {
  it('devuelve [] cuando no hay nada guardado', () => {
    expect(getRecentRooms()).toEqual([]);
  });

  it('devuelve [] ante JSON corrupto o forma inesperada', () => {
    installStorage({ watchparty_recent_rooms: 'no-json{{{' });
    expect(getRecentRooms()).toEqual([]);
    installStorage({ watchparty_recent_rooms: JSON.stringify({ roomId: 'X' }) });
    expect(getRecentRooms()).toEqual([]);
  });

  it('filtra entradas sin roomId válido', () => {
    installStorage({
      watchparty_recent_rooms: JSON.stringify([{ foo: 1 }, { roomId: 'ABC123', hostName: 'H', role: 'guest', lastJoined: 1 }]),
    });
    expect(getRecentRooms()).toHaveLength(1);
  });

  it('devuelve [] si localStorage no está disponible', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getRecentRooms()).toEqual([]);
  });
});

describe('saveRecentRoom', () => {
  it('normaliza el roomId a mayúsculas y lo pone primero', () => {
    saveRecentRoom('ab12cd', 'Ana', 'guest');
    saveRecentRoom('ef34gh', 'Beto', 'host');
    const list = getRecentRooms();
    expect(list.map((r) => r.roomId)).toEqual(['EF34GH', 'AB12CD']);
    expect(list[0]).toMatchObject({ hostName: 'Beto', role: 'host' });
    expect(list[0].lastJoined).toEqual(expect.any(Number));
  });

  it('re-guardar una sala existente la mueve al frente sin duplicar', () => {
    saveRecentRoom('AAA111', 'A', 'guest');
    saveRecentRoom('BBB222', 'B', 'guest');
    saveRecentRoom('aaa111', 'A', 'guest');
    const list = getRecentRooms();
    expect(list.map((r) => r.roomId)).toEqual(['AAA111', 'BBB222']);
  });

  it('conserva roomName/roomDescription al re-guardar', () => {
    saveRecentRoom('AAA111', 'A', 'guest');
    updateRecentRoomMeta('AAA111', { roomName: 'Noche de cine' });
    saveRecentRoom('AAA111', 'A', 'guest');
    expect(getRecentRooms()[0]).toMatchObject({ roomName: 'Noche de cine' });
  });

  it('limita el historial a 8 entradas', () => {
    for (let i = 0; i < 12; i++) saveRecentRoom(`ROOM${i}`, `H${i}`, 'guest');
    const list = getRecentRooms();
    expect(list).toHaveLength(8);
    expect(list[0].roomId).toBe('ROOM11');
  });

  it('guarda el último nombre de usuario (trim)', () => {
    saveRecentRoom('AAA111', '  Carlos  ', 'guest');
    expect(getLastUsername()).toBe('Carlos');
  });

  it('no rompe si el storage lanza (cuota llena)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {},
      clear: () => {},
    });
    expect(() => saveRecentRoom('AAA111', 'A', 'guest')).not.toThrow();
  });
});

describe('updateRecentRoomMeta', () => {
  it('actualiza nombre/descripción con trim', () => {
    saveRecentRoom('AAA111', 'A', 'guest');
    updateRecentRoomMeta('aaa111', { roomName: '  Terror  ', roomDescription: '  Viernes  ' });
    expect(getRecentRooms()[0]).toMatchObject({ roomName: 'Terror', roomDescription: 'Viernes' });
  });

  it('ignora strings vacíos y no borra lo existente', () => {
    saveRecentRoom('AAA111', 'A', 'guest');
    updateRecentRoomMeta('AAA111', { roomName: 'Keep' });
    updateRecentRoomMeta('AAA111', { roomName: '   ', roomDescription: '' });
    expect(getRecentRooms()[0].roomName).toBe('Keep');
  });

  it('no hace nada si la sala no está en el historial', () => {
    saveRecentRoom('AAA111', 'A', 'guest');
    expect(() => updateRecentRoomMeta('ZZZ999', { roomName: 'X' })).not.toThrow();
    expect(getRecentRooms()).toHaveLength(1);
  });
});

describe('removeRecentRoom / getLastUsername', () => {
  it('elimina por roomId insensible a mayúsculas', () => {
    saveRecentRoom('AAA111', 'A', 'guest');
    saveRecentRoom('BBB222', 'B', 'guest');
    removeRecentRoom('aaa111');
    expect(getRecentRooms().map((r) => r.roomId)).toEqual(['BBB222']);
  });

  it('getLastUsername devuelve "" cuando no hay nada', () => {
    expect(getLastUsername()).toBe('');
  });
});
