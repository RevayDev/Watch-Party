// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { VideoPlayer } from '../src/features/player/VideoPlayer';

vi.mock('../src/shared/components/BottomSheet', () => ({ BottomSheet: () => null }));

let mockPaused = true;

beforeEach(() => {
  mockPaused = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const VIDEO = {
  originalName: 'v.mp4',
  fileName: 'v.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1,
  sourceType: 'file' as const,
};

interface PlayerOpts {
  isLeader?: boolean;
  video?: typeof VIDEO | null;
  cinematicKey?: number;
  cinematicQuotes?: [string, string, string] | null;
}

function renderPlayer(onSyncAction: ReturnType<typeof vi.fn>, opts: PlayerOpts = {}) {
  const props = {
    roomId: 'R1',
    video: opts.video === undefined ? VIDEO : opts.video,
    isLeader: opts.isLeader ?? true,
    onUploadVideo: async () => undefined,
    uploadProgress: null as number | null,
    onSyncAction,
    remoteAction: null,
    reactions: [],
    cinematicKey: opts.cinematicKey ?? 0,
    cinematicQuotes: opts.cinematicQuotes ?? null,
    onCinematicDone: () => undefined,
  };
  let rerender!: (ui: React.ReactElement) => void;
  let container!: HTMLElement;
  act(() => {
    ({ rerender, container } = render(<VideoPlayer {...props} />));
  });
  // Mocks solo en la instancia del <video> (no en el prototipo: el <audio>
  // de la cinemática comparte HTMLMediaElement y no debe contaminarse).
  const vid = container.querySelector('video');
  const playMock = vi.fn(async () => {
    mockPaused = false;
  });
  const pauseMock = vi.fn(() => {
    mockPaused = true;
  });
  if (vid) {
    Object.defineProperty(vid, 'paused', { get: () => mockPaused, configurable: true });
    vid.play = playMock as unknown as typeof vid.play;
    vid.pause = pauseMock as unknown as typeof vid.pause;
  }
  const setKey = (cinematicKey: number) => {
    act(() => {
      rerender(<VideoPlayer {...props} cinematicKey={cinematicKey} />);
    });
  };
  return { setKey, container, playMock, pauseMock };
}

describe('VideoPlayer (cinemática del combo)', () => {
  it('Omitir real cierra la capa y avisa con skipped=true', () => {
    const onSyncAction = vi.fn();
    const onCinematicDone = vi.fn();
    const props = {
      roomId: 'R1',
      video: VIDEO,
      isLeader: true,
      onUploadVideo: async () => undefined,
      uploadProgress: null as number | null,
      onSyncAction,
      remoteAction: null,
      reactions: [],
      cinematicKey: 7,
      cinematicQuotes: ['AAA', 'BBB', 'CCC'] as [string, string, string],
      onCinematicDone,
    };
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<VideoPlayer {...props} />));
    });
    expect(container.querySelector('.player-container > .ambient-intro')).not.toBeNull();
    act(() => {
      fireEvent.click(container.querySelector('.ambient-intro__skip') as HTMLElement);
    });
    expect(onCinematicDone).toHaveBeenCalledWith(true);
    // La capa se oculta al instante sin esperar al padre.
    expect(container.querySelector('.ambient-intro')).toBeNull();
  });

  it('muestra la cinemática dentro del player, una capa por encima', () => {
    const onSyncAction = vi.fn();
    const { container } = renderPlayer(onSyncAction, {
      cinematicKey: 3,
      cinematicQuotes: ['AAA', 'BBB', 'CCC'],
    });
    const overlay = container.querySelector('.player-container > .ambient-intro');
    expect(overlay).not.toBeNull();
    // Las frases compartidas: toda la sala ve lo mismo.
    expect(overlay?.querySelector('.ambient-intro__quote')?.textContent).toBe('AAA');
  });

  it('pausa el video y emite sync al mostrarse (con control)', () => {
    mockPaused = false; // reproduciendo
    const onSyncAction = vi.fn();
    const { setKey, pauseMock } = renderPlayer(onSyncAction);
    expect(pauseMock).not.toHaveBeenCalled();

    setKey(1);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(onSyncAction).toHaveBeenCalledTimes(1);
    expect(onSyncAction.mock.calls[0][0]).toBe('pause');
  });

  it('reanuda al cerrarse solo si la cinemática lo pausó', () => {
    mockPaused = false;
    const onSyncAction = vi.fn();
    const { setKey, playMock } = renderPlayer(onSyncAction);

    setKey(2);
    expect(onSyncAction).toHaveBeenCalledTimes(1);

    setKey(0);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(onSyncAction).toHaveBeenCalledTimes(2);
    expect(onSyncAction.mock.calls[1][0]).toBe('play');
  });

  it('no reanuda si el video ya estaba pausado', () => {
    mockPaused = true;
    const onSyncAction = vi.fn();
    const { setKey, playMock, pauseMock } = renderPlayer(onSyncAction);

    setKey(1);
    expect(pauseMock).not.toHaveBeenCalled();
    expect(onSyncAction).not.toHaveBeenCalled();

    setKey(0);
    expect(playMock).not.toHaveBeenCalled();
    expect(onSyncAction).not.toHaveBeenCalled();
  });

  it('sin control pausa en local pero no emite sync', () => {
    mockPaused = false;
    const onSyncAction = vi.fn();
    const { setKey, pauseMock } = renderPlayer(onSyncAction, { isLeader: false });

    setKey(1);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(onSyncAction).not.toHaveBeenCalled();
  });

  it('sin video no pausa ni emite', () => {
    mockPaused = false;
    const onSyncAction = vi.fn();
    const { setKey, pauseMock } = renderPlayer(onSyncAction, { video: null });

    setKey(1);
    expect(pauseMock).toHaveBeenCalledTimes(0);
    expect(onSyncAction).not.toHaveBeenCalled();
  });
});
