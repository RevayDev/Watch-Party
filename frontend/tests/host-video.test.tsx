// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VideoPlayer } from '../src/features/player/VideoPlayer';
import type { IVideoMetadata } from '../src/types/room';

const youtube = vi.hoisted(() => ({ seekTo: vi.fn(), pauseVideo: vi.fn(), getCurrentTime: () => 0 }));
vi.mock('../src/features/player/YouTubePlayerView', () => ({
  YouTubePlayerView: ({ onReady }: { onReady: (player: typeof youtube) => void }) => {
    const ready = React.useRef(onReady);
    React.useEffect(() => { ready.current(youtube); }, []);
    return <div data-testid="youtube" />;
  },
}));
vi.mock('../src/shared/components/BottomSheet', () => ({
  BottomSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <>{children}</> : null,
}));

const video: IVideoMetadata = { originalName: 'video', fileName: 'video', mimeType: 'video/mp4', sizeBytes: 1 };
const props = { roomId: 'local', isLeader: false, onUploadVideo: async () => {}, uploadProgress: null, onSyncAction: vi.fn(), reactions: [] };

it('allows browser-shared file selection even when the external server uses demo limits', () => {
  render(<VideoPlayer {...props} isLeader directPlayback video={null} remoteAction={null} />);
  expect(screen.getByRole('button', { name: 'Subir Archivo' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Seleccionar de mi PC' })).toBeEnabled();
});

it('plays a browser replica directly without constructing a Render proxy URL', () => {
  const { container } = render(<VideoPlayer {...props} directPlayback
    video={{ ...video, sourceType: 'url', directUrl: 'blob:https://example.com/local-file' }} remoteAction={null} />);
  expect(container.querySelector('video')?.getAttribute('src')).toBe('blob:https://example.com/local-file');
});

it('converts Drive view pages and uses the video proxy in browser-hosted rooms', () => {
  const { container } = render(<VideoPlayer {...props} directPlayback
    video={{ ...video, sourceType: 'url', directUrl: 'https://drive.google.com/file/d/public-file/view?resourcekey=access-key' }} remoteAction={null} />);
  const source = new URL(container.querySelector('video')!.getAttribute('src')!, 'http://localhost');
  expect(source.pathname).toBe('/api/proxy');
  const download = new URL(source.searchParams.get('url')!);
  expect(download.hostname).toBe('drive.usercontent.google.com');
  expect(download.searchParams.get('id')).toBe('public-file');
  expect(download.searchParams.get('confirm')).toBe('t');
  expect(download.searchParams.get('resourcekey')).toBe('access-key');
});

it('keeps ordinary HTTPS videos direct in browser-hosted rooms', () => {
  const { container } = render(<VideoPlayer {...props} directPlayback
    video={{ ...video, sourceType: 'url', directUrl: 'https://example.com/video.mp4' }} remoteAction={null} />);
  expect(container.querySelector('video')?.getAttribute('src')).toBe('https://example.com/video.mp4');
});

it('does not publish an immediate heartbeat again when the parent recreates callbacks or metadata', () => {
  const report = vi.fn();
  const metadata = { ...video, sourceType: 'url' as const, directUrl: 'https://example.com/video.mp4' };
  const view = render(<VideoPlayer {...props} directPlayback video={metadata} onPlaybackHeartbeat={report} remoteAction={null} />);
  expect(report).toHaveBeenCalledTimes(1);
  view.rerender(<VideoPlayer {...props} directPlayback video={{ ...metadata }} onPlaybackHeartbeat={(...args) => report(...args)} remoteAction={null} />);
  expect(report).toHaveBeenCalledTimes(1);
});

it('applies a remote YouTube checkpoint without an HTML video element', () => {
  render(<VideoPlayer {...props} directPlayback
    video={{ ...video, sourceType: 'youtube', directUrl: 'https://www.youtube.com/watch?v=PW6ZSzdjrlo' }}
    remoteAction={{ action: 'pause', currentTime: 42, timestamp: 1 }} />);
  expect(youtube.seekTo).toHaveBeenCalledWith(42, true);
  expect(youtube.pauseVideo).toHaveBeenCalledOnce();
});
