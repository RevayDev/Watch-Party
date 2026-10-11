// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpotifyListenButton } from '../src/features/room/components/SpotifyListenButton';

/**
 * Botón Spotify del footer: mismo círculo que los demás.
 * - Desconectado o error → onConnect (OAuth en pestaña nueva).
 * - Conectado → toggle del panel (onTogglePanel).
 * El punto indica el estado; cerrar el panel no desconecta.
 */

function baseProps(overrides: Partial<React.ComponentProps<typeof SpotifyListenButton>> = {}) {
  return {
    state: 'disconnected' as const,
    accountName: null,
    panelOpen: false,
    onTogglePanel: vi.fn(),
    onConnect: vi.fn(),
    ...overrides,
  };
}

describe('SpotifyListenButton (footer)', () => {
  it('desconectado muestra punto gris y conecta al pulsar', () => {
    const onConnect = vi.fn();
    const onTogglePanel = vi.fn();
    render(<SpotifyListenButton {...baseProps({ onConnect, onTogglePanel })} />);
    const btn = screen.getByRole('button', { name: /spotify: vincular cuenta/i });
    expect(btn.querySelector('.spotify-status-dot--disconnected')).not.toBeNull();
    fireEvent.click(btn);
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onTogglePanel).not.toHaveBeenCalled();
  });

  it('conectado muestra cuenta y hace toggle del panel', () => {
    const onConnect = vi.fn();
    const onTogglePanel = vi.fn();
    render(
      <SpotifyListenButton
        {...baseProps({ state: 'connected', accountName: 'DjAna', onConnect, onTogglePanel })}
      />
    );
    const btn = screen.getByRole('button', { name: /conectado como DjAna.*abrir panel/i });
    expect(btn.querySelector('.spotify-status-dot--connected')).not.toBeNull();
    fireEvent.click(btn);
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('con panel abierto el botón queda activo y ofrece cerrarlo', () => {
    render(<SpotifyListenButton {...baseProps({ state: 'connected', panelOpen: true })} />);
    expect(screen.getByRole('button', { name: /cerrar panel/i })).toBeDefined();
  });

  it('error muestra punto rojo y reintenta al pulsar', () => {
    const onConnect = vi.fn();
    render(<SpotifyListenButton {...baseProps({ state: 'error', onConnect })} />);
    const btn = screen.getByRole('button', { name: /error de conexión/i });
    expect(btn.querySelector('.spotify-status-dot--error')).not.toBeNull();
    fireEvent.click(btn);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('cargando se deshabilita', () => {
    render(<SpotifyListenButton {...baseProps({ state: 'loading' })} />);
    expect(
      (screen.getByRole('button', { name: /comprobando conexión/i }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
