// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Room } from '../src/features/room/Room';

const comboState = vi.hoisted(() => ({
  trigger: null as null | { comboId: string; quotes: [string, string, string] },
}));

const roomStubs = vi.hoisted(() => ({
  dismissedId: null as string | null,
  dismissCinematic: vi.fn((comboId: string | null, _broadcast: boolean) => {
    roomStubs.dismissedId = comboId;
  }),
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
      settings: {},
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
    showRoomSettings: false,
    setShowRoomSettings: vi.fn(),
    morePresence: null,
    emojiPresence: null,
    moreSheetRef: { current: null },
    emojiSheetRef: { current: null },
    sideTabView: 'chat',
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
    cineTrigger: comboState.trigger,
    cineDismissedId: roomStubs.dismissedId,
    dismissCinematic: roomStubs.dismissCinematic,
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
// El player real se testea en video-cinematic.test.tsx: aquí solo importa
// que Room le pase la secuencia (key) y el cierre (onCinematicDone).
vi.mock('../src/features/player/VideoPlayer', () => ({
  VideoPlayer: ({ cinematicKey, onCinematicDone }: any) =>
    cinematicKey > 0 ? (
      <button type="button" onClick={() => onCinematicDone(true)}>
        CINE-{cinematicKey}
      </button>
    ) : null,
}));
vi.mock('../src/components/CameraGrid', () => ({ CameraGrid: () => null }));
vi.mock('../src/components/LeaderExitModal', () => ({ LeaderExitModal: () => null }));
vi.mock('../src/components/MemberExitModal', () => ({ MemberExitModal: () => null }));
vi.mock('../src/components/RoomSettingsModal', () => ({ RoomSettingsModal: () => null }));
vi.mock('../src/features/waiting/WaitingApproval', () => ({ WaitingApproval: () => null }));
vi.mock('../src/features/room/components/RoomControls', () => ({ RoomControls: () => null }));
vi.mock('../src/features/room/components/RoomDrawer', () => ({ RoomDrawer: () => null }));

beforeEach(() => {
  comboState.trigger = null;
  roomStubs.dismissedId = null;
  roomStubs.dismissCinematic.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Room (cinemática del combo Interestellar)', () => {
  it('no dispara la secuencia al entrar a la sala', async () => {
    await act(async () => {
      render(<Room roomId="ABC123" userName="Ana" isLeader onLeave={() => undefined} />);
    });
    expect(screen.queryByText(/CINE-/)).toBeNull();
  });

  it('pasa la secuencia al player al dispararse el combo y la cierra al omitir', async () => {
    let rerender!: (ui: React.ReactElement) => void;
    await act(async () => {
      ({ rerender } = render(
        <Room roomId="ABC123" userName="Ana" isLeader onLeave={() => undefined} />
      ));
    });
    expect(screen.queryByText(/CINE-/)).toBeNull();

    // El servidor reenvía UN trigger (el primero gana): mismas frases p/todos.
    comboState.trigger = { comboId: 'c1', quotes: ['AAA', 'BBB', 'CCC'] };
    await act(async () => {
      rerender(<Room roomId="ABC123" userName="Ana" isLeader onLeave={() => undefined} />);
    });
    expect(screen.getByText('CINE-1')).toBeDefined();

    // Omitir la cierra y no reaparece aunque el combo siga activo.
    await act(async () => {
      fireEvent.click(screen.getByText('CINE-1'));
    });
    // El omitir se reenvía a la sala (skip compartido): se llama con el
    // comboId y skipped=true.
    expect(roomStubs.dismissCinematic).toHaveBeenCalledWith('c1', true);
    await act(async () => {
      rerender(<Room roomId="ABC123" userName="Ana" isLeader onLeave={() => undefined} />);
    });
    expect(screen.queryByText(/CINE-/)).toBeNull();
  });
});
