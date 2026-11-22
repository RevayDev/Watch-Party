// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VideoAudioBoost } from '../src/features/player/VideoAudioBoost';
import { updateSound } from '../src/components/SoundSettingsSection';
afterEach(() => { cleanup(); updateSound({ gain: 100, bass: 0, balance: 0 }); vi.unstubAllGlobals(); });
it('leaves external media untouched instead of silencing it', async () => {
 const factory = vi.fn(); vi.stubGlobal('AudioContext', factory);
 const video = document.createElement('video'); video.src = 'https://external.example/video.mp4';
 render(<VideoAudioBoost videoRef={{ current: video }} />);
 fireEvent.change(screen.getByLabelText('Amplificación del video'), { target: { value: '200' } });
 expect((await screen.findByRole('status')).textContent).toContain('Este enlace no admite efectos');
 expect(factory).not.toHaveBeenCalled();
});
it('applies gain, bass and balance without rebuilding the source and keeps playing when folded', async () => {
 const gain = vi.fn(), bass = vi.fn(), pan = vi.fn(), close = vi.fn();
 const node = () => ({ connect: vi.fn().mockReturnThis() });
 const source = vi.fn(node);
 vi.stubGlobal('AudioContext', vi.fn(function () { return { currentTime: 0, destination: {}, createGain: () => ({ ...node(), gain: { setTargetAtTime: gain } }), createBiquadFilter: () => ({ ...node(), frequency: {}, gain: { setTargetAtTime: bass } }), createStereoPanner: () => ({ ...node(), pan: { setTargetAtTime: pan } }), createDynamicsCompressor: () => ({ ...node(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }), createMediaElementSource: source, resume: async () => {}, close }; }));
 const video = document.createElement('video'); video.src = '/video.mp4';
 const view = render(<VideoAudioBoost videoRef={{ current: video }} />);
 fireEvent.change(screen.getByLabelText('Amplificación del video'), { target: { value: '600' } });
 await vi.waitFor(() => expect(gain).toHaveBeenCalledWith(6, 0, .03));
 fireEvent.change(screen.getByLabelText('Bajos del video'), { target: { value: '6' } });
 fireEvent.change(screen.getByLabelText('Balance del video'), { target: { value: '-0.5' } });
 await vi.waitFor(() => { expect(bass).toHaveBeenLastCalledWith(6, 0, .03); expect(pan).toHaveBeenLastCalledWith(-.5, 0, .03); });
 fireEvent.click(screen.getByLabelText('Ocultar sonido'));
 expect(close).not.toHaveBeenCalled();
 fireEvent.click(screen.getByLabelText('Mostrar sonido'));
 fireEvent.click(screen.getByText('Restablecer sonido'));
 await vi.waitFor(() => expect(gain).toHaveBeenLastCalledWith(1, 0, .03));
 expect(source).toHaveBeenCalledTimes(1);
 view.unmount(); expect(close).toHaveBeenCalledTimes(1);
});
