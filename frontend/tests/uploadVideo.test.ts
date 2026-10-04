import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiService } from '../src/services/api';

class MockXMLHttpRequest {
  static current: MockXMLHttpRequest | null = null;
  public upload = {
    addEventListener: vi.fn((event: string, cb: any) => {
      this.uploadListeners[event] = this.uploadListeners[event] || [];
      this.uploadListeners[event].push(cb);
    }),
  };
  public status = 200;
  public responseText = '';
  public open = vi.fn();
  public setRequestHeader = vi.fn();
  public send = vi.fn();

  private listeners: Record<string, ((...args: any[]) => void)[]> = {};
  private uploadListeners: Record<string, ((...args: any[]) => void)[]> = {};

  constructor() {
    MockXMLHttpRequest.current = this;
  }

  addEventListener(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  trigger(event: string, ...args: any[]) {
    if (this.listeners[event]) {
      for (const cb of this.listeners[event]) {
        cb(...args);
      }
    }
  }

  triggerUploadProgress(loaded: number, total: number) {
    if (this.uploadListeners['progress']) {
      for (const cb of this.uploadListeners['progress']) {
        cb({ lengthComputable: true, loaded, total });
      }
    }
  }
}

describe('ApiService.uploadVideo (XHR tests)', () => {
  // NOTA: ApiService.uploadVideo no expone cancelación (sin xhr.abort ni
  // AbortSignal en src/services/api.ts): se documenta la ausencia y no se
  // implementa ni se testea cancelación.
  let originalXHR: any;

  beforeEach(() => {
    originalXHR = globalThis.XMLHttpRequest;
    MockXMLHttpRequest.current = null;
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest as any);
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR;
    vi.unstubAllGlobals();
  });

  it('sube video exitosamente y reporta progreso', async () => {
    const file = new File(['dummy content'], 'video.mp4', { type: 'video/mp4' });
    const progressCalls: number[] = [];
    const onProgress = (p: number) => progressCalls.push(p);

    const promise = ApiService.uploadVideo('ABC123', file, onProgress);
    const xhr = MockXMLHttpRequest.current!;

    xhr.status = 200;
    xhr.responseText = JSON.stringify({
      message: 'Video subido con éxito',
      video: { originalName: 'video.mp4', fileName: '123.mp4', sizeBytes: 1000, mimeType: 'video/mp4' },
      status: 'active',
    });

    // Simular progreso
    xhr.triggerUploadProgress(500, 1000);
    expect(progressCalls).toContain(50);

    // Simular fin de carga
    xhr.trigger('load');

    const result = await promise;
    expect(result.message).toBe('Video subido con éxito');
    expect(result.video.originalName).toBe('video.mp4');
    expect(xhr.open).toHaveBeenCalledWith('POST', '/api/rooms/ABC123/video');
    expect(xhr.send).toHaveBeenCalled();
  });

  it('rechaza con mensaje de error ante respuesta HTTP 400/500', async () => {
    const file = new File(['dummy content'], 'video.mp4', { type: 'video/mp4' });
    const promise = ApiService.uploadVideo('ABC123', file, () => {});
    const xhr = MockXMLHttpRequest.current!;

    xhr.status = 400;
    xhr.responseText = JSON.stringify({
      error: 'Formato de video no soportado',
    });

    xhr.trigger('load');

    await expect(promise).rejects.toThrow('Formato de video no soportado');
  });

  it('rechaza con error de red si el evento error se dispara', async () => {
    const file = new File(['dummy content'], 'video.mp4', { type: 'video/mp4' });
    const promise = ApiService.uploadVideo('ABC123', file, () => {});
    const xhr = MockXMLHttpRequest.current!;

    xhr.trigger('error');

    await expect(promise).rejects.toThrow('Error de red al intentar subir el video');
  });

  it('reporta progreso 0→100 en orden ante subidas parciales', async () => {
    const file = new File(['dummy content'], 'video.mp4', { type: 'video/mp4' });
    const progressCalls: number[] = [];
    const promise = ApiService.uploadVideo('ABC123', file, (p) => progressCalls.push(p));
    const xhr = MockXMLHttpRequest.current!;

    xhr.status = 200;
    xhr.responseText = JSON.stringify({
      message: 'Video subido con éxito',
      video: { originalName: 'video.mp4', fileName: '123.mp4', sizeBytes: 1000, mimeType: 'video/mp4' },
      status: 'active',
    });

    xhr.triggerUploadProgress(0, 1000);
    xhr.triggerUploadProgress(250, 1000);
    xhr.triggerUploadProgress(500, 1000);
    xhr.triggerUploadProgress(1000, 1000);
    expect(progressCalls).toEqual([0, 25, 50, 100]);

    xhr.trigger('load');

    await expect(promise).resolves.toMatchObject({ message: 'Video subido con éxito' });
  });

  it('ignora eventos de progreso no computables', async () => {
    const file = new File(['dummy content'], 'video.mp4', { type: 'video/mp4' });
    const progressCalls: number[] = [];
    const promise = ApiService.uploadVideo('ABC123', file, (p) => progressCalls.push(p));
    const xhr = MockXMLHttpRequest.current!;

    const calls = (xhr.upload.addEventListener as unknown as { mock: { calls: Array<[string, (e: { lengthComputable: boolean; loaded: number; total: number }) => void]> } }).mock.calls;
    const progressCb = calls.find(([event]) => event === 'progress')?.[1];
    expect(progressCb).toBeDefined();
    progressCb?.({ lengthComputable: false, loaded: 500, total: 1000 });
    expect(progressCalls).toHaveLength(0);

    xhr.status = 200;
    xhr.responseText = JSON.stringify({ message: 'ok', video: {}, status: 'active' });
    xhr.trigger('load');
    await expect(promise).resolves.toMatchObject({ message: 'ok' });
  });

  it('rechaza con mensaje genérico si el error HTTP no trae JSON', async () => {
    const file = new File(['dummy content'], 'video.mp4', { type: 'video/mp4' });
    const promise = ApiService.uploadVideo('ABC123', file, () => {});
    const xhr = MockXMLHttpRequest.current!;

    xhr.status = 500;
    xhr.responseText = '<html>Internal Server Error</html>';

    xhr.trigger('load');

    await expect(promise).rejects.toThrow('Error 500: Falló la subida');
  });

  it('adjunta headers de autenticación si existen en localStorage', async () => {
    const store = new Map<string, string>([
      ['watchparty_host_session', JSON.stringify({ roomId: 'ABC123', hostName: 'HostName', hostSecret: 'secret123' })],
      ['watchparty_user_id', 'u-host'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    });

    const file = new File(['dummy'], 'video.mp4', { type: 'video/mp4' });
    const promise = ApiService.uploadVideo('ABC123', file, () => {});
    const xhr = MockXMLHttpRequest.current!;

    xhr.status = 200;
    xhr.responseText = JSON.stringify({ message: 'ok', video: {}, status: 'active' });

    xhr.trigger('load');
    await promise;

    expect(xhr.setRequestHeader).toHaveBeenCalledWith('x-host-secret', 'secret123');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('x-user-id', 'u-host');
  });
});
