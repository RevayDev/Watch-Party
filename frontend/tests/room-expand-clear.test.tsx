// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Room } from '../src/features/room/Room';

const socketFns = vi.hoisted(() => ({
  handleSetVideoUrl: vi.fn(),
  handleClearVideo: vi.fn(),
}));

vi.mock('../src/features/room/hooks/useRoomSocket', () => ({
  useRoomSocket: () => ({
    userId: 'u1',
    myName: 'Host',
    awaitingApproval: false,
    pendingMediaPrefRef: { current: { micOn: false, camOn: true } },
    roomData: {
      roomId: 'TESTROOM',
      leaderName: 'Host',
      status: 'active',
      isTemporary: true,
      video: {
        id: 'v1',
        name: 'Video Actual',
        originalName: 'video.mp4',
        fileName: 'video.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1000,
        durationSeconds: 100,
        sourceType: 'url',
        directUrl: 'https://example.com/video.mp4',
      },
      participants: [{ name: 'Host', isLeader: true }],
      createdAt: new Date().toISOString(),
      settings: { musicEnabled: true },
      musicNowPlaying: {
        entryId: 'e1',
        trackId: 'PW6ZSzdjrlo',
        name: 'Bohemian Rhapsody',
        artists: 'Queen',
        uri: 'https://www.youtube.com/watch?v=PW6ZSzdjrlo',
      },
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
    activeSideTab: 'music',
    setActiveSideTab: vi.fn(),
    musicQueue: [],
    musicNowPlaying: {
      entryId: 'e1',
      trackId: 'PW6ZSzdjrlo',
      name: 'Bohemian Rhapsody',
      artists: 'Queen',
      uri: 'https://www.youtube.com/watch?v=PW6ZSzdjrlo',
    },
    handleSetVideoUrl: socketFns.handleSetVideoUrl,
    handleClearVideo: socketFns.handleClearVideo,
    handleUploadVideo: vi.fn(),
    handleSyncAction: vi.fn(),
    handlePlaybackHeartbeat: vi.fn(),
    handleVideoReady: vi.fn(),
    handleSendMessage: vi.fn(),
    handleEditMessage: vi.fn(),
    handleReaction: vi.fn(),
    musicAdd: vi.fn(),
    musicRemove: vi.fn(),
    musicReorder: vi.fn(),
    musicApprove: vi.fn(),
    musicNext: vi.fn(),
    musicAutoNext: vi.fn(),
    musicStop: vi.fn(),
    searchMusic: vi.fn(),
    handleCancelWaiting: vi.fn(),
    isRightPanelCollapsed: false,
    toggleRightPanel: vi.fn(),
    toggleMic: vi.fn(),
    toggleCamera: vi.fn(),
    isMicOn: false,
    isCameraOn: false,
    unreadCount: 0,
    remotePeers: [],
    peerMediaStates: {},
    localStream: null,
    localScreenStream: null,
    isScreenSharing: false,
    toggleScreenShare: vi.fn(),
    retryMediaConnection: vi.fn(),
    showEmojiPicker: false,
    setShowEmojiPicker: vi.fn(),
    emojiPresence: { shown: false, closing: false },
    emojiSheetRef: { current: null },
    showMoreMenu: false,
    setShowMoreMenu: vi.fn(),
    morePresence: { shown: false, closing: false },
    moreSheetRef: { current: null },
    moreMenuRef: { current: null },
    handleLeaveClick: vi.fn(),
    isBarVisible: true,
    uiPinned: true,
    sideTabView: 'music',
    showRoomSettings: false,
    setShowRoomSettings: vi.fn(),
    lowBandwidth: false,
    dataSaver: false,
    duckingEnabled: false,
    duckingLevelPct: 30,
    reactionsEnabled: true,
    visualEffects: true,
    fullscreenToasts: true,
    cineTrigger: null,
    cineDismissedId: null,
    dismissCinematic: vi.fn(),
    activeCallMembersCount: 1,
    copyRoomCode: vi.fn(),
    copied: false,
    leaveRoom: vi.fn(),
    deleteRoom: vi.fn(),
    isMobile: false,
    socket: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  }),
}));

describe('Room: expand music to main and clear video', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    );
  });

  it('renders the Quitar button in VideoPlayer dock and dispatches handleClearVideo', async () => {
    render(<Room roomId="TESTROOM" onLeave={vi.fn()} />);

    const clearBtn = screen.getByTitle('Quitar video');
    expect(clearBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(clearBtn);
    });

    expect(socketFns.handleClearVideo).toHaveBeenCalledTimes(1);
  });

  it('ampliar a la sala sends currentTime and transferMusic: true', async () => {
    render(<Room roomId="TESTROOM" onLeave={vi.fn()} />);

    const expandBtn = screen.getByTitle('Ampliar a la pantalla de la sala');
    expect(expandBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(expandBtn);
    });

    expect(socketFns.handleSetVideoUrl).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=PW6ZSzdjrlo',
      'Bohemian Rhapsody',
      { startTime: 0, transferMusic: true }
    );
  });
});
