// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { Home } from '../src/features/home/Home';
import { ApiService } from '../src/services/api';

/**
 * Home en demo: badge/título "DEMO GRATUITA", contador desde
 * `GET /api/demo/availability` (mockeado) y aviso de enlace externo.
 * Si la lectura falla, el contador se oculta sin romper el Home.
 */
vi.mock('../src/services/api', () => ({
  ApiService: {
    getDemoAvailability: vi.fn(),
    createRoom: vi.fn(),
    getPlans: vi.fn(),
    createCheckout: vi.fn(),
    redeemGiftCode: vi.fn(),
  },
  BACKEND_BASE: '',
}));

const availabilityMock = vi.mocked(ApiService.getDemoAvailability);
const plansMock = vi.mocked(ApiService.getPlans);

function stubMatchMedia() {
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
}

const homeProps = {
  initialRoomCode: null,
  onJoinRoom: vi.fn(),
  onRoomCreated: vi.fn(),
  onReconnectHost: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  stubMatchMedia();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Home en demo', () => {
  it('muestra badge DEMO, contador de salas y aviso de enlace externo', async () => {
    availabilityMock.mockResolvedValue({ roomsUsed: 2, roomsTotal: 5, roomsAvailable: 3 });
    plansMock.mockResolvedValue({
      plans: [{ id: 'PREMIUM_ROOM', name: 'Sala premium', amount: 5000, currency: 'COP' }],
    });
    await act(async () => {
      render(<Home {...homeProps} />);
    });

    expect(screen.getByTestId('demo-badge')).toHaveTextContent(/demo gratuita/i);
    const counter = await screen.findByTestId('demo-availability');
    expect(counter).toHaveTextContent('2 de 5 salas en uso / 3 disponibles');
    expect(screen.getByTestId('demo-drive-notice')).toHaveTextContent(/google drive/i);
    // La entrada por código sigue igual que hoy
    expect(screen.getByText('Ingresar con código')).toBeDefined();
  });

  it('si availability falla, oculta el contador sin romper el Home', async () => {
    availabilityMock.mockRejectedValue(new Error('network down'));
    plansMock.mockRejectedValue(new Error('network down'));
    await act(async () => {
      render(<Home {...homeProps} />);
    });

    await waitFor(() => expect(availabilityMock).toHaveBeenCalled());
    // Da un tick al catch → setState(null)
    await waitFor(() => expect(screen.queryByTestId('demo-availability')).toBeNull());
    // El resto del Home sigue intacto
    expect(screen.getByTestId('demo-badge')).toBeDefined();
    expect(screen.getByTestId('demo-drive-notice')).toBeDefined();
    expect(screen.getByText('Crear una sala multimedia')).toBeDefined();
  });

  it('con VITE_DEMO_MODE=false no muestra nada demo ni consulta availability', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    await act(async () => {
      render(<Home {...homeProps} />);
    });

    expect(screen.queryByTestId('demo-badge')).toBeNull();
    expect(screen.queryByTestId('demo-availability')).toBeNull();
    expect(screen.queryByTestId('demo-drive-notice')).toBeNull();
    expect(availabilityMock).not.toHaveBeenCalled();
  });
});
