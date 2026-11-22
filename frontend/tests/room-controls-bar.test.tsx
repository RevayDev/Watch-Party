// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomControls } from '../src/features/room/components/RoomControls';

/**
 * Barra inferior estilo referencia: izquierda micro/cámara, centro
 * reacciones+participantes+chat+ocultar, derecha música, al final salir.
 * Etiquetas visibles bajo cada icono + separadores de grupo.
 */

function barProps(overrides: Partial<Record<string, any>> = {}) {
  const noop = vi.fn();
  return {
    isMicOn: true,
    isCameraOn: true,
    toggleMic: noop,
    toggleCamera: noop,
    showEmojiPicker: false,
    setShowEmojiPicker: noop,
    emojiPresence: { shown: false, closing: false },
    emojiSheetRef: { current: null },
    handleReaction: noop,
    activeSideTab: null,
    setActiveSideTab: noop,
    unreadCount: 0,
    isRightPanelCollapsed: false,
    setIsRightPanelCollapsed: noop,
    showMoreMenu: false,
    setShowMoreMenu: noop,
    morePresence: { shown: false, closing: false },
    moreSheetRef: { current: null },
    moreMenuRef: { current: null },
    handleLeaveClick: noop,
    isBarVisible: true,
    uiPinned: true,
    toggleBarsVisibility: noop,
    roomId: 'ABC123',
    musicOpen: false,
    onToggleMusic: vi.fn(),
    ...overrides,
  };
}

describe('RoomControls (orden y etiquetas)', () => {
  it('izquierda micro/cámara, centro reacciones/participantes/chat/ocultar, derecha música, final salir', () => {
    const { container } = render(<RoomControls {...barProps()} />);
    const labels = [...container.querySelectorAll('.meet-bar-label')].map((el) => el.textContent);
    expect(labels).toEqual([
      'Silenciar',
      'Detener video',
      'Reacciones',
      'Participantes',
      'Chat',
      'Ocultar',
      'Música',
      'Salir',
    ]);
  });

  it('separa los grupos con espacio, sin líneas divisorias', () => {
    const { container } = render(<RoomControls {...barProps()} />);
    expect(container.querySelectorAll('.meet-bar-sep')).toHaveLength(0);
  });

  it('agrupa izquierda/centro/derecha/final en orden', () => {
    const { container } = render(<RoomControls {...barProps()} />);
    const groups = [...container.querySelectorAll('.meet-bar-group')].map((el) =>
      [...el.classList].find((c) => c.startsWith('meet-bar-group--'))
    );
    expect(groups).toEqual([
      'meet-bar-group--left',
      'meet-bar-group--social',
      'meet-bar-group--visibility',
      'meet-bar-group--right',
      'meet-bar-group--end',
    ]);
  });

  it('layout spread y sin etiquetas aplican clases al footer', () => {
    const { container } = render(
      <RoomControls {...barProps({ layout: 'spread', showLabels: false })} />
    );
    const footer = container.querySelector('footer');
    expect(footer?.classList.contains('meet-bottom-bar--spread')).toBe(true);
    expect(footer?.classList.contains('meet-bottom-bar--no-labels')).toBe(true);
  });

  it('por defecto repartida con etiquetas (igual que useBarPrefs)', () => {
    const { container } = render(<RoomControls {...barProps()} />);
    const footer = container.querySelector('footer');
    expect(footer?.classList.contains('meet-bottom-bar--spread')).toBe(true);
    expect(footer?.classList.contains('meet-bottom-bar--no-labels')).toBe(false);
  });

  it("layout centered vuelve a la píldora centrada", () => {
    const { container } = render(<RoomControls {...barProps({ layout: 'centered' })} />);
    const footer = container.querySelector('footer');
    expect(footer?.classList.contains('meet-bottom-bar--spread')).toBe(false);
  });

  it('botón Música junto a Salir con su title', () => {
    render(<RoomControls {...barProps()} />);
    expect(screen.getByRole('button', { name: /abrir música/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /salir de la reunión/i })).toBeDefined();
  });

  it('Música abre/cierra el panel (toggle)', () => {
    const onToggleMusic = vi.fn();
    render(<RoomControls {...barProps({ onToggleMusic })} />);
    fireEvent.click(screen.getByRole('button', { name: /abrir música/i }));
    expect(onToggleMusic).toHaveBeenCalledTimes(1);
  });

  it('con el panel abierto el botón ofrece cerrarlo', () => {
    render(<RoomControls {...barProps({ musicOpen: true })} />);
    expect(screen.getByRole('button', { name: /cerrar panel de música/i })).toBeDefined();
  });

  it('etiquetas dinámicas según estado (mic off / cámaras ocultas)', () => {
    const { container } = render(
      <RoomControls {...barProps({ isMicOn: false, isCameraOn: false, isRightPanelCollapsed: true })} />
    );
    const labels = [...container.querySelectorAll('.meet-bar-label')].map((el) => el.textContent);
    expect(labels).toEqual([
      'Activar micrófono',
      'Iniciar video',
      'Reacciones',
      'Participantes',
      'Chat',
      'Mostrar',
      'Música',
      'Salir',
    ]);
  });
});

it('places screen sharing with music and forwards its stop action', () => {
 const toggle = vi.fn(); const { container } = render(<RoomControls {...barProps({ isScreenSharing: true, onToggleScreenShare: toggle })} />);
 const button = screen.getByTitle('Dejar de compartir pantalla');
 expect(button.closest('.meet-bar-group--right')).toBeTruthy();
 expect(button.getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(button); expect(toggle).toHaveBeenCalledTimes(1);
 expect(container.querySelector('.meet-bar-group--end')?.textContent).toContain('Salir');
});
