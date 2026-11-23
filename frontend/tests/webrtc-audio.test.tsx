// @vitest-environment jsdom
import React from 'react';
import { EventEmitter } from 'node:events';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { afterEach, expect, it, vi } from 'vitest';
import { RemoteAudio } from '../src/components/RemoteAudio';
import { p2pIceConfiguration, useWebRTC } from '../src/hooks/useWebRTC';

const microphone = Object.assign(new EventTarget(), {
  kind: 'audio', id: 'mic', readyState: 'live', stop: vi.fn(),
}) as unknown as MediaStreamTrack;

class TestStream {
  constructor(private tracks: MediaStreamTrack[] = []) {}
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('uses the original direct P2P STUN-only configuration', () => {
  const config = p2pIceConfiguration();
  expect(config.iceServers).toContainEqual({ urls: 'stun:stun.l.google.com:19302' });
  expect(config.iceServers).not.toContainEqual(expect.objectContaining({ username: expect.anything() }));
});

it('reutiliza el sender negociado al encender, apagar y volver a encender el micrófono', async () => {
  const transceivers: RTCRtpTransceiver[] = [];
  const addTransceiver = vi.fn((kind: 'audio' | 'video') => {
    const sender = { track: null as MediaStreamTrack | null, replaceTrack: vi.fn(async (track) => {
      sender.track = track;
    }) };
    transceivers.push({ receiver: { track: { kind } }, sender, mid: null, direction: 'sendrecv' } as unknown as RTCRtpTransceiver);
  });
  const createOffer = vi.fn(async () => ({ type: 'offer' }));
  class TestConnection {
    signalingState = 'stable';
    getTransceivers = () => transceivers;
    addTransceiver = addTransceiver;
    createOffer = createOffer;
    setLocalDescription = vi.fn();
    addTrack = vi.fn(() => { throw new Error('El micrófono debe reutilizar el sender'); });
    close = vi.fn();
  }
  vi.stubGlobal('RTCPeerConnection', TestConnection);
  vi.stubGlobal('MediaStream', TestStream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async (constraints: MediaStreamConstraints) => {
    if (constraints.video) throw new DOMException('Cámara bloqueada', 'NotAllowedError');
    return new TestStream([microphone]);
  } } });
  const events = Object.assign(new EventEmitter(), { id: 'local', connected: true });
  const { result } = renderHook(() => useWebRTC(events as unknown as Socket, 'SALA', 'Ana', true));

  await act(async () => { events.emit('room-state', { peers: [{ socketId: 'peer', userName: 'Luis' }] }); });
  const audioSender = transceivers[0].sender;
  expect(addTransceiver.mock.calls.map(([kind]) => kind)).toEqual(['audio', 'video', 'video']);
  expect(audioSender.track).toBeNull();

  await act(async () => { await result.current.toggleMic(); });
  expect(result.current.isMicOn).toBe(true);
  expect(audioSender.track).toBe(microphone);
  await act(async () => { await result.current.toggleMic(); });
  expect(audioSender.track).toBeNull();
  await act(async () => { await result.current.toggleMic(); });
  expect(audioSender.track).toBe(microphone);
  expect(createOffer).toHaveBeenCalledTimes(1);
  expect(addTransceiver).toHaveBeenCalledTimes(3);

  await act(async () => { microphone.dispatchEvent(new Event('ended')); });
  expect(result.current.isMicOn).toBe(false);
  expect(result.current.mediaError).toMatch(/desconectó el micrófono/);

  await act(async () => { await result.current.enableMedia(true, true); });
  expect(audioSender.track).toBe(microphone);
  expect(result.current.isMicOn).toBe(true);
  expect(result.current.isCameraOn).toBe(false);
});

it('reintenta ICE si se pierde la oferta y vuelve a negociar tras reconectar el socket', async () => {
  vi.useFakeTimers();
  const connections: TestConnection[] = [];
  class TestConnection {
    connectionState = 'new';
    signalingState = 'stable';
    localDescription = { type: 'offer' };
    constructor() { connections.push(this); }
    getTransceivers = () => [];
    addTransceiver = vi.fn();
    createOffer = vi.fn(async () => ({ type: 'offer' }));
    setLocalDescription = vi.fn(async (description) => {
      this.signalingState = description.type === 'rollback' ? 'stable' : 'have-local-offer';
    });
    close = vi.fn(() => { this.connectionState = 'closed'; });
  }
  vi.stubGlobal('RTCPeerConnection', TestConnection);
  const events = Object.assign(new EventEmitter(), { id: 'local', connected: true });
  const peers = { peers: [{ socketId: 'peer', userName: 'Luis' }] };
  const { unmount } = renderHook(() => useWebRTC(events as unknown as Socket, 'SALA', 'Ana', true));

  await act(async () => { events.emit('room-state', peers); });
  await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
  expect(connections[0].setLocalDescription).toHaveBeenCalledWith({ type: 'rollback' });
  expect(connections[0].createOffer).toHaveBeenLastCalledWith({ iceRestart: true });

  await act(async () => {
    events.connected = false;
    events.emit('disconnect');
    events.connected = true;
    events.emit('room-state', peers);
  });
  expect(connections[0].close).toHaveBeenCalledOnce();
  expect(connections[1].createOffer).toHaveBeenCalledOnce();
  unmount();
});

it('removes the stale peer when the same participant reconnects with a new socket id', async () => {
  const connections: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  class TestConnection {
    connectionState = 'new'; signalingState = 'stable';
    constructor() { connections.push(this); }
    getTransceivers = () => [];
    addTransceiver = vi.fn();
    createOffer = vi.fn(async () => ({ type: 'offer' }));
    setLocalDescription = vi.fn();
    close = vi.fn(() => { this.connectionState = 'closed'; });
  }
  vi.stubGlobal('RTCPeerConnection', TestConnection);
  const events = Object.assign(new EventEmitter(), { id: 'local', connected: true });
  renderHook(() => useWebRTC(events as unknown as Socket, 'SALA', 'Ana', true));
  await act(async () => { events.emit('room-state', { peers: [{ socketId: 'old', userName: 'Andres', isLeader: false }] }); });
  await act(async () => { events.emit('user-joined', { socketId: 'new', userName: 'Andres', isLeader: false }); });
  expect(connections[0].close).toHaveBeenCalledOnce();
});

it('permite activar el audio recibido cuando el navegador bloquea la reproducción automática', async () => {
  vi.stubGlobal('MediaStream', TestStream);
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    .mockRejectedValueOnce(new DOMException('Autoplay bloqueado', 'NotAllowedError'))
    .mockResolvedValue(undefined);
  const stream = new TestStream([microphone]) as unknown as MediaStream;
  const { container } = render(<RemoteAudio peers={[{ socketId: 'peer', userName: 'Luis', stream, isLeader: false }]} />);

  expect(container.querySelector('audio')?.srcObject?.getAudioTracks()).toEqual([microphone]);
  fireEvent.click(await screen.findByRole('button', { name: 'Escuchar a Luis' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Escuchar a Luis' })).toBeNull());
  expect(play).toHaveBeenCalledTimes(2);
});
