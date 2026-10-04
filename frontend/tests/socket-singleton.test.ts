import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ioMock = vi.fn();

// socket.io-client mockeado: sin red, sin jsdom extra (jsdom ya es el
// environment del proyecto frontend).
vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

function fakeSocketInstance() {
  return { disconnect: vi.fn(), id: 'sock-1' };
}

beforeEach(() => {
  vi.resetModules();
  ioMock.mockReset();
  ioMock.mockImplementation(() => fakeSocketInstance());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('services/socket: singleton', () => {
  it('getSocket crea una sola instancia aunque se llame varias veces', async () => {
    const { getSocket } = await import('../src/services/socket');
    const a = getSocket();
    const b = getSocket();
    expect(a).toBe(b);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it('usa import.meta.env con fallback a hostname:4000', async () => {
    const { getSocket } = await import('../src/services/socket');
    getSocket();
    expect(ioMock).toHaveBeenCalledTimes(1);
    const [url, opts] = ioMock.mock.calls[0] as [string, Record<string, unknown>];
    // Sin VITE_SOCKET_URL/VITE_API_URL en el entorno de test → fallback local.
    expect(url).toBe(`http://${window.location.hostname || 'localhost'}:4000`);
    expect(opts).toMatchObject({ transports: ['websocket', 'polling'] });
  });

  it('disconnectSocket desconecta y la próxima llamada crea instancia nueva', async () => {
    const { getSocket, disconnectSocket } = await import('../src/services/socket');
    const first = getSocket() as unknown as { disconnect: ReturnType<typeof vi.fn> };
    disconnectSocket();
    expect(first.disconnect).toHaveBeenCalledTimes(1);

    const second = getSocket();
    expect(second).not.toBe(first);
    expect(ioMock).toHaveBeenCalledTimes(2);
  });

  it('disconnectSocket sin instancia previa no lanza', async () => {
    const { disconnectSocket } = await import('../src/services/socket');
    expect(() => disconnectSocket()).not.toThrow();
  });
});
