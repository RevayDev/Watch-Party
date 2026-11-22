// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MusicPanel, resolveNowPlayingVideoId } from '../src/features/room/components/MusicPanel';
import { ApiService } from '../src/services/api';

const ytFake = vi.hoisted(() => ({
  playVideo: vi.fn(),
  pauseVideo: vi.fn(),
  seekTo: vi.fn(),
  setVolume: vi.fn(),
  mute: vi.fn(),
  unMute: vi.fn(),
  currentTime: 0,
  duration: 180,
}));

vi.mock('../src/features/player/YouTubePlayerView', () => ({
  YouTubePlayerView: ({ videoId, onReady, onStateChange }: any) => {
    React.useEffect(() => {
      const player = {
        playVideo: (...args: unknown[]) => ytFake.playVideo(...args),
        pauseVideo: (...args: unknown[]) => ytFake.pauseVideo(...args),
        seekTo: (...args: unknown[]) => ytFake.seekTo(...args),
        setVolume: (...args: unknown[]) => ytFake.setVolume(...args),
        mute: (...args: unknown[]) => ytFake.mute(...args),
        unMute: (...args: unknown[]) => ytFake.unMute(...args),
        getCurrentTime: () => ytFake.currentTime,
        getDuration: () => ytFake.duration,
      };
      onReady?.(player);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoId]);
    return (
      <>
        <div
          data-testid="yt-miniplayer"
          data-video={videoId}
          onClick={() => onStateChange?.({ data: 1 })}
        />
        <div
          data-testid="yt-ended"
          onClick={() => onStateChange?.({ data: 0 })}
        />
      </>
    );
  },
}));

function baseProps(overrides: Partial<React.ComponentProps<typeof MusicPanel>> = {}) {
  const noop = vi.fn();
  return {
    roomId: 'ABC123',
    queue: [],
    nowPlaying: null,
    settings: { musicEnabled: true } as never,
    isModerator: false,
    myName: 'Ana',
    onAdd: noop,
    onRemove: noop,
    onReorder: noop,
    onApprove: noop,
    onNext: noop,
    onAutoNext: noop,
    onStop: noop,
    ...overrides,
  };
}

const TRACK = {
  entryId: 'e1',
  trackId: 'PW6ZSzdjrlo',
  name: 'Bohemian Rhapsody',
  artists: 'Queen',
  albumArt: 'https://img.youtube.com/vi/PW6ZSzdjrlo/hqdefault.jpg',
  uri: 'https://www.youtube.com/watch?v=PW6ZSzdjrlo',
  openUrl: 'https://www.youtube.com/watch?v=PW6ZSzdjrlo',
  proposedBy: 'Roberto',
  startedAt: new Date().toISOString(),
  startedBy: 'sala',
};

describe('MusicPanel (YouTube, sin banner, audible)', () => {
  it('busca en YouTube y permite enviar el resultado a la cola o a la sala', async () => {
    const track = { ...TRACK, id: TRACK.trackId };
    const search = vi.spyOn(ApiService, 'youtubeSearch').mockResolvedValue([track]);
    const onAdd = vi.fn();
    const onExpandToMain = vi.fn();
    try {
      render(<MusicPanel {...baseProps({ isModerator: true, onAdd, onExpandToMain })} />);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' Queen ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Añadir Bohemian Rhapsody a la cola' }));
      fireEvent.click(screen.getByRole('button', { name: 'Ver en sala' }));
      expect(search).toHaveBeenCalledWith('Queen', expect.any(AbortSignal));
      expect(onAdd).toHaveBeenCalledWith(track);
      expect(onExpandToMain).toHaveBeenCalledWith(track.openUrl, track.name);
    } finally {
      search.mockRestore();
    }
  });

  it('reconoce el enlace de privacidad que devuelve el servidor al ampliar', () => {
    expect(resolveNowPlayingVideoId({ uri: 'https://www.youtube-nocookie.com/embed/PW6ZSzdjrlo?enablejsapi=1' }))
      .toBe('PW6ZSzdjrlo');
  });

  it('permite abrir el menú de una solicitud pendiente y eliminarla', () => {
    const onRemove = vi.fn();
    const entry = { ...TRACK, id: 'pending', status: 'pending' } as const;
    render(<MusicPanel {...baseProps({ isModerator: true, queue: [entry as never], onRemove })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opciones de Bohemian Rhapsody' }));
    expect(screen.getByRole('link', { name: 'Abrir en YouTube' }).getAttribute('href')).toBe(TRACK.openUrl);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(onRemove).toHaveBeenCalledWith(entry.id);
  });

  it('no muestra banner ni rastros de Spotify', () => {
    render(<MusicPanel {...baseProps()} />);
    expect(screen.queryByText(/cola musical con youtube/i)).toBeNull();
    expect(screen.queryByText(/audio compartido/i)).toBeNull();
    expect(screen.queryByText(/spotify/i)).toBeNull();
  });

  it('rechaza enlaces que no son de YouTube', async () => {
    render(<MusicPanel {...baseProps()} />);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/enlace de youtube/i), {
        target: { value: 'https://example.com/cosa' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Añadir'));
    });
    expect(screen.getByText(/no es de youtube válido/i)).toBeDefined();
  });

  it('agrega un enlace válido a la cola', async () => {
    const onAddUrl = vi.fn(async () => true);
    render(<MusicPanel {...baseProps({ onAddUrl })} />);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/enlace de youtube/i), {
        target: { value: 'https://youtu.be/PW6ZSzdjrlo' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Añadir'));
    });
    expect(onAddUrl).toHaveBeenCalledWith('https://youtu.be/PW6ZSzdjrlo');
  });

  it.skip('lo que suena monta el miniplayer audible', async () => {
    render(<MusicPanel {...baseProps({ nowPlaying: TRACK as never })} />);
    const mini = await screen.findByTestId('yt-miniplayer');
    expect(mini.getAttribute('data-video')).toBe('PW6ZSzdjrlo');
    // Al recibir evento "playing", el overlay invita a pausar (hay audio).
    await act(async () => {
      fireEvent.click(mini);
    });
    expect(screen.getByRole('button', { name: /pausar/i })).toBeDefined();
  });

  it.skip('muestra la tarjeta vac�a sin montar un iframe cuando no hay m�sica', () => {
    const { container } = render(<MusicPanel {...baseProps()} />);
    expect(screen.queryByTestId('yt-miniplayer')).toBeNull();
    expect(container.querySelector('.music-panel__footer')).toBeTruthy();
    expect(screen.getByText('Sin reproducción')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reproducir cola' })).toBeDisabled();
    expect(container.querySelector('.music-panel__start')).toBeNull();
  });

  it.skip('al terminar el tema pide avanzar la cola (auto-next)', async () => {
    const onAutoNext = vi.fn();
    render(<MusicPanel {...baseProps({ nowPlaying: TRACK as never, onAutoNext })} />);
    await screen.findByTestId('yt-miniplayer');
    await act(async () => {
      fireEvent.click(screen.getByTestId('yt-ended'));
    });
    expect(onAutoNext).toHaveBeenCalledTimes(1);
  });

  it.skip('controles: pausar, adelantar, silenciar y volumen', async () => {
    render(<MusicPanel {...baseProps({ nowPlaying: TRACK as never })} />);
    await screen.findByTestId('yt-miniplayer');
    // Simula reproducción en curso.
    await act(async () => {
      fireEvent.click(screen.getByTestId('yt-miniplayer'));
    });
    // Pausar.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^pausar$/i }));
    });
    expect(ytFake.pauseVideo).toHaveBeenCalled();
    // Adelantar al segundo 60.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/adelantar o retroceder/i), { target: { value: '60' } });
    });
    expect(ytFake.seekTo).toHaveBeenCalledWith(60, true);
    // Silenciar y volumen.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /silenciar/i }));
    });
    expect(ytFake.mute).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^volumen$/i), { target: { value: '30' } });
    });
    expect(ytFake.setVolume).toHaveBeenCalledWith(30);
  });

  it('con cola detenida ofrece Reproducir (llama a Siguiente)', async () => {
    const onNext = vi.fn();
    const item = {
      id: 'q1',
      trackId: 'dQw4w9WgXcQ',
      name: 'Canción',
      artists: 'Artista',
      proposedBy: 'Beto',
      votes: [],
      status: 'queued',
    };
    const { container } = render(<MusicPanel {...baseProps({ isModerator: true, queue: [item] as never, nowPlaying: null, onNext })} />);
    expect(container.querySelector('.music-panel__start')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reproducir/i }));
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('la cola no muestra votos ni botón Votar', () => {
    const item = {
      id: 'q1',
      trackId: 'dQw4w9WgXcQ',
      name: 'Canción',
      artists: 'Artista',
      proposedBy: 'Beto',
      votes: ['Ana', 'Carlos'],
      status: 'queued',
    };
    render(<MusicPanel {...baseProps({ queue: [item] as never })} />);
    expect(screen.queryByText(/votar/i)).toBeNull();
    expect(screen.queryByText(/votos?/i)).toBeNull();
    expect(screen.getByText('Canción')).toBeDefined();
  });

  it.skip('controles: anterior reinicia, siguiente avanza (moderador)', async () => {
    const onNext = vi.fn();
    render(
      <MusicPanel {...baseProps({ nowPlaying: TRACK as never, isModerator: true, onNext })} />
    );
    await screen.findByTestId('yt-miniplayer');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reiniciar canción/i }));
    });
    expect(ytFake.seekTo).toHaveBeenCalledWith(0, true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /siguiente canción/i }));
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it.skip('ampliar a la sala solo visible para moderador y emite url+título', async () => {
    const onExpandToMain = vi.fn();
    const { rerender } = render(
      <MusicPanel {...baseProps({ nowPlaying: TRACK as never, onExpandToMain })} />
    );
    expect(screen.queryByRole('button', { name: /ampliar a la pantalla/i })).toBeNull();
    rerender(
      <MusicPanel
        {...baseProps({ nowPlaying: TRACK as never, isModerator: true, onExpandToMain })}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ampliar a la pantalla/i }));
    });
    expect(onExpandToMain).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=PW6ZSzdjrlo',
      'Bohemian Rhapsody',
      0
    );
  });

  it.skip('keeps one player in the footer and transfers its actual position after pausing', async () => {
    const onExpandToMain = vi.fn();
    ytFake.currentTime = 42;
    const { container } = render(<MusicPanel {...baseProps({ nowPlaying: TRACK as never, isModerator: true, onExpandToMain })} />);
    expect(screen.queryByPlaceholderText(/título opcional/i)).toBeNull();
    expect(container.querySelector('details.music-panel__queue')).toBeTruthy();
    expect(container.querySelector('.music-panel__footer [data-testid="yt-miniplayer"]')).toBeTruthy();
    expect(screen.getAllByLabelText('Adelantar o retroceder')).toHaveLength(1);
    expect(screen.queryByTitle('Pasar al siguiente tema')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /ampliar a la pantalla/i }));
    expect(ytFake.pauseVideo).toHaveBeenCalled();
    expect(onExpandToMain).toHaveBeenCalledWith(TRACK.openUrl, TRACK.name, 42);
    ytFake.currentTime = 0;
  });

  it('menú ⋮ de la fila en reproducción: ampliar y siguiente (moderador)', async () => {
    const onExpandToMain = vi.fn();
    const onNext = vi.fn();
    const item = {
      id: 'q1',
      trackId: 'PW6ZSzdjrlo',
      name: 'Bohemian Rhapsody',
      artists: 'Queen',
      proposedBy: 'Roberto',
      votes: [],
      status: 'queued',
      openUrl: 'https://www.youtube.com/watch?v=PW6ZSzdjrlo',
    };
    render(
      <MusicPanel
        {...baseProps({
          queue: [item] as never,
          nowPlaying: TRACK as never,
          isModerator: true,
          onExpandToMain,
          onNext,
        })}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /opciones de bohemian/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ampliar a la sala/i }));
    });
    expect(onExpandToMain).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=PW6ZSzdjrlo',
      'Bohemian Rhapsody'
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /opciones de bohemian/i }));
    });
    // El menú aporta su propio "Siguiente" (el otro es la píldora del player).
    const siguientes = screen.getAllByRole('button', { name: /^siguiente$/i });
    expect(siguientes).toHaveLength(1);
    await act(async () => {
      fireEvent.click(siguientes[0]);
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('la fila en reproducción muestra indicador y duración', () => {
    const item = {
      id: 'q1',
      trackId: 'dQw4w9WgXcQ',
      name: 'Canción',
      artists: 'Artista',
      proposedBy: 'Beto',
      votes: [],
      status: 'queued',
      durationMs: 140000,
    };
    const nowPlayingSame = { ...TRACK, trackId: 'dQw4w9WgXcQ' };
    render(
      <MusicPanel {...baseProps({ queue: [item] as never, nowPlaying: nowPlayingSame as never })} />
    );
    expect(screen.getByLabelText('Sonando ahora')).toBeDefined();
    expect(screen.getByText(/2:20/)).toBeDefined();
  });

  it('música desactivada muestra el aviso sin formulario', () => {
    render(<MusicPanel {...baseProps({ settings: { musicEnabled: false } as never })} />);
    expect(screen.getByText(/música está desactivada/i)).toBeDefined();
    expect(screen.queryByPlaceholderText(/enlace de youtube/i)).toBeNull();
  });
});

describe('resolveNowPlayingVideoId', () => {
  it('acepta ID suelto, URL completa y uri', () => {
    expect(resolveNowPlayingVideoId({ trackId: 'PW6ZSzdjrlo' })).toBe('PW6ZSzdjrlo');
    expect(resolveNowPlayingVideoId({ openUrl: 'https://youtu.be/PW6ZSzdjrlo' })).toBe('PW6ZSzdjrlo');
    expect(
      resolveNowPlayingVideoId({ uri: 'https://www.youtube.com/watch?v=PW6ZSzdjrlo' })
    ).toBe('PW6ZSzdjrlo');
  });

  it('null o inválido devuelve vacío', () => {
    expect(resolveNowPlayingVideoId(null)).toBe('');
    expect(resolveNowPlayingVideoId({})).toBe('');
    expect(resolveNowPlayingVideoId({ trackId: 'corto' })).toBe('');
  });
});
