// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { PremiumPurchase } from '../src/features/home/PremiumPurchase';
import { ApiService } from '../src/services/api';

/**
 * Canje de códigos de regalo: formulario centrado con código + nombre.
 * Todo con fetch mockeado, sin red.
 */
vi.mock('../src/services/api', () => ({
  ApiService: {
    redeemGiftCode: vi.fn(),
  },
}));

const redeemMock = vi.mocked(ApiService.redeemGiftCode);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PremiumPurchase (canje)', () => {
  it('muestra subtítulo, formulario centrado y botón acorde al diseño', async () => {
    await act(async () => {
      render(<PremiumPurchase />);
    });
    expect(screen.getByText(/¿Tienes un código de regalo\?/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/código de regalo/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/tu nombre/i)).toBeDefined();
    // Nombre primero (posiciones invertidas) y botón primario del diseño
    const inputs = document.querySelectorAll('.home-buy__redeem input');
    expect(inputs[0].getAttribute('aria-label')).toBe('Tu nombre');
    expect(inputs[1].getAttribute('aria-label')).toBe('Código de regalo');
    expect(
      screen.getByRole('button', { name: /canjear/i }).className
    ).toContain('home-hero-btn--primary');
  });

  it('canjear pide código y nombre, y confirma el acceso', async () => {
    redeemMock.mockResolvedValue({ entitlement: { id: 'ent-1' }, duplicate: false });
    await act(async () => {
      render(<PremiumPurchase />);
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/código de regalo/i), {
        target: { value: 'WATCH-AAAA-BBBB' },
      });
      fireEvent.change(screen.getByPlaceholderText(/tu nombre/i), {
        target: { value: 'Roberto' },
      });
      fireEvent.click(screen.getByRole('button', { name: /canjear/i }));
    });
    await waitFor(() => expect(redeemMock).toHaveBeenCalledWith({
      code: 'WATCH-AAAA-BBBB',
      userName: 'Roberto',
    }));
    expect(await screen.findByText(/acceso premium ya está activo/i)).toBeDefined();
  });

  it('canjear sin datos muestra error sin llamar a la API', async () => {
    await act(async () => {
      render(<PremiumPurchase />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /canjear/i }));
    });
    expect(await screen.findByText(/escribe el código/i)).toBeDefined();
    expect(redeemMock).not.toHaveBeenCalled();
  });

  it('canjear código inválido muestra el error del servidor', async () => {
    redeemMock.mockRejectedValue(new Error('Código no encontrado.'));
    await act(async () => {
      render(<PremiumPurchase />);
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/código de regalo/i), {
        target: { value: 'MALO' },
      });
      fireEvent.change(screen.getByPlaceholderText(/tu nombre/i), {
        target: { value: 'Roberto' },
      });
      fireEvent.click(screen.getByRole('button', { name: /canjear/i }));
    });
    expect(await screen.findByText(/código no encontrado/i)).toBeDefined();
  });
});
