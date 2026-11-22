// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VideoAudioBoost } from '../src/features/player/VideoAudioBoost';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('leaves external media untouched instead of silencing it', async () => {
 const factory = vi.fn(); vi.stubGlobal('AudioContext', factory);
 const video = document.createElement('video'); video.src = 'https://external.example/video.mp4';
 render(<VideoAudioBoost videoRef={{ current: video }} />);
 fireEvent.change(screen.getByLabelText('Amplificación del video'), { target: { value: '200' } });
 expect((await screen.findByRole('status')).textContent).toContain('Este enlace no admite amplificación');
 expect(factory).not.toHaveBeenCalled();
});
it('amplifies local video and resets without creating a second source', async () => {
 const setTargetAtTime = vi.fn(), close = vi.fn(), connect = vi.fn().mockReturnThis();
 const source = vi.fn(() => ({ connect }));
 vi.stubGlobal('AudioContext', vi.fn(function () { return { currentTime: 0, destination: {}, createGain: () => ({ connect, gain: { setTargetAtTime } }), createDynamicsCompressor: () => ({ connect, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }), createMediaElementSource: source, resume: async () => {}, close }; }));
 const video = document.createElement('video'); video.src = '/video.mp4';
 const view = render(<VideoAudioBoost videoRef={{ current: video }} />);
 fireEvent.change(screen.getByLabelText('Amplificación del video'), { target: { value: '250' } });
 await vi.waitFor(() => expect(setTargetAtTime).toHaveBeenCalledWith(2.5, 0, .03));
 fireEvent.click(screen.getByText('Restablecer'));
 await vi.waitFor(() => expect(setTargetAtTime).toHaveBeenLastCalledWith(1, 0, .03));
 expect(source).toHaveBeenCalledTimes(1);
 view.unmount(); expect(close).toHaveBeenCalledTimes(1);
});
