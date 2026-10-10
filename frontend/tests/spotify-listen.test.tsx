// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  SpotifyListenButton,
  DEFAULT_AMBIENT_SPOTIFY_URL,
} from '../src/features/room/components/SpotifyListenButton';

/**
 * Botón Spotify del footer (como los demás botones): música ambiente
 * mientras entra la gente + vincular cuenta estilo Instagram (OAuth
 * oficial de Spotify). Siempre visible; al presionarlo:
 * - Sin cuenta vinculada → redirige al OAuth para vincularla.
 * - Vinculada + anfitrión + nada sonando → pone ambiente en la sala.
 * - Vinculada + sonando Spotify → abre lo que suena para escucharlo.
 * - Miembro sin nada sonando → abre el ambiente en su Spotify.
 */

const TRACK = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQ';
const AUTH_URL = 'https://accounts.spotify.com/authorize?x=1';

function mockStatus(statusBody: unknown, authBody: unknown = { authUrl: AUTH_URL }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/spotify/auth-url')) {
        return { ok: true, status: 200, json: async () => authBody };
      }
      return { ok: true, status: 200, json: async () => statusBody };
    })
  );
}

function baseProps(overrides: Partial<Record<string, any>> = {}) {
  return {
    roomId: 'ABC123',
    openUrl: null as string | null,
    canPlayAmbient: true,
    onPlayAmbient: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('SpotifyListenButton (footer, siempre visible)', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    openSpy.mockRestore();
  });

  it('se muestra aunque no haya fuente Spotify', () => {
    mockStatus({ configured: true, connected: true });
    render(<SpotifyListenButton {...baseProps()} />);
    expect(screen.getByRole('button', { name: /spotify/i })).toBeDefined();
  });

  it('sin vincular redirige al OAuth para vincular la cuenta', async () => {
    mockStatus({ configured: true, connected: false });
    render(<SpotifyListenButton {...baseProps()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /spotify/i }));
    });
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(AUTH_URL, '_self');
    });
  });

  it('vinculada + anfitrión + nada sonando pone ambiente en la sala', async () => {
    mockStatus({ configured: true, connected: true });
    const onPlayAmbient = vi.fn(async () => undefined);
    render(<SpotifyListenButton {...baseProps({ onPlayAmbient })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /spotify/i }));
    });
    await waitFor(() => {
      expect(onPlayAmbient).toHaveBeenCalledTimes(1);
    });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('vinculada + sonando Spotify abre lo que suena en pestaña nueva', async () => {
    mockStatus({ configured: true, connected: true });
    const onPlayAmbient = vi.fn(async () => undefined);
    render(<SpotifyListenButton {...baseProps({ openUrl: TRACK, onPlayAmbient })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /spotify/i }));
    });
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(TRACK, '_blank');
    });
    expect(onPlayAmbient).not.toHaveBeenCalled();
  });

  it('miembro sin nada sonando abre el ambiente en su Spotify', async () => {
    mockStatus({ configured: true, connected: true });
    render(<SpotifyListenButton {...baseProps({ canPlayAmbient: false })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /spotify/i }));
    });
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(DEFAULT_AMBIENT_SPOTIFY_URL, '_blank');
    });
  });

  it('sin OAuth en el servidor igual pone ambiente (el embed es público)', async () => {
    mockStatus({ configured: false, connected: false });
    const onPlayAmbient = vi.fn(async () => undefined);
    render(<SpotifyListenButton {...baseProps({ onPlayAmbient })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /spotify/i }));
    });
    await waitFor(() => {
      expect(onPlayAmbient).toHaveBeenCalledTimes(1);
    });
  });

  it('si falla poner ambiente abre el enlace como respaldo', async () => {
    mockStatus({ configured: true, connected: true });
    const onPlayAmbient = vi.fn(async () => {
      throw new Error('403');
    });
    render(<SpotifyListenButton {...baseProps({ onPlayAmbient })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /spotify/i }));
    });
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(DEFAULT_AMBIENT_SPOTIFY_URL, '_blank');
    });
  });
});
