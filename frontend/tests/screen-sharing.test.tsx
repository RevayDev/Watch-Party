// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { useWebRTC } from '../src/hooks/useWebRTC';
class TestStream {
 constructor(private tracks: MediaStreamTrack[] = []) {}
 getTracks() { return this.tracks; }
 addTrack(t: MediaStreamTrack) { this.tracks.push(t); }
 removeTrack(t: MediaStreamTrack) { this.tracks = this.tracks.filter(item => item !== t); }
 getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
 getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
}
function track(kind: string) { return Object.assign(new EventTarget(), { kind, readyState: 'live', enabled: true, stop: vi.fn(), applyConstraints: vi.fn(async () => {}), getSettings: () => ({}), onended: null }) as unknown as MediaStreamTrack; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('explains unsupported phone screen capture without using the camera as a substitute', async () => {
 const camera = vi.fn();
 vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: camera } });
 const view = renderHook(() => useWebRTC(null, 'room', 'Ana', true));
 await act(async () => { await view.result.current.toggleScreenShare(); });
 expect(view.result.current.mediaError).toContain('no permite compartir la pantalla');
 expect(view.result.current.isScreenSharing).toBe(false);
 expect(camera).not.toHaveBeenCalled();
});
it('shares the selected display, keeps the microphone and restores the previous camera on stop', async () => {
 const camera = track('video'), microphone = track('audio'), display = track('video');
 const capture = vi.fn(async () => new TestStream([display]));
 vi.stubGlobal('MediaStream', TestStream);
 vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: capture, getUserMedia: vi.fn(async c => new TestStream([c.video ? camera : microphone])) } });
 const view = renderHook(() => useWebRTC(null, 'room', 'Ana', true));
 await act(async () => { await view.result.current.enableMedia(true, true); });
 await act(async () => { await view.result.current.toggleScreenShare(); });
 expect(capture).toHaveBeenCalledWith({ video: true, audio: false });
 expect(view.result.current.isScreenSharing).toBe(true);
 expect(view.result.current.localStream?.getVideoTracks()[0]).toBe(camera);
 expect(view.result.current.localScreenStream?.getVideoTracks()[0]).toBe(display);
 expect(view.result.current.localStream?.getAudioTracks()[0]).toBe(microphone);
 expect(camera.stop).not.toHaveBeenCalled();
 await act(async () => { display.onended?.(new Event('ended')); });
 expect(view.result.current.isScreenSharing).toBe(false);
 expect(view.result.current.localStream?.getVideoTracks()[0]).toBe(camera);
 expect(microphone.stop).not.toHaveBeenCalled();
 expect(display.stop).toHaveBeenCalledTimes(1);
 view.unmount(); expect(camera.stop).toHaveBeenCalledTimes(1);
});
it('treats display picker cancellation as a normal action and stops capture on room exit', async () => {
 const display = track('video'); const capture = vi.fn().mockRejectedValueOnce(new DOMException('Cancel', 'NotAllowedError')).mockResolvedValue(new TestStream([display]));
 vi.stubGlobal('MediaStream', TestStream); vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: capture } });
 const view = renderHook(() => useWebRTC(null, 'room', 'Ana', true));
 await act(async () => { await view.result.current.toggleScreenShare(); });
 expect(view.result.current.mediaError).toBeNull(); expect(view.result.current.isScreenSharing).toBe(false);
 await act(async () => { await view.result.current.toggleScreenShare(); });
 expect(view.result.current.isScreenSharing).toBe(true);
 view.unmount(); expect(display.stop).toHaveBeenCalledTimes(1);
});

it('keeps independent camera and display senders and separates both remote video streams', async () => {
 const camera = track('video'), display = track('video');
 const slots: Array<{ receiver: { track: { kind: string } }; sender: { track: MediaStreamTrack | null; replaceTrack: ReturnType<typeof vi.fn> }; direction: string }> = [];
 let connection: TestConnection;
 class TestConnection {
  signalingState = 'stable'; ontrack?: (event: unknown) => void;
  constructor() { connection = this; }
  getTransceivers() { return slots; }
  addTransceiver(value: string | MediaStreamTrack) { const sender = { track: typeof value === 'string' ? null : value, replaceTrack: vi.fn(async (next: MediaStreamTrack | null) => { sender.track = next; }) }; slots.push({ receiver: { track: { kind: typeof value === 'string' ? value : value.kind } }, sender, direction: 'sendrecv' }); }
  createOffer = vi.fn(async () => ({ type: 'offer' })); setLocalDescription = vi.fn(); close = vi.fn();
 }
 vi.stubGlobal('RTCPeerConnection', TestConnection); vi.stubGlobal('MediaStream', TestStream);
 vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: async () => new TestStream([display]), getUserMedia: async () => new TestStream([camera]) } });
 const socket = Object.assign(new EventEmitter(), { id: 'self', connected: true });
 const view = renderHook(() => useWebRTC(socket, 'room', 'Ana', true));
 await act(async () => { socket.emit('room-state', { peers: [{ socketId: 'other', userName: 'Beto' }] }); });
 expect(slots.map(slot => slot.receiver.track.kind)).toEqual(['audio', 'video', 'video']);
 await act(async () => { await view.result.current.toggleCamera(); await view.result.current.toggleScreenShare(); });
 expect(slots[1].sender.track).toBe(camera); expect(slots[2].sender.track).toBe(display);
 const remoteCamera = track('video'), remoteDisplay = track('video');
 await act(async () => { connection.ontrack?.({ track: remoteDisplay, transceiver: slots[2] }); connection.ontrack?.({ track: remoteCamera, transceiver: slots[1] }); });
 expect(view.result.current.remotePeers[0].stream.getVideoTracks()).toEqual([remoteCamera]);
 expect(view.result.current.remotePeers[0].screenStream?.getVideoTracks()).toEqual([remoteDisplay]);
 await act(async () => { await view.result.current.toggleCamera(); });
 expect(slots[1].sender.track).toBeNull(); expect(slots[2].sender.track).toBe(display);
 expect(view.result.current.isScreenSharing).toBe(true);
 await act(async () => { await view.result.current.toggleScreenShare(); });
 expect(slots[2].sender.track).toBeNull();
});
