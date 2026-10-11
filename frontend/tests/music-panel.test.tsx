// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MusicPanel } from '../src/features/room/components/MusicPanel';

function baseProps(overrides: Partial<React.ComponentProps<typeof MusicPanel>> = {}) {
  const noop = vi.fn();
  return {
    roomId: 'ABC123',
    queue: [],
    nowPlaying: null,
    settings: { musicEnabled: true } as never,
    isModerator: false,
    myName: 'Ana',
    spotifyConnected: true,
    onSearch: async () => [],
    onAdd: noop,
    onVote: noop,
    onRemove: noop,
    onReorder: noop,
    onApprove: noop,
    onNext: noop,
    onStop: noop,
    onConnect: noop,
    onDisconnect: noop,
    ...overrides,
  };
}

describe('MusicPanel (cuenta y desvincular)', () => {
  it('muestra la cuenta vinculada', () => {
    render(<MusicPanel {...baseProps({ accountName: 'DjAna' })} />);
    expect(screen.getByText(/conectado como DjAna/i)).toBeDefined();
  });

  it('desvincular llama onDisconnect', () => {
    const onDisconnect = vi.fn();
    render(<MusicPanel {...baseProps({ onDisconnect })} />);
    fireEvent.click(screen.getByText('Desvincular'));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('error de conexión ofrece vincular de nuevo', () => {
    const onConnect = vi.fn();
    render(<MusicPanel {...baseProps({ spotifyConnected: false, spotifyError: true, onConnect })} />);
    expect(screen.getByText(/error de conexión/i)).toBeDefined();
    fireEvent.click(screen.getByText('Vincular de nuevo'));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('sin servidor configurado lo indica sin botón', () => {
    render(<MusicPanel {...baseProps({ spotifyConnected: false, spotifyConfigured: false })} />);
    expect(screen.getByText(/no está configurado/i)).toBeDefined();
    expect(screen.queryByText('Conectar')).toBeNull();
  });

  it('muestra el estado informativo de letra (sin proveedor)', () => {
    render(<MusicPanel {...baseProps()} />);
    expect(screen.getByText(/sin proveedor de letras/i)).toBeDefined();
  });

  it('cuenta propia vinculada muestra nombre y desvincula', () => {
    const onUnlinkSelf = vi.fn();
    render(
      <MusicPanel {...baseProps({ selfLinked: true, selfAccount: 'Yo Mismo', onUnlinkSelf })} />
    );
    expect(screen.getByText(/vinculada como Yo Mismo/i)).toBeDefined();
    fireEvent.click(screen.getByText('Desvincular mi cuenta'));
    expect(onUnlinkSelf).toHaveBeenCalledTimes(1);
  });

  it('sin cuenta propia pide el Client ID y vincula', () => {
    const onSaveSelfClientId = vi.fn();
    const onConnectSelf = vi.fn();
    render(<MusicPanel {...baseProps({ onSaveSelfClientId, onConnectSelf })} />);
    fireEvent.change(screen.getByLabelText('Tu Client ID de Spotify'), {
      target: { value: 'mi-client-id' },
    });
    fireEvent.click(screen.getByText('Vincular mi cuenta'));
    expect(onSaveSelfClientId).toHaveBeenCalledWith('mi-client-id');
    expect(onConnectSelf).toHaveBeenCalledTimes(1);
  });
});
