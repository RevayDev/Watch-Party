// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MediaSettings } from '../src/components/MediaSettings';
import { RoomHeader } from '../src/components/RoomHeader';

vi.mock('../src/shared/components/BottomSheet', () => ({
  BottomSheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function testStream(kind: string) {
  const track = Object.assign(new EventTarget(), { kind, readyState: 'live', stop: vi.fn() });
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

afterEach(() => vi.unstubAllGlobals());

it('muestra configuración de dispositivos a un participante común', () => {
  const open = vi.fn();
  render(<RoomHeader roomId="ABC123" participantCount={2} isLeader={false} showSettings onOpenSettings={open} />);
  fireEvent.click(screen.getByRole('button', { name: 'Configuración de la sala' }));
  expect(open).toHaveBeenCalledOnce();
});

it('prueba el micrófono y la cámara por separado y libera ambos al cerrar', async () => {
  const mic = testStream('audio');
  const camera = testStream('video');
  const getUserMedia = vi.fn(async (constraints) => constraints.audio ? mic.stream : camera.stream);
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
  const close = vi.fn(async () => {});
  vi.stubGlobal('AudioContext', class {
    createMediaStreamSource = () => ({ connect: vi.fn() });
    createAnalyser = () => ({ fftSize: 32, getFloatTimeDomainData: vi.fn() });
    resume = async () => {};
    close = close;
  });
  const { unmount } = render(<MediaSettings localStream={null} onClose={vi.fn()} onRetry={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Probar micrófono' }));
  expect(await screen.findByLabelText('Nivel del micrófono')).toBeInstanceOf(HTMLMeterElement);
  expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true });
  fireEvent.click(screen.getByRole('button', { name: 'Probar cámara' }));
  const preview = await screen.findByLabelText('Vista previa de tu cámara') as HTMLVideoElement;
  expect(preview.srcObject).toBe(camera.stream);
  expect(preview.muted).toBe(true);
  expect(getUserMedia).toHaveBeenLastCalledWith({ video: true });

  unmount();
  expect(camera.track.stop).toHaveBeenCalledOnce();
  expect(mic.track.stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

it('apaga la cámara si el permiso llega después de cerrar la configuración', async () => {
  const camera = testStream('video');
  let permit!: (stream: MediaStream) => void;
  const getUserMedia = () => new Promise<MediaStream>((resolve) => { permit = resolve; });
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
  const { unmount } = render(<MediaSettings localStream={null} onClose={vi.fn()} onRetry={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Probar cámara' }));
  unmount();
  await act(async () => { permit(camera.stream); });
  expect(camera.track.stop).toHaveBeenCalledOnce();
});
