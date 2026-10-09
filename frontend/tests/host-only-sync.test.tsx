// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { RoomSettingsModal } from '../src/components/RoomSettingsModal';
import { Participants } from '../src/features/participants/Participants';
import { Room } from '../src/features/room/Room';

const { roomEmitMock } = vi.hoisted(() => ({ roomEmitMock: vi.fn() }));

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
      settings: {},
    },
    loading: false,
    error: '',
    joined: true,
    isLeader: true,
    showLeaderExitModal: false,
    setShowLeaderExitModal: vi.fn(),
    showMemberExitModal: false,
    setShowMemberExitModal: vi.fn(),
    messages: [],
    reactions: [],
    typingUsers: [],
    emitTyping: vi.fn(),
    uploadProgress: null,
    remoteAction: null,
    activeSideTab: null,
    setActiveSideTab: vi.fn(),
    showEmojiPicker: false,
    setShowEmojiPicker: vi.fn(),
    isRightPanelCollapsed: false,
    setIsRightPanelCollapsed: vi.fn(),
    unreadCount: 0,
    showMoreMenu: false,
    setShowMoreMenu: vi.fn(),
    moreMenuRef: { current: null },
    showRoomSettings: true,
    setShowRoomSettings: vi.fn(),
    morePresence: null,
    emojiPresence: null,
    moreSheetRef: { current: null },
    emojiSheetRef: { current: null },
    sideTabView: 'chat',
    isBarVisible: true,
    uiPinned: true,
    toggleBarsVisibility: vi.fn(),
    socket: { emit: roomEmitMock },
    localStream: null,
    remotePeers: [],
    peerMediaStates: {},
    peerSignalStates: {},
    qualityLevel: 0,
    lowBandwidth: false,
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
    dataSaver: false,
    fullscreenToasts: true,
    reactionsEnabled: true,
    visualEffects: true,
    duckingEnabled: true,
    duckingLevelPct: 30,
    interestellarActive: false,
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
vi.mock('../src/features/waiting/WaitingApproval', () => ({ WaitingApproval: () => null }));
vi.mock('../src/features/room/components/RoomControls', () => ({ RoomControls: () => null }));
vi.mock('../src/features/room/components/RoomDrawer', () => ({ RoomDrawer: () => null }));

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
  vi.clearAllMocks();
  localStorage.clear();
  stubMatchMedia();
});

const modalBase = {
  isOpen: true,
  onClose: vi.fn(),
  isTemporary: true,
  onToggleTemporary: vi.fn(),
  roomName: 'Noche de peli',
  roomDescription: 'Pelis del viernes',
  timerMinutes: null as number | null,
  timerEndsAt: null as string | null,
  requireApproval: false,
  onSaveDetails: vi.fn(),
  onSetTimer: vi.fn(),
  onToggleRequireApproval: vi.fn(),
};

function hostOnlyCheckbox(): HTMLInputElement {
  const title = screen.getByText('Control solo de anfitriones');
  const box = title.closest('.room-settings__box');
  expect(box).not.toBeNull();
  const input = box!.querySelector('input[type="checkbox"]');
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

describe('RoomSettingsModal (hostOnlySync)', () => {
  it('muestra el interruptor apagado por defecto y emite el toggle al cambiar', async () => {
    const onToggleHostOnlySync = vi.fn();
    await act(async () => {
      render(<RoomSettingsModal {...modalBase} onToggleHostOnlySync={onToggleHostOnlySync} />);
    });
    const checkbox = hostOnlyCheckbox();
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(onToggleHostOnlySync).toHaveBeenCalledTimes(1);
  });

  it('refleja hostOnlySync=true y se deshabilita sin canEdit', async () => {
    await act(async () => {
      render(
        <RoomSettingsModal {...modalBase} hostOnlySync canEdit={false} onToggleHostOnlySync={vi.fn()} />
      );
    });
    const checkbox = hostOnlyCheckbox();
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
  });
});

const beatriz = {
  name: 'Ana',
  userId: 'u1',
  isLeader: true,
  role: 'leader' as const,
  joinedAt: new Date().toISOString(),
};
const beto = {
  name: 'Beto',
  userId: 'u2',
  isLeader: false,
  role: 'member' as const,
  joinedAt: new Date().toISOString(),
};

const participantsBase = {
  participants: [beatriz, beto],
  currentUserName: 'Ana',
  currentUserId: 'u1',
  kickedUsers: [],
  joinRequests: [],
  settings: undefined,
  peerMediaStates: {},
  isMicOn: false,
  isCameraOn: false,
};

describe('Participants (transfer-leader + roles solo-leader)', () => {
  it("el leader ve 'Pasar sala' y transfiere con confirm", async () => {
    const onTransferHost = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      render(
        <Participants
          {...participantsBase}
          isLeader
          onTransferHost={onTransferHost}
          onToggleCoLeader={vi.fn()}
          onKickUser={vi.fn()}
        />
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Beto'));
    });
    const transferBtn = screen.getByRole('button', { name: /Pasar sala/ });
    expect(transferBtn).toBeDefined();
    await act(async () => {
      fireEvent.click(transferBtn);
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onTransferHost).toHaveBeenCalledWith('Beto', 'u2');
    confirmSpy.mockRestore();
  });

  it("el leader ve 'Co-anfitrión' y cancela el traspaso sin confirm", async () => {
    const onTransferHost = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => {
      render(
        <Participants
          {...participantsBase}
          isLeader
          onTransferHost={onTransferHost}
          onToggleCoLeader={vi.fn()}
        />
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Beto'));
    });
    expect(screen.getByRole('button', { name: /^Co-anfitrión$/ })).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Pasar sala/ }));
    });
    expect(onTransferHost).not.toHaveBeenCalled();
    (window.confirm as unknown as { mockRestore: () => void }).mockRestore();
  });

  it("el coleader NO ve 'Pasar sala' ni botones de co-anfitrión pero conserva moderación (Expulsar)", async () => {
    await act(async () => {
      render(
        <Participants
          {...participantsBase}
          isLeader={false}
          isCoLeader
          onTransferHost={vi.fn()}
          onToggleCoLeader={vi.fn()}
          onKickUser={vi.fn()}
        />
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Beto'));
    });
    expect(screen.queryByRole('button', { name: /Pasar sala/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /co-anfitrión/i })).toBeNull();
    // Moderación normal intacta para el coleader
    expect(screen.getByRole('button', { name: /Expulsar/ })).toBeDefined();
  });

  it('un miembro sin privilegios no ve acciones de moderación', async () => {
    await act(async () => {
      render(
        <Participants
          {...participantsBase}
          currentUserName="Beto"
          currentUserId="u2"
          isLeader={false}
          onTransferHost={vi.fn()}
        />
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });
    expect(screen.queryByRole('button', { name: /Pasar sala/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Expulsar/ })).toBeNull();
  });
});

describe('Room (toggle hostOnlySync emite el patch)', () => {
  it("onToggleHostOnlySync emite 'update-room-settings' con hostOnlySync:true", async () => {
    await act(async () => {
      render(<Room roomId="ABC123" userName="Ana" isLeader onLeave={vi.fn()} />);
    });
    const checkbox = hostOnlyCheckbox();
    expect(checkbox.checked).toBe(false);
    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(roomEmitMock).toHaveBeenCalledWith(
      'update-room-settings',
      expect.objectContaining({
        roomId: 'ABC123',
        settings: expect.objectContaining({ hostOnlySync: true }),
      })
    );
  });
});
