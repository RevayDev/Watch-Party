// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWebRTC } from '../src/hooks/useWebRTC';
class TestStream {
 constructor(private tracks: MediaStreamTrack[] = []) {}
 getTracks() { return this.tracks; }
 getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
 getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
}
function track(kind: string) { return Object.assign(new EventTarget(), { kind, readyState: 'live', enabled: true, stop: vi.fn(), applyConstraints: vi.fn(async () => {}), getSettings: () => ({}), onended: null }) as unknown as MediaStreamTrack; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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
 expect(view.result.current.localStream?.getVideoTracks()[0]).toBe(display);
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
