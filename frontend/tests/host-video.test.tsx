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

it('applies a remote YouTube checkpoint without an HTML video element', () => {
  render(<VideoPlayer {...props} directPlayback
    video={{ ...video, sourceType: 'youtube', directUrl: 'https://www.youtube.com/watch?v=PW6ZSzdjrlo' }}
    remoteAction={{ action: 'pause', currentTime: 42, timestamp: 1 }} />);
  expect(youtube.seekTo).toHaveBeenCalledWith(42, true);
  expect(youtube.pauseVideo).toHaveBeenCalledOnce();
});
