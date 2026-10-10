// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Chat } from '../src/features/chat/Chat';

/**
 * Icono Spotify abajo del chat (barra de mensaje, lado derecho):
 * vincular cuenta + ambiente sin salir del drawer.
 */

function mockStatus(statusBody: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => statusBody,
    }))
  );
}

const chatProps = (overrides: Partial<Record<string, any>> = {}) => ({
  messages: [],
  onSendMessage: vi.fn(),
  roomId: 'ABC123',
  spotifyOpenUrl: null as string | null,
  canPlayAmbient: true,
  onPlayAmbient: vi.fn(async () => undefined),
  ...overrides,
});

describe('Chat (icono Spotify en la barra de mensaje)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('muestra el botón Spotify junto a Enviar', () => {
    mockStatus({ configured: true, connected: true });
    render(<Chat {...chatProps()} />);
    expect(screen.getByRole('button', { name: /spotify/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /enviar mensaje/i })).toBeDefined();
  });

  it('al presionarlo pone ambiente en la sala (anfitrión vinculado)', async () => {
    mockStatus({ configured: true, connected: true });
    const onPlayAmbient = vi.fn(async () => undefined);
    render(<Chat {...chatProps({ onPlayAmbient })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /spotify/i }));
    });
    await waitFor(() => {
      expect(onPlayAmbient).toHaveBeenCalledTimes(1);
    });
  });

  it('sin props Spotify no muestra el botón (chats antiguos/tests)', () => {
    mockStatus({ configured: true, connected: true });
    render(<Chat messages={[]} onSendMessage={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /spotify/i })).toBeNull();
  });
});
