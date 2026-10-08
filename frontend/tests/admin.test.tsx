// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AdminPage } from '../src/features/admin/AdminPage';

const SUMMARY = {
  rooms: { live: 2 },
  payments: { total: 3, byStatus: { completed: 2, pending: 1 } },
  giftCodes: { total: 4, active: 3 },
  entitlements: { active: 5 },
};

const now = new Date();
const PAYMENTS = {
  payments: [
    {
      id: 'pay_aaa',
      provider: 'paypal',
      providerOrderId: 'ORD-1',
      planId: 'PREMIUM_ROOM',
      amount: 5000,
      currency: 'COP',
      status: 'completed',
      stub: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: 'pay_bbb',
      provider: 'paypal',
      providerOrderId: 'ORD-2',
      planId: 'PREMIUM_ROOM',
      amount: 5000,
      currency: 'COP',
      status: 'pending',
      stub: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ],
};

function stubFetch(handler: (url: string) => { ok: boolean; status: number; body: unknown }) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const r = handler(url);
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.body,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('/admin privado', () => {
  it('exige login: no pide nada a la API antes del token', async () => {
    const { fn } = stubFetch(() => ({ ok: true, status: 200, body: SUMMARY }));
    await act(async () => {
      render(<AdminPage onBack={() => undefined} />);
    });
    expect(screen.getByTestId('admin-token-input')).toBeDefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it('tras login muestra ingresos (solo admin) sin persistir el token', async () => {
    stubFetch((url) => {
      if (url.includes('/api/admin/payments')) return { ok: true, status: 200, body: PAYMENTS };
      return { ok: true, status: 200, body: SUMMARY };
    });
    await act(async () => {
      render(<AdminPage onBack={() => undefined} />);
    });

    fireEvent.change(screen.getByTestId('admin-token-input'), { target: { value: 'tok-123' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Entrar'));
    });

    // Ingresos calculados en cliente: 1 completado de 5000 hoy
    await waitFor(() => expect(screen.getByText(/Ingresos \(solo admin\)/)).toBeDefined());
    await waitFor(() => expect(screen.getAllByText(/5\.000/).length).toBeGreaterThan(0));

    // Token JAMÁS en localStorage (solo memoria React)
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i) as string;
      expect(window.localStorage.getItem(key)).not.toContain('tok-123');
    }
  });

  it('con 503 muestra mensaje claro de ADMIN_TOKEN ausente', async () => {
    stubFetch(() => ({
      ok: false,
      status: 503,
      body: { error: 'Administración no configurada: falta ADMIN_TOKEN en el servidor.' },
    }));
    await act(async () => {
      render(<AdminPage onBack={() => undefined} />);
    });
    fireEvent.change(screen.getByTestId('admin-token-input'), { target: { value: 'x' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Entrar'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-login-error')).toHaveTextContent(/ADMIN_TOKEN/)
    );
  });

  it('pestaña de códigos: etiquetas visibles y botón de copiar por código', async () => {
    const CODES = {
      codes: [
        {
          code: 'WATCH-AAAA-BBBB',
          type: 'PREMIUM_ROOM',
          uses: 1,
          maxUses: 10,
          status: 'active',
          expiresAt: null,
        },
      ],
    };
    stubFetch((url) => {
      if (url.includes('/api/admin/gift-codes')) return { ok: true, status: 200, body: CODES };
      if (url.includes('/api/admin/audit')) return { ok: true, status: 200, body: { entries: [] } };
      if (url.includes('/api/admin/payments')) return { ok: true, status: 200, body: PAYMENTS };
      return { ok: true, status: 200, body: SUMMARY };
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    await act(async () => {
      render(<AdminPage onBack={() => undefined} />);
    });
    fireEvent.change(screen.getByTestId('admin-token-input'), { target: { value: 'tok-123' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Entrar'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'GiftCodes' }));
    });

    // Etiquetas visibles en cada campo (el th "Tipo" de la tabla también coincide)
    await waitFor(() => expect(screen.getAllByText('Tipo').length).toBeGreaterThanOrEqual(1));
    const form = document.querySelector('.admin-gift-form');
    expect(form?.textContent).toContain('Tipo');
    expect(form?.textContent).toContain('Usos máximos');
    expect(form?.textContent).toContain('Expira en días');

    // Copiar código al portapapeles
    await waitFor(() => expect(screen.getByText('WATCH-AAAA-BBBB')).toBeDefined());
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Copiar código WATCH-AAAA-BBBB'));
    });
    expect(writeText).toHaveBeenCalledWith('WATCH-AAAA-BBBB');
    await waitFor(() =>
      expect(screen.getByLabelText('¡Copiado!')).toBeDefined()
    );
  });
});
