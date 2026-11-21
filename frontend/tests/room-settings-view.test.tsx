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

it('includes devices and external server as sections of the shared settings', () => {
  render(<RoomSettingsModal {...modalProps()} localStream={null} onRetryMedia={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Servidor' }));
  expect(screen.getByText('Servidor externo')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Micrófono y cámara' }));
  expect(screen.getByRole('region', { name: 'Prueba de cámara' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Probar micrófono' })).toBeTruthy();
});

describe('RoomSettingsModal (Tu vista de la barra)', () => {
  it('muestra las pestañas y la sección personal tras pulsar Barra', async () => {
    render(<RoomSettingsModal {...modalProps()} />);
    for (const t of ['General', 'Apariencia', 'Rendimiento']) {
      expect(screen.getByRole('tab', { name: t })).toBeDefined();
    }
    expect(screen.queryByRole('tab', { name: 'Música' })).toBeNull();
    // La barra no se ve hasta pulsar su pestaña.
    expect(screen.queryByText(/tu vista de la barra/i)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Apariencia' }));
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
      fireEvent.click(screen.getByRole('tab', { name: 'Apariencia' }));
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
      fireEvent.click(screen.getByRole('tab', { name: 'Apariencia' }));
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

describe('RoomSettingsModal (sin pestaña de Música)', () => {
  function baseProps(overrides: Partial<Record<string, any>> = {}) {
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
      onUpdatePerf: vi.fn(),
      ...overrides,
    };
  }

  it('solo ofrece General, Barra y Rendimiento', () => {
    render(<RoomSettingsModal {...baseProps()} />);
    for (const t of ['General', 'Apariencia', 'Rendimiento']) {
      expect(screen.getByRole('tab', { name: t })).toBeDefined();
    }
    expect(screen.queryByRole('tab', { name: 'Música' })).toBeNull();
    expect(screen.queryByText('Cola de canciones')).toBeNull();
  });
});
