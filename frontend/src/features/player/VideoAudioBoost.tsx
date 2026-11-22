import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '../../shared/components/ui';

/** Local gain only: never changes the room volume or microphone. */
export function VideoAudioBoost({ videoRef }: { videoRef: RefObject<HTMLVideoElement> }) {
 const graph = useRef<{ context: AudioContext; gain: GainNode } | null>(null);
 const [level, setLevel] = useState(100);
 const [error, setError] = useState('');
 useEffect(() => () => { void graph.current?.context.close(); graph.current = null; }, []);
 async function change(next: number) {
  const video = videoRef.current;
  if (!video) return;
  try {
   const url = new URL(video.currentSrc || video.src, location.href);
   // Routing opaque cross-origin media through Web Audio would silence it.
   if (url.origin !== location.origin && url.protocol !== 'blob:') {
    setError('Este enlace no admite amplificación. Usa un archivo o el proxy de la plataforma.');
    return;
   }
   if (!graph.current) {
    const context = new AudioContext();
    const gain = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = .003;
    limiter.release.value = .15;
    context.createMediaElementSource(video).connect(gain);
    gain.connect(limiter).connect(context.destination);
    graph.current = { context, gain };
   }
   await graph.current.context.resume();
   graph.current.gain.gain.setTargetAtTime(next / 100, graph.current.context.currentTime, .03);
   setLevel(next);
   setError('');
  } catch {
   setError('Tu navegador no permite amplificar este video.');
  }
 }
 return <details className="video-audio-boost">
  <summary>Audio · {level}%</summary>
  <div className="video-audio-boost__panel">
   <label>Amplificación del video <span aria-hidden="true">{level}%</span>
    <input aria-label="Amplificación del video" type="range" min="100" max="300" step="25" value={level} onChange={event => { void change(Number(event.target.value)); }} />
   </label>
   <p>Solo para ti. Si se distorsiona, reduce la amplificación.</p>
   <Button size="sm" variant="ghost" onClick={() => { void change(100); }}>Restablecer</Button>
   {error && <p role="status">{error}</p>}
  </div>
 </details>;
}
