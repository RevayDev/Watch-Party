// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RoomSettingsModal } from '../src/components/RoomSettingsModal';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

/**
 * Sección "Tu vista de la barra": gusto personal, solo local.
 * Cambia switches sin emitir nada a la sala (sin onUpdatePerf).
 */

function modalProps(overrides: Partial<Record<string, any>> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    isTemporary: true,
    onToggleTemporary: vi.fn(),
    roomName: 'Sala',
    roomDescription: '',
    onSaveDetails: vi.fn(),
    onSetTimer: vi.fn(),
    canEdit: true,
    barShowLabels: true,
    barLayout: 'spread' as const,
    onBarPrefsChange: vi.fn(),
    onUpdatePerf: vi.fn(),
    ...overrides,
  };
}

describe('RoomSettingsModal (Tu vista de la barra)', () => {
  it('muestra las pestañas y la sección personal tras pulsar Barra', async () => {
    render(<RoomSettingsModal {...modalProps()} />);
    for (const t of ['General', 'Música', 'Barra', 'Rendimiento']) {
      expect(screen.getByRole('tab', { name: t })).toBeDefined();
    }
    // La barra no se ve hasta pulsar su pestaña.
    expect(screen.queryByText(/tu vista de la barra/i)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Barra' }));
    });
    expect(screen.getByText(/tu vista de la barra/i)).toBeDefined();
    expect(screen.getByText(/textos bajo los iconos/i)).toBeDefined();
    expect(screen.getByText(/barra distribuida en pc/i)).toBeDefined();
  });

  it('apagar textos llama onBarPrefsChange sin tocar la sala', async () => {
    const onBarPrefsChange = vi.fn();
    const onUpdatePerf = vi.fn();
    render(<RoomSettingsModal {...modalProps({ onBarPrefsChange, onUpdatePerf })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Barra' }));
    });
    const checkbox = screen.getByTitle(/muestra u oculta los textos/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(onBarPrefsChange).toHaveBeenCalledWith({ showLabels: false });
    expect(onUpdatePerf).not.toHaveBeenCalled();
  });

  it('cambiar a centrada llama onBarPrefsChange sin tocar la sala', async () => {
    const onBarPrefsChange = vi.fn();
    const onUpdatePerf = vi.fn();
    render(<RoomSettingsModal {...modalProps({ onBarPrefsChange, onUpdatePerf })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Barra' }));
    });
    const checkbox = screen.getByTitle(/reparte izquierda\/centro\/derecha/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(onBarPrefsChange).toHaveBeenCalledWith({ layout: 'centered' });
    expect(onUpdatePerf).not.toHaveBeenCalled();
  });
});

describe('RoomSettingsModal (Música por secciones)', () => {
  function musicProps(overrides: Partial<Record<string, any>> = {}) {
    return {
      isOpen: true,
      onClose: vi.fn(),
      isTemporary: true,
      onToggleTemporary: vi.fn(),
      roomName: 'Sala',
      roomDescription: '',
      onSaveDetails: vi.fn(),
      onSetTimer: vi.fn(),
      canEdit: true,
      roomId: 'ABC123',
      onUpdatePerf: vi.fn(),
      ...overrides,
    };
  }

  it('muestra las sub-secciones Cola, Permisos, Límites y Conexión', async () => {
    render(<RoomSettingsModal {...musicProps()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Música' }));
    });
    for (const h of ['Cola de canciones', 'Permisos', 'Límites', 'Conexión']) {
      expect(screen.getByText(h)).toBeDefined();
    }
  });

  it('los selects van apilados con su etiqueta accesible y emiten', async () => {
    const onUpdatePerf = vi.fn();
    render(<RoomSettingsModal {...musicProps({ onUpdatePerf })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Música' }));
    });
    const sel = screen.getByLabelText('Quién puede proponer') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(sel, { target: { value: 'moderator' } });
    });
    expect(onUpdatePerf).toHaveBeenCalledWith({ musicCanAdd: 'moderator' });
    expect(screen.getByLabelText('Orden de la cola')).toBeDefined();
    expect(screen.getByLabelText('Quién puede quitar')).toBeDefined();
    expect(screen.getByLabelText('Máximo por persona')).toBeDefined();
  });

  it('Conectar abre el OAuth en pestaña nueva sin perder el modal', async () => {
    const location = { href: '' };
    const openSpy = vi.spyOn(window, 'open').mockImplementation(
      () => ({ closed: false, location }) as unknown as Window
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ authUrl: 'https://accounts.spotify.com/authorize?x=1' }),
      }))
    );
    render(<RoomSettingsModal {...musicProps()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Música' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Conectar'));
    });
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank', 'noopener,noreferrer');
    await act(async () => {
      await Promise.resolve();
    });
    expect(location.href).toBe('https://accounts.spotify.com/authorize?x=1');
    // El modal sigue abierto.
    expect(screen.getByText('Música y Spotify')).toBeDefined();
    openSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
