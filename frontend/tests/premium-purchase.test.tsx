// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { PremiumPurchase } from '../src/features/home/PremiumPurchase';
import { ApiService } from '../src/services/api';

/**
 * Compra inmediata: plan premium con precio, checkout a PayPal y canje
 * de códigos de regalo. Todo con fetch mockeado, sin red.
 */
vi.mock('../src/services/api', () => ({
  ApiService: {
    getPlans: vi.fn(),
    createCheckout: vi.fn(),
    redeemGiftCode: vi.fn(),
  },
}));

const plansMock = vi.mocked(ApiService.getPlans);
const checkoutMock = vi.mocked(ApiService.createCheckout);
const redeemMock = vi.mocked(ApiService.redeemGiftCode);

beforeEach(() => {
  vi.clearAllMocks();
  plansMock.mockResolvedValue({
    plans: [{ id: 'PREMIUM_ROOM', name: 'Sala premium', amount: 5000, currency: 'COP' }],
  });
});

describe('PremiumPurchase', () => {
  it('muestra el plan con precio y el botón de compra', async () => {
    await act(async () => {
      render(<PremiumPurchase />);
    });
    expect(await screen.findByText(/sala premium — 5000 COP/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /comprar ahora/i })).toBeDefined();
  });

  it('comprar abre PayPal y muestra confirmación', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    checkoutMock.mockResolvedValue({
      paymentId: 'pay-1',
      approveUrl: 'https://paypal.example/approve',
      status: 'pending',
    });
    await act(async () => {
      render(<PremiumPurchase />);
    });
    await screen.findByRole('button', { name: /comprar ahora/i });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /comprar ahora/i }));
    });
    await waitFor(() => expect(checkoutMock).toHaveBeenCalledWith({
      provider: 'paypal',
      plan: 'PREMIUM_ROOM',
    }));
    expect(openSpy).toHaveBeenCalledWith(
      'https://paypal.example/approve',
      '_blank',
      expect.anything()
    );
    expect(await screen.findByText(/acceso premium se activa/i)).toBeDefined();
    openSpy.mockRestore();
  });

  it('comprar muestra error legible si falla', async () => {
    checkoutMock.mockRejectedValue(new Error('Proveedor no disponible'));
    await act(async () => {
      render(<PremiumPurchase />);
    });
    await screen.findByRole('button', { name: /comprar ahora/i });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /comprar ahora/i }));
    });
    expect(await screen.findByText(/proveedor no disponible/i)).toBeDefined();
  });

  it('canjear pide código y nombre, y confirma el acceso', async () => {
    redeemMock.mockResolvedValue({ entitlement: { id: 'ent-1' }, duplicate: false });
    await act(async () => {
      render(<PremiumPurchase />);
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/código de regalo/i), {
        target: { value: 'WATCH-AAAA-BBBB' },
      });
      fireEvent.change(screen.getByLabelText(/tu nombre/i), {
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
      fireEvent.change(screen.getByLabelText(/código de regalo/i), {
        target: { value: 'MALO' },
      });
      fireEvent.change(screen.getByLabelText(/tu nombre/i), {
        target: { value: 'Roberto' },
      });
      fireEvent.click(screen.getByRole('button', { name: /canjear/i }));
    });
    expect(await screen.findByText(/código no encontrado/i)).toBeDefined();
  });
});
