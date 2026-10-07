// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { PremiumPurchase } from '../src/features/home/PremiumPurchase';
import { ApiService } from '../src/services/api';

/**
 * Compra inmediata por niveles: tarjetas con precio/capacidad/duración,
 * botón por nivel hacia la pasarela y canje de códigos de regalo.
 * Todo con fetch mockeado, sin red.
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

const TIERS = {
  plans: [
    { id: 'INMEDIATA', name: 'Sala Inmediata', amount: 5000, currency: 'COP', maxUsers: 10, durationHours: 3, tagline: 'Ya mismo' },
    { id: 'ESTANDAR', name: 'Sala Estándar', amount: 3000, currency: 'COP', maxUsers: 5, durationHours: 2, tagline: 'Clásica' },
    { id: 'PLUS', name: 'Sala Plus', amount: 8000, currency: 'COP', maxUsers: 15, durationHours: 5, tagline: 'Maratón' },
  ],
};

function fillBuyerName(name: string) {
  fireEvent.change(screen.getByLabelText(/para asociar la compra/i), {
    target: { value: name },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  plansMock.mockResolvedValue(TIERS);
});

describe('PremiumPurchase', () => {
  it('muestra los tres niveles con precio, capacidad y duración', async () => {
    await act(async () => {
      render(<PremiumPurchase />);
    });
    expect(await screen.findByText(/sala inmediata — 5000 COP/i)).toBeDefined();
    expect(screen.getByText(/sala estándar — 3000 COP/i)).toBeDefined();
    expect(screen.getByText(/sala plus — 8000 COP/i)).toBeDefined();
    expect(screen.getByText(/hasta 10 personas/i)).toBeDefined();
    expect(screen.getByText(/3 horas por sala/i)).toBeDefined();
    expect(screen.getAllByRole('button', { name: /comprar ahora/i })).toHaveLength(3);
  });

  it('comprar pide el nombre antes de llamar al checkout', async () => {
    await act(async () => {
      render(<PremiumPurchase />);
    });
    await screen.findAllByRole('button', { name: /comprar ahora/i });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /comprar ahora/i })[0]);
    });
    expect(await screen.findByText(/escribe tu nombre/i)).toBeDefined();
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it('comprar un nivel abre PayPal y muestra confirmación', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    checkoutMock.mockResolvedValue({
      paymentId: 'pay-1',
      approveUrl: 'https://paypal.example/approve',
      status: 'pending',
    });
    await act(async () => {
      render(<PremiumPurchase />);
    });
    await screen.findAllByRole('button', { name: /comprar ahora/i });
    fillBuyerName('Roberto');
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /comprar ahora/i })[1]);
    });
    await waitFor(() => expect(checkoutMock).toHaveBeenCalledWith({
      provider: 'paypal',
      plan: 'ESTANDAR',
      userId: 'Roberto',
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
    await screen.findAllByRole('button', { name: /comprar ahora/i });
    fillBuyerName('Roberto');
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /comprar ahora/i })[0]);
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
      fireEvent.change(screen.getByLabelText(/^tu nombre$/i), {
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
      fireEvent.change(screen.getByLabelText(/^tu nombre$/i), {
        target: { value: 'Roberto' },
      });
      fireEvent.click(screen.getByRole('button', { name: /canjear/i }));
    });
    expect(await screen.findByText(/código no encontrado/i)).toBeDefined();
  });
});
