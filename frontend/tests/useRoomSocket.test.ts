// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { ApiService } from '../src/services/api';
import { getSocket, disconnectSocket } from '../src/services/socket';
import { useRoomSocket } from '../src/features/room/hooks/useRoomSocket';
import type { IRoomData } from '../src/types/room';

// useWebRTC se mockea con referencias ESTABLES: si cada render devolviera
// funciones nuevas, el efecto gigante del hook se re-suscribiría en bucle.
const { webRTCStubs } = vi.hoisted(() => ({
  webRTCStubs: {
    localStream: null,
    remotePeers: [],
    peerMediaStates: {},
    isMicOn: false,
    isCameraOn: false,
    mediaError: null,
    toggleMic: vi.fn(),
    toggleCamera: vi.fn(),
    enableMedia: vi.fn(),
  },
}));

vi.mock('../src/services/socket', () => ({
  getSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

vi.mock('../src/hooks/useWebRTC', () => ({
  useWebRTC: () => webRTCStubs,
}));

type SocketHandler = (data?: unknown) => void;

interface MockSocket {
  id: string;
  connected: boolean;
  on: Mock<(event: string, cb: SocketHandler) => void>;
  off: Mock<(event: string, cb?: SocketHandler) => void>;
  emit: Mock<(event: string, payload?: unknown) => void>;
  _fire: (event: string, data?: unknown) => void;
}

function createMockSocket(connected: boolean): MockSocket {
  const listeners = new Map<string, SocketHandler[]>();
  return {
    id: 'mock-socket-id',
    connected,
    on: vi.fn((event: string, cb: SocketHandler) => {
      const arr = listeners.get(event) ?? [];
      arr.push(cb);
      listeners.set(event, arr);
    }),
    off: vi.fn((event: string, cb?: SocketHandler) => {
      if (cb === undefined) {
        listeners.delete(event);
      } else {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((h) => h !== cb)
        );
      }
    }),
    emit: vi.fn((_event: string, _payload?: unknown) => undefined),
    _fire: (event: string, data?: unknown) => {
      for (const cb of listeners.get(event) ?? []) cb(data);
    },
  };
}

const mockRoom: IRoomData = {
  roomId: 'ABC123',
  hostName: 'Ana',
  status: 'active',
  participants: [],
  createdAt: new Date().toISOString(),
};

function setup(connected: boolean) {
  const mockSocket = createMockSocket(connected);
  vi.mocked(getSocket).mockReturnValue(mockSocket as unknown as Socket);
  vi.spyOn(ApiService, 'getRoom').mockResolvedValue(mockRoom);
  const onLeave = vi.fn();
  const hook = renderHook(() =>
    useRoomSocket({ roomId: 'ABC123', userName: 'Beto', initialIsHost: false, onLeave })
  );
  return { ...hook, mockSocket, onLeave };
}

// 'connect' se registra tras el `await getRoom`, así que esperar por él
// garantiza que loadRoom terminó y todas las suscripciones existen.
async function waitForSubscribed(mockSocket: MockSocket) {
  await waitFor(() => {
    expect(mockSocket.on).toHaveBeenCalledWith('room-state', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
  });
}

describe('useRoomSocket (eventos socket críticos)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registra los listeners socket críticos al montar', async () => {
    const { mockSocket } = setup(false);
    await waitForSubscribed(mockSocket);
    for (const event of [
      'room-state',
      'chat-message',
      'join-approved',
      'user-joined',
      'user-left',
      'video-changed',
      'sync-video',
    ]) {
      expect(mockSocket.on).toHaveBeenCalledWith(event, expect.any(Function));
    }
  });

  it('limpia todos los listeners (socket.off) al desmontar', async () => {
    const { mockSocket, unmount } = setup(false);
    await waitForSubscribed(mockSocket);
    unmount();
    const onEvents = mockSocket.on.mock.calls.map(([event]) => event);
    expect(onEvents.length).toBeGreaterThan(0);
    for (const event of onEvents) {
      expect(mockSocket.off).toHaveBeenCalledWith(event, expect.any(Function));
    }
  });

  it('emite join-room automáticamente si el socket ya está conectado', async () => {
    const { mockSocket } = setup(true);
    await waitFor(() => {
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'join-room',
        expect.objectContaining({ roomId: 'ABC123', userName: 'Beto' })
      );
    });
  });

  it('emite join-room cuando el socket se conecta (evento connect)', async () => {
    const { mockSocket } = setup(false);
    await waitForSubscribed(mockSocket);
    expect(mockSocket.emit).not.toHaveBeenCalledWith('join-room', expect.anything());
    act(() => {
      mockSocket._fire('connect');
    });
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'join-room',
      expect.objectContaining({ roomId: 'ABC123', userName: 'Beto' })
    );
  });

  it('room-state setea roomData y marca joined', async () => {
    const { mockSocket, result, onLeave } = setup(false);
    await waitFor(() => expect(result.current.roomData).not.toBeNull());
    expect(result.current.joined).toBe(false);
    const video = {
      originalName: 'noche.mp4',
      fileName: 'abc.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1000,
    };
    act(() => {
      mockSocket._fire('room-state', { video, participants: [], joinRequests: [] });
    });
    expect(result.current.joined).toBe(true);
    expect(result.current.roomData?.video).toMatchObject({ originalName: 'noche.mp4' });
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('chat-message agrega el mensaje e incrementa unread si el tab no es chat', async () => {
    const { mockSocket, result } = setup(false);
    await waitForSubscribed(mockSocket);
    act(() => {
      mockSocket._fire('chat-message', { id: 'm1', user: 'Ana', text: 'Hola!', timestamp: '12:00' });
    });
    expect(result.current.messages).toContainEqual(
      expect.objectContaining({ user: 'Ana', text: 'Hola!' })
    );
    expect(result.current.unreadCount).toBe(1);
  });

  it('chat-message no incrementa unread si el tab chat está abierto', async () => {
    const { mockSocket, result } = setup(false);
    await waitForSubscribed(mockSocket);
    act(() => {
      result.current.setActiveSideTab('chat');
    });
    act(() => {
      mockSocket._fire('chat-message', { id: 'm2', user: 'Ana', text: 'Hola de nuevo', timestamp: '12:01' });
    });
    expect(result.current.messages).toContainEqual(expect.objectContaining({ id: 'm2' }));
    expect(result.current.unreadCount).toBe(0);
  });

  it('join-approved re-emite join-room', async () => {
    const { mockSocket, onLeave } = setup(false);
    await waitForSubscribed(mockSocket);
    act(() => {
      mockSocket._fire('connect');
    });
    expect(mockSocket.emit).toHaveBeenCalledTimes(1);
    act(() => {
      mockSocket._fire('join-approved');
    });
    expect(mockSocket.emit).toHaveBeenCalledTimes(2);
    expect(mockSocket.emit).toHaveBeenNthCalledWith(
      2,
      'join-room',
      expect.objectContaining({ roomId: 'ABC123', userName: 'Beto' })
    );
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('join-pending marca awaitingApproval y bloquea joined', async () => {
    const { mockSocket, result, onLeave } = setup(false);
    await waitFor(() => expect(result.current.roomData).not.toBeNull());
    act(() => {
      mockSocket._fire('room-state', { video: null, participants: [], joinRequests: [] });
    });
    expect(result.current.joined).toBe(true);
    expect(result.current.awaitingApproval).toBe(false);
    act(() => {
      mockSocket._fire('join-pending');
    });
    expect(result.current.awaitingApproval).toBe(true);
    expect(result.current.joined).toBe(false);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('join-rejected limpia, notifica y sale (onLeave)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { mockSocket, result, onLeave } = setup(false);
    await waitForSubscribed(mockSocket);
    act(() => {
      mockSocket._fire('join-pending');
    });
    expect(result.current.awaitingApproval).toBe(true);
    localStorage.setItem(
      'watchparty_host_session',
      JSON.stringify({ roomId: 'ABC123', hostName: 'Beto', hostSecret: 's3cr3t' })
    );
    localStorage.setItem(
      'watchparty_recent_rooms',
      JSON.stringify([{ roomId: 'ABC123', hostName: 'Beto', role: 'guest', lastJoined: Date.now() }])
    );
    act(() => {
      mockSocket._fire('join-rejected', { reason: 'rejected', message: 'Sala llena' });
    });
    expect(result.current.awaitingApproval).toBe(false);
    expect(result.current.joined).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('[notify:warning]', 'Sala llena');
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('watchparty_host_session')).toBeNull();
    expect(JSON.parse(localStorage.getItem('watchparty_recent_rooms') ?? '[]')).toEqual([]);
  });

  it("join-rejected con reason 'name-taken' sigue el mismo flujo de error", async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { mockSocket, result, onLeave } = setup(false);
    await waitForSubscribed(mockSocket);
    localStorage.setItem(
      'watchparty_host_session',
      JSON.stringify({ roomId: 'ABC123', hostName: 'Beto' })
    );
    act(() => {
      mockSocket._fire('join-rejected', { reason: 'name-taken' });
    });
    expect(result.current.awaitingApproval).toBe(false);
    expect(result.current.joined).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('[notify:warning]', expect.stringContaining('ya está en uso'));
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('watchparty_host_session')).toBeNull();
  });

  it('user-kicked propio notifica y sale (onLeave)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { mockSocket, onLeave } = setup(false);
    await waitForSubscribed(mockSocket);
    localStorage.setItem(
      'watchparty_host_session',
      JSON.stringify({ roomId: 'ABC123', hostName: 'Beto' })
    );
    localStorage.setItem(
      'watchparty_recent_rooms',
      JSON.stringify([{ roomId: 'ABC123', hostName: 'Beto', role: 'guest', lastJoined: Date.now() }])
    );
    act(() => {
      mockSocket._fire('user-kicked', {
        targetUserName: 'Beto',
        kickedBy: 'Ana',
        banned: false,
        participants: [],
        kickedUsers: [],
      });
    });
    expect(logSpy).toHaveBeenCalledWith('[notify:error]', expect.stringContaining('expulsado'));
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('watchparty_host_session')).toBeNull();
    expect(JSON.parse(localStorage.getItem('watchparty_recent_rooms') ?? '[]')).toEqual([]);
  });

  it('room-closed limpia y sale (onLeave)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { mockSocket, onLeave } = setup(false);
    await waitForSubscribed(mockSocket);
    localStorage.setItem(
      'watchparty_host_session',
      JSON.stringify({ roomId: 'ABC123', hostName: 'Beto' })
    );
    localStorage.setItem(
      'watchparty_recent_rooms',
      JSON.stringify([{ roomId: 'ABC123', hostName: 'Beto', role: 'guest', lastJoined: Date.now() }])
    );
    act(() => {
      mockSocket._fire('room-closed', { message: 'La sala fue cerrada por el anfitrión' });
    });
    expect(logSpy).toHaveBeenCalledWith('[notify:error]', 'La sala fue cerrada por el anfitrión');
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('watchparty_host_session')).toBeNull();
    expect(JSON.parse(localStorage.getItem('watchparty_recent_rooms') ?? '[]')).toEqual([]);
  });

  it('toggle mic/cámara NO re-emite join-room ni recarga la sala (sin re-join)', async () => {
    const { mockSocket, rerender } = setup(true);
    await waitFor(() => {
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'join-room',
        expect.objectContaining({ roomId: 'ABC123', userName: 'Beto' })
      );
    });
    expect(mockSocket.emit).toHaveBeenCalledTimes(1);
    expect(ApiService.getRoom).toHaveBeenCalledTimes(1);

    // Simula lo que hace useWebRTC al togglear: cambian isMicOn/isCameraOn
    // (antes eran deps del efecto gigante → re-join + room-state → corte).
    webRTCStubs.isMicOn = true;
    webRTCStubs.isCameraOn = true;
    rerender();
    // Deja que los efectos post-rerender se asienten
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(mockSocket.emit).toHaveBeenCalledTimes(1);
    expect(ApiService.getRoom).toHaveBeenCalledTimes(1);
    webRTCStubs.isMicOn = false;
    webRTCStubs.isCameraOn = false;
  });

  it('room-state duplicado con mismo playback NO reaplica seek (sin corte)', async () => {
    const { mockSocket, result } = setup(false);
    await waitFor(() => expect(result.current.roomData).not.toBeNull());
    const video = { originalName: 'noche.mp4', fileName: 'abc.mp4', mimeType: 'video/mp4', sizeBytes: 1000 };
    act(() => {
      mockSocket._fire('room-state', {
        video,
        participants: [],
        joinRequests: [],
        playback: { currentTime: 42, isPlaying: false },
      });
    });
    const first = result.current.remoteAction;
    expect(first).toMatchObject({ currentTime: 42 });

    // Mismo consenso (p. ej. re-join tras togglear mic): no debe re-seekear
    act(() => {
      mockSocket._fire('room-state', {
        video: { ...video },
        participants: [],
        joinRequests: [],
        playback: { currentTime: 42.5, isPlaying: false },
      });
    });
    expect(result.current.remoteAction?.timestamp).toBe(first?.timestamp);

    // Salto real (>2 s) o cambio play/pause sí se aplica
    act(() => {
      mockSocket._fire('room-state', {
        video: { ...video },
        participants: [],
        joinRequests: [],
        playback: { currentTime: 60, isPlaying: false },
      });
    });
    expect(result.current.remoteAction?.timestamp).not.toBe(first?.timestamp);
    expect(result.current.remoteAction).toMatchObject({ currentTime: 60 });
  });

  it('handlePlaybackHeartbeat es estable entre renders (sin spam de heartbeat)', async () => {
    const { mockSocket, result, rerender } = setup(false);
    await waitForSubscribed(mockSocket);
    const first = result.current.handlePlaybackHeartbeat;
    webRTCStubs.isMicOn = true;
    rerender();
    expect(result.current.handlePlaybackHeartbeat).toBe(first);
    webRTCStubs.isMicOn = false;
  });

  it('disconnect transitorio marca isReconnecting SIN leave-room ni limpiar sala/video', async () => {
    const { mockSocket, result, onLeave } = setup(false);
    await waitFor(() => expect(result.current.roomData).not.toBeNull());
    const video = { originalName: 'noche.mp4', fileName: 'abc.mp4', mimeType: 'video/mp4', sizeBytes: 1000 };
    act(() => {
      mockSocket._fire('room-state', { video, participants: [], joinRequests: [] });
    });
    expect(result.current.joined).toBe(true);
    expect(result.current.isReconnecting).toBe(false);

    act(() => {
      mockSocket._fire('disconnect');
    });
    expect(result.current.isReconnecting).toBe(true);
    // Ni leave-room, ni salida, ni limpieza de la sala o del video
    expect(mockSocket.emit).not.toHaveBeenCalledWith('leave-room', expect.anything());
    expect(onLeave).not.toHaveBeenCalled();
    expect(disconnectSocket).not.toHaveBeenCalled();
    expect(result.current.roomData?.video).toMatchObject({ originalName: 'noche.mp4' });
    expect(result.current.joined).toBe(true);

    act(() => {
      mockSocket._fire('reconnect_attempt');
    });
    expect(result.current.isReconnecting).toBe(true);
    expect(mockSocket.emit).not.toHaveBeenCalledWith('leave-room', expect.anything());
  });

  it('reconnect + room-state limpia isReconnecting (re-join sin corte)', async () => {
    const { mockSocket, result, onLeave } = setup(true);
    await waitFor(() => expect(result.current.roomData).not.toBeNull());
    act(() => {
      mockSocket._fire('disconnect');
    });
    expect(result.current.isReconnecting).toBe(true);
    act(() => {
      mockSocket._fire('reconnect');
    });
    expect(result.current.isReconnecting).toBe(false);
    act(() => {
      mockSocket._fire('disconnect');
    });
    act(() => {
      mockSocket._fire('connect');
    });
    // connect re-emite join-room (re-join automático)
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'join-room',
      expect.objectContaining({ roomId: 'ABC123', userName: 'Beto' })
    );
    const video = { originalName: 'noche.mp4', fileName: 'abc.mp4', mimeType: 'video/mp4', sizeBytes: 1000 };
    act(() => {
      mockSocket._fire('room-state', { video, participants: [], joinRequests: [] });
    });
    expect(result.current.isReconnecting).toBe(false);
    expect(result.current.joined).toBe(true);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('sync-video con autoplay guarda la marca (play grupal, sin seek repetido)', async () => {
    const { mockSocket, result } = setup(false);
    await waitForSubscribed(mockSocket);
    act(() => {
      mockSocket._fire('sync-video', { action: 'play', currentTime: 0, sentAt: Date.now(), autoplay: true });
    });
    expect(result.current.remoteAction).toMatchObject({ action: 'play', currentTime: 0, autoplay: true });
    // Sin re-emisión de sync-video por aplicar un remoto
    expect(mockSocket.emit).not.toHaveBeenCalledWith('sync-video', expect.anything());
  });

  it('handleVideoReady emite video-ready con roomId y fileName', async () => {
    const { mockSocket, result } = setup(false);
    await waitForSubscribed(mockSocket);
    act(() => {
      result.current.handleVideoReady('abc.mp4');
    });
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'video-ready',
      expect.objectContaining({ roomId: 'ABC123', fileName: 'abc.mp4' })
    );
  });
});

describe('useRoomSocket (hostOnlySync + host-secret)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function lockRoom(mockSocket: MockSocket, patch: Record<string, unknown>) {
    act(() => {
      mockSocket._fire('room-state', {
        video: null,
        participants: [],
        joinRequests: [],
        ...patch,
      });
    });
  }

  it('handleSyncAction bloquea con toast cuando locked y no privilegiado', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { mockSocket, result } = setup(false);
    await waitFor(() => expect(result.current.roomData).not.toBeNull());
    lockRoom(mockSocket, {
      participants: [
        { name: 'Beto', isHost: false, role: 'member', joinedAt: new Date().toISOString() },
      ],
      settings: { hostOnlySync: true },
    });
    mockSocket.emit.mockClear();
    act(() => {
      result.current.handleSyncAction('play', 10);
    });
    expect(mockSocket.emit).not.toHaveBeenCalledWith('sync-video', expect.anything());
    expect(logSpy).toHaveBeenCalledWith(
      '[notify:warning]',
      'Solo el anfitrión controla la reproducción.'
    );
  });

  it('handleSyncAction emite cuando el usuario es host aunque esté locked', async () => {
    const { mockSocket, result } = setup(false);
    await waitFor(() => expect(result.current.roomData).not.toBeNull());
    lockRoom(mockSocket, { isHost: true, settings: { hostOnlySync: true } });
    expect(result.current.isHost).toBe(true);
    mockSocket.emit.mockClear();
    act(() => {
      result.current.handleSyncAction('pause', 12);
    });
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'sync-video',
      expect.objectContaining({ roomId: 'ABC123', action: 'pause', currentTime: 12 })
    );
  });

  it('handleSyncAction emite cuando el usuario es cohost aunque esté locked', async () => {
    const { mockSocket, result } = setup(false);
    await waitFor(() => expect(result.current.roomData).not.toBeNull());
    lockRoom(mockSocket, {
      participants: [
        { name: 'Beto', isHost: false, role: 'cohost', joinedAt: new Date().toISOString() },
      ],
      settings: { hostOnlySync: true },
    });
    mockSocket.emit.mockClear();
    act(() => {
      result.current.handleSyncAction('seek', 30);
    });
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'sync-video',
      expect.objectContaining({ roomId: 'ABC123', action: 'seek', currentTime: 30 })
    );
  });

  it('handleSyncAction emite sin bloqueo cuando hostOnlySync está off', async () => {
    const { mockSocket, result } = setup(false);
    await waitFor(() => expect(result.current.roomData).not.toBeNull());
    lockRoom(mockSocket, { settings: { hostOnlySync: false } });
    mockSocket.emit.mockClear();
    act(() => {
      result.current.handleSyncAction('play', 5);
    });
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'sync-video',
      expect.objectContaining({ action: 'play', currentTime: 5 })
    );
  });

  it("host-secret guarda la sesión y notifica 'Ahora eres el anfitrión'", async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { mockSocket } = setup(false);
    await waitForSubscribed(mockSocket);
    act(() => {
      mockSocket._fire('host-secret', { hostSecret: 'nuevo-secreto' });
    });
    expect(JSON.parse(localStorage.getItem('watchparty_host_session') ?? '{}')).toMatchObject({
      roomId: 'ABC123',
      hostSecret: 'nuevo-secreto',
    });
    expect(logSpy).toHaveBeenCalledWith('[notify:success]', 'Ahora eres el anfitrión de la sala.');
  });

  it('host-secret sin secreto no toca la sesión ni notifica', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { mockSocket } = setup(false);
    await waitForSubscribed(mockSocket);
    act(() => {
      mockSocket._fire('host-secret', {});
    });
    expect(localStorage.getItem('watchparty_host_session')).toBeNull();
    expect(logSpy).not.toHaveBeenCalledWith('[notify:success]', expect.anything());
  });

  it("limpia el listener 'host-secret' (socket.off) al desmontar", async () => {
    const { mockSocket, unmount } = setup(false);
    await waitForSubscribed(mockSocket);
    expect(mockSocket.on).toHaveBeenCalledWith('host-secret', expect.any(Function));
    unmount();
    expect(mockSocket.off).toHaveBeenCalledWith('host-secret', expect.any(Function));
  });
});
