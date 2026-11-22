// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RoomDrawer } from '../src/features/room/components/RoomDrawer';

const lifecycle = vi.hoisted(() => ({ started: vi.fn(), stopped: vi.fn() }));
vi.mock('../src/features/player/YouTubePlayerView', () => ({
  YouTubePlayerView: () => {
    React.useEffect(() => { lifecycle.started(); return () => lifecycle.stopped(); }, []);
    return <iframe title="queue-audio" />;
  },
}));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it.each([false, true])('keeps the same audio player after closing and switching panels (phone=%s)', async (phone) => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: phone, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const noop = vi.fn();
  const props: React.ComponentProps<typeof RoomDrawer> = {
    activeSideTab: 'music', sideTabView: 'music', setActiveSideTab: noop,
    messages: [], handleSendMessage: noop, handleEditMessage: noop, typingUsers: [], onTyping: noop,
    myName: 'Ana', userId: 'host', isLeader: true, peerMediaStates: {}, isMicOn: false, isCameraOn: false,
    toggleMic: noop, toggleCamera: noop, socket: { emit: noop }, roomId: 'ABC123',
    roomData: { roomId: 'ABC123', participants: [], settings: {}, status: 'active' } as never,
    musicNowPlaying: { entryId: 'entry', trackId: 'PW6ZSzdjrlo', name: 'Song', artists: 'Artist', startedAt: new Date().toISOString(), startedBy: 'Ana' },
  };
  const view = render(<RoomDrawer {...props} />);
  const player = document.querySelector('iframe[title="queue-audio"]');
  expect(player).toBeTruthy();
  expect(document.querySelector('.music-panel__content')?.contains(document.querySelector('.music-panel__footer'))).toBe(false);
  view.rerender(<RoomDrawer {...props} activeSideTab={null} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(document.querySelector('iframe[title="queue-audio"]')).toBe(player);
  expect(lifecycle.stopped).not.toHaveBeenCalled();
  view.rerender(<RoomDrawer {...props} activeSideTab="chat" />);
  view.rerender(<RoomDrawer {...props} />);
  expect(document.querySelector('iframe[title="queue-audio"]')).toBe(player);
  expect(lifecycle.started).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(lifecycle.stopped).toHaveBeenCalledTimes(1);
});
