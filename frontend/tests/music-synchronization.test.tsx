// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NowPlayingPlayer } from '../src/features/room/components/NowPlayingPlayer';
const player = vi.hoisted(() => ({ seekTo: vi.fn(), playVideo: vi.fn(), pauseVideo: vi.fn(), unMute: vi.fn(), setVolume: vi.fn(), getCurrentTime: vi.fn(() => 0), getPlayerState: vi.fn(() => 1), getDuration: () => 300 }));
vi.mock('../src/features/player/YouTubePlayerView', () => ({ YouTubePlayerView: ({ onReady }: { onReady: (p: typeof player) => void }) => {
 const ready = React.useRef(onReady); React.useEffect(() => ready.current(player), []); return null;
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });
const props = { trackKey: 'entry', videoId: 'abcdefghijk', title: 'Song', subtitle: '', onEnded: vi.fn(), onNext: vi.fn(), onStop: vi.fn(), onExpand: vi.fn(), showModerator: true };
it('joins at the shared elapsed position, applies pause and seek without echoing', () => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
 const onPlayback = vi.fn();
 const view = render(<NowPlayingPlayer {...props} startedAt="2026-01-01T00:00:00Z" onPlayback={onPlayback} />);
 expect(player.seekTo).toHaveBeenCalledWith(60, true);
 view.rerender(<NowPlayingPlayer {...props} playback={{ currentTime: 25, playing: false, sentAt: Date.now() }} onPlayback={onPlayback} />);
 expect(player.pauseVideo).toHaveBeenCalled(); expect(player.seekTo).toHaveBeenLastCalledWith(25, true);
 act(() => { vi.advanceTimersByTime(3000); });
 expect(player.seekTo).toHaveBeenLastCalledWith(25, true);
 expect(onPlayback).not.toHaveBeenCalled();
});
it('publishes local play and seek controls to the room', () => {
 const onPlayback = vi.fn();
 render(<NowPlayingPlayer {...props} onPlayback={onPlayback} />);
 fireEvent.click(screen.getByRole('button', { name: 'Reproducir' }));
 expect(onPlayback).toHaveBeenCalledWith(0, true);
 fireEvent.click(screen.getByRole('button', { name: 'Reiniciar canción' }));
 expect(onPlayback).toHaveBeenLastCalledWith(0, true);
});
it('activates a joining phone locally instead of pausing shared music', () => {
  player.getPlayerState.mockReturnValue(2);
  const onPlayback = vi.fn();
  render(<NowPlayingPlayer {...props} playback={{ currentTime: 25, playing: true, sentAt: Date.now() }} onPlayback={onPlayback} />);
  player.playVideo.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Reproducir' }));
  expect(player.playVideo).toHaveBeenCalled();
  expect(onPlayback).not.toHaveBeenCalled();
});
it('opens volume separately without moving or changing the shared music position', () => {
 const onPlayback = vi.fn();
 render(<NowPlayingPlayer {...props} onPlayback={onPlayback} />);
 expect(screen.queryByRole('slider', { name: 'Volumen' })).toBeNull();
 fireEvent.click(screen.getByRole('button', { name: 'Volumen de música' }));
 expect(screen.getByRole('dialog', { name: 'Volumen de música' })).toBeTruthy();
 fireEvent.change(screen.getByRole('slider', { name: 'Volumen' }), { target: { value: '25' } });
 expect(player.setVolume).toHaveBeenLastCalledWith(25);
 expect(onPlayback).not.toHaveBeenCalled();
 fireEvent.keyDown(document, { key: 'Escape' });
 expect(screen.queryByRole('dialog')).toBeNull();
});
it('remains at zero before the coordinated start time and plays at the shared deadline', () => {
 vi.useFakeTimers(); vi.setSystemTime(10000);
 player.getPlayerState.mockReturnValue(2); player.getCurrentTime.mockReturnValue(0);
 render(<NowPlayingPlayer {...props} playback={{ currentTime: 0, playing: true, sentAt: 11200 }} />);
 expect(player.playVideo).not.toHaveBeenCalled();
 act(() => { vi.advanceTimersByTime(1199); });
 expect(player.playVideo).not.toHaveBeenCalled();
 act(() => { vi.advanceTimersByTime(1); });
 expect(player.playVideo).toHaveBeenCalled();
});
