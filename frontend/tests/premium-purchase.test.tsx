// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { PremiumPurchase } from '../src/features/home/PremiumPurchase';
import { ApiService } from '../src/services/api';

/**
 * Canje de códigos: solo pide el código; el acceso se liga al userId
 * estable del navegador (el mismo que usan crear/unirse a salas, así el
 * premium aplica automáticamente). Todo con fetch mockeado, sin red.
 */
vi.mock('../src/services/api', () => ({
  ApiService: {
    redeemGiftCode: vi.fn(),
  },
}));

const redeemMock = vi.mocked(ApiService.redeemGiftCode);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('PremiumPurchase (canje)', () => {
  it('muestra subtítulo y un solo campo de código con botón primario', async () => {
    await act(async () => {
      render(<PremiumPurchase />);
    });
    expect(screen.getByText(/¿Tienes un código de regalo\?/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/código de regalo/i)).toBeDefined();
    expect(screen.queryByPlaceholderText(/tu nombre/i)).toBeNull();
    expect(
      screen.getByRole('button', { name: /canjear/i }).className
    ).toContain('home-hero-btn--primary');
  });

  it('canjea con el userId estable del navegador y confirma el acceso', async () => {
    redeemMock.mockResolvedValue({ entitlement: { id: 'ent-1' }, duplicate: false });
    await act(async () => {
      render(<PremiumPurchase />);
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/código de regalo/i), {
        target: { value: 'WATCH-AAAA-BBBB' },
      });
      fireEvent.click(screen.getByRole('button', { name: /canjear/i }));
    });
    await waitFor(() => expect(redeemMock).toHaveBeenCalledTimes(1));
    const payload = redeemMock.mock.calls[0][0] as { code: string; userId?: string };
    expect(payload.code).toBe('WATCH-AAAA-BBBB');
    expect(typeof payload.userId).toBe('string');
    expect(payload.userId!.length).toBeGreaterThan(0);
    // Mismo userId en dos canjes (estable por navegador)
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/código de regalo/i), {
        target: { value: 'WATCH-CCCC-DDDD' },
      });
      fireEvent.click(screen.getByRole('button', { name: /canjear/i }));
    });
    await waitFor(() => expect(redeemMock).toHaveBeenCalledTimes(2));
    const second = redeemMock.mock.calls[1][0] as { userId?: string };
    expect(second.userId).toBe(payload.userId);
    expect(await screen.findByText(/acceso premium ya está activo/i)).toBeDefined();
  });

  it('sin código muestra error sin llamar a la API', async () => {
    await act(async () => {
      render(<PremiumPurchase />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /canjear/i }));
    });
    expect(await screen.findByText(/escribe el código/i)).toBeDefined();
    expect(redeemMock).not.toHaveBeenCalled();
  });

  it('código inválido muestra el error del servidor', async () => {
    redeemMock.mockRejectedValue(new Error('Código no encontrado.'));
    await act(async () => {
      render(<PremiumPurchase />);
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/código de regalo/i), {
        target: { value: 'MALO' },
      });
      fireEvent.click(screen.getByRole('button', { name: /canjear/i }));
    });
    expect(await screen.findByText(/código no encontrado/i)).toBeDefined();
  });
});
