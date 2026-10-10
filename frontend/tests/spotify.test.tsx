// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { VideoPlayer } from '../src/features/player/VideoPlayer';
import { ApiService } from '../src/services/api';

/**
 * Spotify ("Potify") fase 1 — docs/admin-panel-spotify.md §2.
 * Sin pestaña en el picker (va en footer + chat): el player muestra el
 * embed de Spotify en vez de <video>, y ApiService expone status/auth-url/
 * disconnect/resolve + setVideoUrl con enlace.
 */

vi.mock('../src/shared/components/BottomSheet', () => ({ BottomSheet: () => null }));

describe('VideoPlayer (fuente Spotify)', () => {
  const SPOTIFY_VIDEO = {
    originalName: 'Mi canción',
    fileName: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQ',
    mimeType: 'audio/spotify',
    sizeBytes: 0,
    sourceType: 'spotify' as const,
    directUrl: 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQ',
  };

  it('muestra el embed en vez del <video>', () => {
    const { container } = render(
      <VideoPlayer
        roomId="ABC123"
        video={SPOTIFY_VIDEO}
        isLeader={false}
        onUploadVideo={async () => undefined}
        uploadProgress={null}
        onSyncAction={vi.fn()}
        remoteAction={null}
        reactions={[]}
      />
    );
    const frame = container.querySelector('iframe.spotify-embed') as HTMLIFrameElement | null;
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toBe('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQ');
    expect(container.querySelector('video')).toBeNull();
  });

  it('rotula la fuente como Spotify', () => {
    const { container } = render(
      <VideoPlayer
        roomId="ABC123"
        video={SPOTIFY_VIDEO}
        isLeader={false}
        onUploadVideo={async () => undefined}
        uploadProgress={null}
        onSyncAction={vi.fn()}
        remoteAction={null}
        reactions={[]}
      />
    );
    expect(container.textContent).toMatch(/spotify/i);
  });
});

describe('ApiService (admin + spotify)', () => {
  function mockFetchOnce(payload: unknown, ok = true, status = 200) {
    const mock = vi.fn(async () => ({ ok, status, json: async () => payload }));
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('adminListRooms manda x-admin-token', async () => {
    const fetchMock = mockFetchOnce({ rooms: [], total: 0 });
    await ApiService.adminListRooms('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/admin/rooms');
    expect((init.headers as any)['x-admin-token']).toBe('tok-1');
  });

  it('adminKick postea el objetivo', async () => {
    const fetchMock = mockFetchOnce({ message: 'ok' });
    await ApiService.adminKick('ABC123', 'tok-1', { targetUserName: 'Troll', ban: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/admin/rooms/ABC123/kick');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).ban).toBe(true);
  });

  it('spotifyStatus consulta por sala', async () => {
    const fetchMock = mockFetchOnce({ configured: true, connected: false });
    await ApiService.spotifyStatus('ABC123');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/spotify/status');
    expect(url).toContain('roomId=ABC123');
  });

  it('setVideoUrl acepta enlaces Spotify como cualquier enlace', async () => {
    const fetchMock = mockFetchOnce({ message: 'ok', video: { sourceType: 'spotify' } });
    const res = await ApiService.setVideoUrl(
      'ABC123',
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQ'
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).url).toContain('open.spotify.com');
    expect((res as any).video.sourceType).toBe('spotify');
  });
});
