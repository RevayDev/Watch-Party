// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RoomDrawer } from '../src/features/room/components/RoomDrawer';

/* Paneles pesados fuera: solo importa el encabezado por sección */
vi.mock('../src/features/chat/Chat', () => ({
  Chat: () => <div data-testid="panel-chat" />,
}));
vi.mock('../src/features/participants/Participants', () => ({
  Participants: () => <div data-testid="panel-participants" />,
}));
vi.mock('../src/features/room/components/MusicPanel', () => ({
  MusicPanel: () => <div data-testid="panel-music" />,
}));

function drawerProps(overrides: Partial<React.ComponentProps<typeof RoomDrawer>> = {}) {
  const noop = vi.fn();
  return {
    activeSideTab: 'chat' as const,
    sideTabView: 'chat' as const,
    setActiveSideTab: noop,
    messages: [],
    handleSendMessage: noop,
    handleEditMessage: noop,
    typingUsers: [],
    onTyping: noop,
    myName: 'Ana',
    roomData: {
      roomId: 'ABC123',
      leaderName: 'Ana',
      status: 'active',
      participants: [{ name: 'Ana', isLeader: true, role: 'leader', joinedAt: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
    } as never,
    userId: 'u1',
    isLeader: true,
    peerMediaStates: {},
    isMicOn: false,
    isCameraOn: false,
    toggleMic: noop,
    toggleCamera: noop,
    socket: { emit: noop } as never,
    roomId: 'ABC123',
    musicQueue: [],
    ...overrides,
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe('RoomDrawer (solo título de la sección, sin pestañas)', () => {
  it('en chat muestra solo "Chat" sin pestañas', () => {
    const { container } = render(<RoomDrawer {...drawerProps()} />);
    expect(screen.getByText('Chat')).toBeDefined();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.queryByText(/participantes/i)).toBeNull();
    expect(screen.queryByText(/música/i)).toBeNull();
    expect(screen.getByTestId('panel-chat')).toBeDefined();
  });

  it('en participantes muestra el conteo sin pestañas', () => {
    render(<RoomDrawer {...drawerProps({ activeSideTab: 'participants', sideTabView: 'participants' })} />);
    expect(screen.getByText('Participantes (1)')).toBeDefined();
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.getByTestId('panel-participants')).toBeDefined();
  });

  it('en música muestra título, contador de cola y X', () => {
    render(
      <RoomDrawer
        {...drawerProps({
          activeSideTab: 'music',
          sideTabView: 'music',
          musicQueue: [{ id: 'q1' }] as never,
        })}
      />
    );
    expect(screen.getByText('Música')).toBeDefined();
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.getByTestId('panel-music')).toBeDefined();
  });

  it('en música el drawer es ancho como en participantes', () => {
    const { container: chat } = render(<RoomDrawer {...drawerProps()} />);
    expect(chat.querySelector('.meet-drawer--wide')).toBeNull();
    const { container: music } = render(
      <RoomDrawer {...drawerProps({ activeSideTab: 'music', sideTabView: 'music' })} />
    );
    expect(music.querySelector('.meet-drawer--wide')).not.toBeNull();
  });

  it('la X cierra el panel', async () => {
    const setActiveSideTab = vi.fn();
    render(<RoomDrawer {...drawerProps({ setActiveSideTab })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cerrar panel/i }));
    });
    expect(setActiveSideTab).toHaveBeenCalledWith(null);
  });
});
