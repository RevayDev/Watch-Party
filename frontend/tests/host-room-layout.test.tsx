// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HostRoom } from '../src/features/host-room/HostRoom';
import { webcrypto } from 'node:crypto';

const fixture = vi.hoisted(() => ({
  state: {
    revision: 0, hostId: 'host',
    members: [{ id: 'host', name: 'Ana', joinedAt: 1 }],
    messages: [], playback: null, automaticMigration: true, replicateVideo: true,
    musicQueue: [], musicNowPlaying: null,
    video: { id: 'video', name: 'video.mp4', source: 'url', url: 'https://example.com/video.mp4', size: 0, mime: 'video/mp4' },
  },
}));
vi.mock('../src/features/host-room/HostSession', () => ({
  HostSession: class {
    id = 'host';
    connected = true;
    constructor(_options: unknown, private update: (value: unknown) => void) {}
    start() {
      this.update({ id: this.id, state: fixture.state, status: 'Servidor en tu navegador', error: '', fileUrl: null, fileProgress: 0, replicas: 0 });
      return this;
    }
    stop() {}
    on() {}
    off() {}
    emit() {}
    command() {}
  },
}));
vi.mock('../src/hooks/useWebRTC', () => ({
  useWebRTC: () => ({
    localStream: null, remotePeers: [], peerMediaStates: {}, peerSignalStates: {},
    isMicOn: false, isCameraOn: false, mediaError: '', mediaConnectionFailed: false,
    toggleMic: vi.fn(), toggleCamera: vi.fn(), retryMediaConnection: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => vi.unstubAllGlobals());

it('shows recovery instructions instead of crashing on an insecure LAN address', () => {
  vi.stubGlobal('crypto', { getRandomValues: vi.fn() });
  render(<HostRoom options={{ roomId: 'a'.repeat(24), key: 'b'.repeat(64), name: 'Ana', create: true }} onLeave={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toContain('conexión segura');
  expect(screen.getByRole('link', { name: 'Abrir en este equipo' }).getAttribute('href')).toContain('localhost');
});

it('uses the Render layout with a lateral camera strip and the standard bottom controls', () => {
  const { container } = render(<HostRoom options={{ roomId: 'a'.repeat(24), key: 'b'.repeat(64), name: 'Ana', create: true }} onLeave={vi.fn()} />);
  expect(container.querySelector('.meet-layout > .header')).not.toBeNull();
  expect(container.querySelector('.meet-stage > .meet-stage__video-wrapper video')).not.toBeNull();
  expect(container.querySelector('.meet-stage > .meet-stage__cams-strip .cam-tile')).not.toBeNull();
  expect(container.querySelector('.meet-layout > .meet-bottom-bar')).not.toBeNull();
  expect(container.querySelector('.drawer-chat')).toBeNull();
  fireEvent.click(screen.getByTitle('Chat'));
  expect(container.querySelector('.drawer-chat')).not.toBeNull();
  fireEvent.click(screen.getByTitle('Ocultar cámaras laterales'));
  expect(container.querySelector('.meet-stage__cams-strip')).toBeNull();
  fireEvent.click(screen.getByTitle('Configuración de la sala'));
  fireEvent.click(screen.getByRole('tab', { name: 'Servidor' }));
  expect(screen.getByLabelText('Relevo automático del servidor')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Micrófono y cámara' }));
  expect(screen.getByRole('region', { name: 'Prueba de micrófono' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Configurar micrófono y cámara' })).toBeNull();
});
