import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, Volume2 } from 'lucide-react';
import { Button } from '../../shared/components/ui';
import { getSound, SoundSettingsSection } from '../../components/SoundSettingsSection';

/** Local audio processing, independent of room synchronization and microphone. */
export function VideoAudioBoost({ videoRef }: { videoRef: RefObject<HTMLVideoElement> }) {
 const graph = useRef<{ context: AudioContext; gain: GainNode; bass: BiquadFilterNode; pan: StereoPannerNode } | null>(null);
 const [collapsed, setCollapsed] = useState(false);
 const [error, setError] = useState('');
 useEffect(() => {
  async function apply() {
   const video = videoRef.current;
   if (!video) return;
   const sound = getSound();
   if (!graph.current && sound.gain === 100 && sound.bass === 0 && sound.balance === 0) return;
   try {
    const url = new URL(video.currentSrc || video.src, location.href);
    if (url.origin !== location.origin && url.protocol !== 'blob:') {
     setError('Este enlace no admite efectos de sonido. Usa un archivo o el proxy de la plataforma.'); return;
    }
    if (!graph.current) {
     const context = new AudioContext();
     const gain = context.createGain(), bass = context.createBiquadFilter(), pan = context.createStereoPanner();
     bass.type = 'lowshelf'; bass.frequency.value = 180;
     const limiter = context.createDynamicsCompressor();
     limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
     limiter.attack.value = .003; limiter.release.value = .15;
     context.createMediaElementSource(video).connect(bass).connect(gain).connect(pan).connect(limiter).connect(context.destination);
     graph.current = { context, gain, bass, pan };
    }
    await graph.current.context.resume();
    const current = getSound(), { context, gain, bass, pan } = graph.current;
    gain.gain.setTargetAtTime(current.gain / 100, context.currentTime, .03);
    bass.gain.setTargetAtTime(current.bass, context.currentTime, .03);
    pan.pan.setTargetAtTime(current.balance, context.currentTime, .03);
    setError('');
   } catch { setError('Tu navegador no permite aplicar efectos a este video.'); }
  }
  const listener = () => { void apply(); };
  window.addEventListener('watch-party-sound', listener);
  const video = videoRef.current; video?.addEventListener('play', listener);
  listener();
  return () => { window.removeEventListener('watch-party-sound', listener); video?.removeEventListener('play', listener); void graph.current?.context.close(); graph.current = null; };
 }, [videoRef]);
 return <div className={`video-audio-boost ${collapsed ? 'video-audio-boost--collapsed' : ''}`}>
  {!collapsed && <details><summary><Volume2 size={14} /> Sonido</summary><div className="video-audio-boost__panel"><SoundSettingsSection />{error && <p role="status">{error}</p>}</div></details>}
  <Button variant="unstyled" className="video-audio-boost__fold" aria-label={collapsed ? 'Mostrar sonido' : 'Ocultar sonido'} onClick={() => setCollapsed(value => !value)}>{collapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</Button>
  {error && collapsed && <span role="status" className="sr-only">{error}</span>}
 </div>;
}
