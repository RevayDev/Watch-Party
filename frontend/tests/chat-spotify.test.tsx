// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Chat } from '../src/features/chat/Chat';

/**
 * Icono Spotify en la barra del chat: abre el panel musical o conecta,
 * igual que el del footer (sin poner nada en la sala).
 */

const chatProps = (overrides: Partial<Record<string, any>> = {}) => ({
  messages: [],
  onSendMessage: vi.fn(),
  roomId: 'ABC123',
  spotifyState: 'connected',
  musicOpen: false,
  onOpenMusic: vi.fn(),
  onSpotifyConnect: vi.fn(),
  ...overrides,
});

describe('Chat (icono Spotify en la barra de mensaje)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('muestra el botón Spotify junto a Enviar', () => {
    render(<Chat {...chatProps()} />);
    expect(screen.getByRole('button', { name: /música.*abrir panel/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /enviar mensaje/i })).toBeDefined();
  });

  it('conectado abre el panel musical al pulsarlo', async () => {
    const onOpenMusic = vi.fn();
    render(<Chat {...chatProps({ onOpenMusic })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /música.*abrir panel/i }));
    });
    expect(onOpenMusic).toHaveBeenCalledTimes(1);
  });

  it('desconectado inicia la conexión al pulsarlo', async () => {
    const onSpotifyConnect = vi.fn();
    render(<Chat {...chatProps({ spotifyState: 'disconnected', onSpotifyConnect })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /spotify: vincular cuenta/i }));
    });
    expect(onSpotifyConnect).toHaveBeenCalledTimes(1);
  });

  it('sin roomId no muestra el botón (chats antiguos/tests)', () => {
    const { roomId: _drop, ...rest } = chatProps();
    render(<Chat messages={[]} onSendMessage={vi.fn()} {...rest} roomId={undefined} />);
    expect(screen.queryByRole('button', { name: /música/i })).toBeNull();
  });
});
