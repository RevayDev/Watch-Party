// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { Room } from '../src/features/room/Room';

const AUTH_URL = 'https://accounts.spotify.com/authorize?x=1';

const roomState = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  tab: null as null | 'chat' | 'participants' | 'music',
  statusBody: {
    configured: true,
    connected: false,
    persistent: false,
    roomId: 'ABC123',
    accountName: null,
    error: null,
  } as Record<string, unknown>,
}));

const apiStubs = vi.hoisted(() => ({
  spotifyStatus: vi.fn(),
  spotifyAuthUrl: vi.fn(),
  spotifyDisconnect: vi.fn(),
}));

vi.mock('../src/services/api', () => ({
  ApiService: {
    spotifyStatus: (...args: unknown[]) => apiStubs.spotifyStatus(...args),
    spotifyAuthUrl: (...args: unknown[]) => apiStubs.spotifyAuthUrl(...args),
    spotifyDisconnect: (...args: unknown[]) => apiStubs.spotifyDisconnect(...args),
  },
}));

vi.mock('../src/features/room/hooks/useRoomSocket', () => ({
  useRoomSocket: () => ({
    userId: 'u1',
    myName: 'Ana',
    awaitingApproval: false,
    pendingMediaPrefRef: { current: { micOn: false, camOn: true } },
    roomData: {
      roomId: 'ABC123',
      leaderName: 'Ana',
      status: 'active',
      isTemporary: true,
      video: null,
      participants: [],
      createdAt: new Date().toISOString(),
      settings: roomState.settings,
    },
    loading: false,
    error: '',
    joined: true,
    isLeader: true,
    isCohost: false,
    showLeaderExitModal: false,
    setShowLeaderExitModal: vi.fn(),
    showMemberExitModal: false,
    setShowMemberExitModal: vi.fn(),
    messages: [],
    reactions: [],
    typingUsers: [],
    emitTyping: vi.fn(),
    uploadProgress: null,
    isVideoLoading: false,
    remoteAction: null,
    activeSideTab: roomState.tab,
    setActiveSideTab: (v: unknown) => {
      roomState.tab =
        typeof v === 'function'
          ? (v as (p: typeof roomState.tab) => typeof roomState.tab)(roomState.tab)
          : (v as typeof roomState.tab);
    },
    showEmojiPicker: false,
    setShowEmojiPicker: vi.fn(),
    isRightPanelCollapsed: false,
    setIsRightPanelCollapsed: vi.fn(),
    unreadCount: 0,
    showMoreMenu: false,
    setShowMoreMenu: vi.fn(),
    moreMenuRef: { current: null },
    showRoomSettings: false,
    setShowRoomSettings: vi.fn(),
    morePresence: { shown: false, closing: false },
    emojiPresence: { shown: false, closing: false },
    moreSheetRef: { current: null },
    emojiSheetRef: { current: null },
    sideTabView: roomState.tab ?? 'chat',
    isBarVisible: true,
    uiPinned: true,
    toggleBarsVisibility: vi.fn(),
    socket: { emit: vi.fn() },
    localStream: null,
    remotePeers: [],
    peerMediaStates: {},
    peerSignalStates: {},
    qualityLevel: 0,
    lowBandwidth: false,
    dataSaver: false,
    isReconnecting: false,
    isMicOn: false,
    isCameraOn: false,
    mediaError: null,
    toggleMic: vi.fn(),
    toggleCamera: vi.fn(),
    handleToggleTemporaryMode: vi.fn(),
    handleSaveRoomDetails: vi.fn(),
    handleSetRoomTimer: vi.fn(),
    handleUpdatePerfSettings: vi.fn(),
    fullscreenToasts: true,
    reactionsEnabled: true,
    visualEffects: true,
    duckingEnabled: true,
    duckingLevelPct: 30,
    cineTrigger: null,
    cineDismissedId: null,
    dismissCinematic: vi.fn(),
    musicQueue: [],
    musicNowPlaying: null,
    searchMusic: vi.fn(async () => []),
    musicAdd: vi.fn(),
    musicVote: vi.fn(),
    musicRemove: vi.fn(),
    musicReorder: vi.fn(),
    musicApprove: vi.fn(),
    musicNext: vi.fn(),
    musicStop: vi.fn(),
    heartbeatInterval: 5000,
    handleLeaveClick: vi.fn(),
    handleLeaveOnlyMe: vi.fn(),
    handleDeleteRoomForAll: vi.fn(),
    handleUploadVideo: vi.fn(),
    handleSetVideoUrl: vi.fn(),
    handleSyncAction: vi.fn(),
    handlePlaybackHeartbeat: vi.fn(),
    handleVideoReady: vi.fn(),
    handleSendMessage: vi.fn(),
    handleReaction: vi.fn(),
    handleCancelWaiting: vi.fn(),
  }),
}));

vi.mock('../src/components/RoomHeader', () => ({ RoomHeader: () => null }));
vi.mock('../src/features/player/VideoPlayer', () => ({ VideoPlayer: () => null }));
vi.mock('../src/components/CameraGrid', () => ({ CameraGrid: () => null }));
vi.mock('../src/components/LeaderExitModal', () => ({ LeaderExitModal: () => null }));
vi.mock('../src/components/MemberExitModal', () => ({ MemberExitModal: () => null }));
vi.mock('../src/components/RoomSettingsModal', () => ({ RoomSettingsModal: () => null }));
vi.mock('../src/features/waiting/WaitingApproval', () => ({ WaitingApproval: () => null }));

function renderRoom() {
  const utils = render(<Room roomId="ABC123" userName="Ana" isLeader onLeave={() => undefined} />);
  const footer = () => within(utils.container.querySelector('footer') as HTMLElement);
  const rerenderRoom = () => {
    utils.rerender(<Room roomId="ABC123" userName="Ana" isLeader onLeave={() => undefined} />);
  };
  return { ...utils, footer, rerenderRoom };
}

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  stubMatchMedia();
  roomState.settings = {};
  roomState.tab = null;
  roomState.statusBody = {
    configured: true,
    connected: false,
    persistent: false,
    roomId: 'ABC123',
    accountName: null,
    error: null,
  };
  apiStubs.spotifyStatus.mockImplementation(() => Promise.resolve({ ...roomState.statusBody }));
  apiStubs.spotifyAuthUrl.mockResolvedValue({ authUrl: AUTH_URL });
  apiStubs.spotifyDisconnect.mockResolvedValue({ connected: false });
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('Room (Spotify footer + retorno OAuth)', () => {
  it('desconectado abre el OAuth en pestaña nueva directo desde el clic', async () => {
    const location = { href: '' };
    const openSpy = vi.spyOn(window, 'open').mockImplementation(
      () => ({ closed: false, location }) as unknown as Window
    );
    const { footer } = renderRoom();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(footer().getByRole('button', { name: /spotify: vincular cuenta/i }));
    });
    // Pestaña abierta de forma síncrona (anti-bloqueos)…
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank', 'noopener,noreferrer');
    // …y navegada al llegar la URL.
    await act(async () => {
      await Promise.resolve();
    });
    expect(location.href).toBe(AUTH_URL);
    openSpy.mockRestore();
  });

  it('retorno conectado avisa, refresca y limpia la URL sin perder la sala', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    window.history.replaceState({}, '', '/?room=ABC123&spotify=connected');
    const { footer } = renderRoom();
    await act(async () => {
      await Promise.resolve();
    });
    expect(logSpy).toHaveBeenCalledWith('[notify:success]', expect.anything());
    expect(window.location.search).toBe('?room=ABC123');
    // La sala sigue montada (no se volvió al home).
    expect(footer().getByRole('button', { name: /música/i })).toBeDefined();
    logSpy.mockRestore();
  });

  it('retorno con error avisa y permite reintentar', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    window.history.replaceState({}, '', '/?room=ABC123&spotify=error&reason=cancelled');
    await act(async () => {
      renderRoom();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(logSpy).toHaveBeenCalledWith(
      '[notify:error]',
      expect.stringContaining('cancelada')
    );
    expect(window.location.search).toBe('?room=ABC123');
    logSpy.mockRestore();
  });

  it('conectado abre y cierra el panel con el mismo icono', async () => {
    apiStubs.spotifyStatus.mockResolvedValue({
      configured: true,
      connected: true,
      persistent: false,
      roomId: 'ABC123',
      accountName: 'DjAna',
      error: null,
    });
    roomState.settings = { musicEnabled: true };
    const { footer, rerenderRoom } = renderRoom();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(footer().getByRole('button', { name: /abrir panel/i }));
      rerenderRoom();
    });
    // Panel abierto con la cuenta y la cola.
    expect(screen.getByText(/conectado como DjAna/i)).toBeDefined();
    expect(screen.getByText(/cola \(0\)/i)).toBeDefined();
    // Segundo clic lo cierra (el botón vuelve a ofrecer abrirlo).
    await act(async () => {
      fireEvent.click(footer().getByRole('button', { name: /cerrar panel/i }));
      rerenderRoom();
    });
    expect(footer().getByRole('button', { name: /abrir panel/i })).toBeDefined();
  });

  it('desvincular desde el panel refresca el estado', async () => {
    roomState.statusBody = { ...roomState.statusBody, connected: true };
    roomState.settings = { musicEnabled: true };
    const { footer, rerenderRoom } = renderRoom();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(footer().getByRole('button', { name: /abrir panel/i }));
      rerenderRoom();
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Desvincular'));
    });
    expect(apiStubs.spotifyDisconnect).toHaveBeenCalledWith('ABC123');
  });
});
