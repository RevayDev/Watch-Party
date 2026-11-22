import { onPageResume } from '../../shared/pageResume';
import { useEffect, useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, Volume2 } from 'lucide-react';
import { Button } from '../../shared/components/ui';
import { getSound, SoundSettingsSection } from '../../components/SoundSettingsSection';

type AudioGraph = { context: AudioContext; source: MediaElementAudioSourceNode; gain: GainNode; bass: BiquadFilterNode; pan: StereoPannerNode; limiter: DynamicsCompressorNode };
// A media element can be attached to a source only once, including after React remounts.
const graphs = new WeakMap<HTMLVideoElement, AudioGraph>();
function graphFor(video: HTMLVideoElement): AudioGraph {
 const existing = graphs.get(video);
 if (existing) return existing;
 const context = new AudioContext();
 try {
  // Prepare every fallible effect before taking ownership of the media audio.
  const gain = context.createGain(), bass = context.createBiquadFilter(), pan = context.createStereoPanner(), limiter = context.createDynamicsCompressor();
  bass.type = 'lowshelf'; bass.frequency.value = 180;
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = .003; limiter.release.value = .15;
  bass.connect(gain).connect(pan).connect(limiter).connect(context.destination);
  const source = context.createMediaElementSource(video);
  const graph = { context, source, gain, bass, pan, limiter };
  graphs.set(video, graph);
  // Begin with an audible bypass; effects are connected only after resume succeeds.
  source.connect(context.destination);
  return graph;
 } catch (error) { void context.close().catch(() => {}); throw error; }
}
export function VideoAudioBoost({ videoRef }: { videoRef: RefObject<HTMLVideoElement> }) {
 const [collapsed, setCollapsed] = useState(false);
 const [error, setError] = useState('');
 useEffect(() => {
  let disposed = false;
  async function apply() {
   const video = videoRef.current;
   if (!video) return;
   const sound = getSound();
   if (!graphs.has(video) && sound.gain === 100 && sound.bass === 0 && sound.balance === 0) return;
   let graph = graphs.get(video);
   try {
    const url = new URL(video.currentSrc || video.src, location.href);
    if (url.origin !== location.origin && url.protocol !== 'blob:') {
     if (!disposed) setError('Este enlace no admite efectos de sonido. Usa un archivo o el proxy de la plataforma.'); return;
    }
    graph = graphFor(video);
    await graph.context.resume();
    if (disposed) return;
    const current = getSound(), { context, gain, bass, pan, source } = graph;
    gain.gain.setTargetAtTime(current.gain / 100, context.currentTime, .03);
    bass.gain.setTargetAtTime(current.bass, context.currentTime, .03);
    pan.pan.setTargetAtTime(current.balance, context.currentTime, .03);
    source.disconnect();
    source.connect(current.gain === 100 && current.bass === 0 && current.balance === 0 ? context.destination : bass);
    setError('');
   } catch {
    // Once captured, never leave a media element attached to a closed or broken chain.
    if (graph) {
     try { graph.source.disconnect(); graph.source.connect(graph.context.destination); } catch { /* retain the browser error below */ }
    }
    if (!disposed) setError('No se pudieron aplicar los efectos. Pulsa Recuperar audio para volver al sonido original.');
   }
  }
  const listener = () => { void apply(); };
  const stopResume = onPageResume(listener);
  const unlock = () => { const context = videoRef.current && graphs.get(videoRef.current)?.context; if (context && context.state !== 'running') listener(); };
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
  window.addEventListener('watch-party-sound', listener);
  const video = videoRef.current;
  video?.addEventListener('play', listener);
  video?.addEventListener('playing', listener);
  listener();
  return () => {
   disposed = true; stopResume();
   document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock);
   window.removeEventListener('watch-party-sound', listener);
   video?.removeEventListener('play', listener); video?.removeEventListener('playing', listener);
   // Closing here permanently silences the captured element on StrictMode/remount.
  };
 }, [videoRef]);
 async function recover() {
  const graph = videoRef.current && graphs.get(videoRef.current);
  if (!graph) { setError(''); return; }
  try { graph.source.disconnect(); graph.source.connect(graph.context.destination); await graph.context.resume(); setError(''); }
  catch { setError('El navegador bloqueó el audio. Recarga la sala para restablecerlo.'); }
 }
 return <div className={`video-audio-boost ${collapsed ? 'video-audio-boost--collapsed' : ''}`}>
  {!collapsed && <details><summary><Volume2 size={14} /> Sonido</summary><div className="video-audio-boost__panel"><SoundSettingsSection />{error && <><p role="status">{error}</p><Button variant="secondary" onClick={() => { void recover(); }}>Recuperar audio</Button></>}</div></details>}
  <Button variant="unstyled" className="video-audio-boost__fold" aria-label={collapsed ? 'Mostrar sonido' : 'Ocultar sonido'} onClick={() => setCollapsed(value => !value)}>{collapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</Button>
 </div>;
}
