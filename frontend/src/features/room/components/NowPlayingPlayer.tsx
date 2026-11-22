import { Button, Range } from '../../../shared/components/ui';
import React, { useEffect, useRef, useState } from 'react';
import { AudioLines, Maximize2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, Youtube, Square } from 'lucide-react';
import { YouTubePlayerView } from '../../player/YouTubePlayerView';

interface QueueYouTubePlayer {
  playVideo?: () => void;
  pauseVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  mute?: () => void;
  unMute?: () => void;
  setVolume?: (volume: number) => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
}

export function formatPlayerTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const t = Math.floor(totalSeconds);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** The mini-player uses the existing iframe and advances the room queue when playback ends. */
export const NowPlayingPlayer: React.FC<{
  trackKey: string;
  videoId: string;
  title: string;
  subtitle: string;
  thumb?: string;
  onEnded: () => void;
  onNext: () => void;
  onStop: () => void;
  onExpand: (currentTime: number) => void;
  showModerator: boolean;
}> = ({ trackKey, videoId, title, subtitle, thumb, onEnded, onNext, onStop, onExpand, showModerator }) => {
  const playerRef = useRef<QueueYouTubePlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const tryPlay = () => {
    try {
      const p = playerRef.current;
      if (!p) return;
      if (typeof p.unMute === 'function') p.unMute();
      if (typeof p.setVolume === 'function') p.setVolume(volume);
      if (typeof p.playVideo === 'function') p.playVideo();
      setMuted(false);
    } catch {
      /* Autoplay may require a manual click. */
    }
  };

  const togglePlay = () => {
    try {
      const p = playerRef.current;
      if (!p) return;
      if (playing) {
        if (typeof p.pauseVideo === 'function') p.pauseVideo();
      } else {
        // A user gesture lets the browser resume playback with sound.
        if (typeof p.unMute === 'function') p.unMute();
        if (typeof p.setVolume === 'function') p.setVolume(volume);
        if (typeof p.playVideo === 'function') p.playVideo();
        setMuted(false);
      }
    } catch {
      /* noop */
    }
  };

  const restart = () => {
    seekTo(0);
    try {
      playerRef.current?.playVideo?.();
    } catch {
      /* noop */
    }
  };

  const seekTo = (seconds: number) => {
    try {
      const p = playerRef.current;
      if (p && typeof p.seekTo === 'function') p.seekTo(seconds, true);
      setCurrent(seconds);
    } catch {
      /* noop */
    }
  };

  const toggleMute = () => {
    try {
      const p = playerRef.current;
      if (!p) return;
      if (muted) {
        if (typeof p.unMute === 'function') p.unMute();
        setMuted(false);
      } else {
        if (typeof p.mute === 'function') p.mute();
        setMuted(true);
      }
    } catch {
      /* noop */
    }
  };

  const changeVolume = (v: number) => {
    const next = Math.min(100, Math.max(0, Math.round(v)));
    setVolume(next);
    try {
      const p = playerRef.current;
      if (!p) return;
      if (typeof p.setVolume === 'function') p.setVolume(next);
      if (next > 0 && typeof p.unMute === 'function') {
        p.unMute();
        setMuted(false);
      }
    } catch {
      /* noop */
    }
  };

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [trackKey]);

  // Read iframe progress while the track is playing.
  useEffect(() => {
    if (!playing) return;
    const iv = window.setInterval(() => {
      try {
        const p = playerRef.current;
        if (!p) return;
        if (typeof p.getCurrentTime === 'function') {
          const cur = p.getCurrentTime();
          if (Number.isFinite(cur)) setCurrent(cur);
        }
        if (typeof p.getDuration === 'function') {
          const d = p.getDuration();
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }
      } catch {
        /* noop */
      }
    }, 500);
    return () => window.clearInterval(iv);
  }, [playing, trackKey]);



  return (
    <section className="music-player" aria-label="Reproductor de música">
      <div className="music-player__status"><AudioLines size={16} /> Sonando ahora</div>
      <div className="music-player__heading">
        {thumb ? <img className="music-player__art" src={thumb} alt="" /> : <div className="music-player__art music-player__placeholder"><Youtube size={24} /></div>}
        <div className="music-player__info"><strong>{title}</strong><span>{subtitle}</span></div>
        {showModerator && <div className="music-player__actions">
          <Button variant="unstyled" type="button" className="music-player__icon" title="Ampliar a la pantalla de la sala" aria-label="Ampliar a la pantalla de la sala" onClick={() => { const position = playerRef.current?.getCurrentTime?.() ?? current; playerRef.current?.pauseVideo?.(); onExpand(position); }}><Maximize2 size={18} /></Button>
          <Button variant="unstyled" type="button" className="music-player__icon music-player__stop" title="Detener música" aria-label="Detener música" onClick={onStop}><Square size={18} /></Button>
        </div>}
      </div>
      <div aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
        <YouTubePlayerView key={trackKey} videoId={videoId} className="" onReady={(player) => { playerRef.current = player; tryPlay(); }} onStateChange={(event) => {
          if (event.data === 1) setPlaying(true);
          else if (event.data === 2) setPlaying(false);
          else if (event.data === 0) { setPlaying(false); onEndedRef.current(); }
        }} />
      </div>
      <div className="yt-miniplayer-controls music-player__controls">
        <Button variant="unstyled" type="button" className="music-player__icon" title="Reiniciar canción" aria-label="Reiniciar canción" onClick={restart}><SkipBack size={18} /></Button>
        <Button variant="unstyled" type="button" className="music-player__icon music-player__play" title={playing ? 'Pausar' : 'Reproducir'} aria-label={playing ? 'Pausar' : 'Reproducir'} onClick={togglePlay}>{playing ? <Pause size={20} /> : <Play size={20} />}</Button>
        {showModerator && <Button variant="unstyled" type="button" className="music-player__icon" title="Siguiente canción" aria-label="Siguiente canción" onClick={onNext}><SkipForward size={18} /></Button>}
        <div className="music-player__progress">
          <Range className="music-player__range" type="range" min={0} max={Math.max(1, Math.floor(duration))} step={1} value={Math.min(Math.floor(current), Math.max(1, Math.floor(duration)))} onChange={(e) => seekTo(Number(e.target.value))} title="Adelantar o retroceder" aria-label="Adelantar o retroceder" disabled={duration <= 0} style={{ '--range-progress': (duration > 0 ? Math.min(100, current / duration * 100) : 0) + '%' } as React.CSSProperties} />
          <span className="music-player__time">{formatPlayerTime(current)} / {formatPlayerTime(duration)}</span>
        </div>
        <Button variant="unstyled" type="button" className="music-player__icon" title={muted ? 'Activar sonido' : 'Silenciar'} aria-label={muted ? 'Activar sonido' : 'Silenciar'} onClick={toggleMute}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</Button>
        <Range className="music-player__range music-player__volume" type="range" min={0} max={100} step={1} value={muted ? 0 : volume} onChange={(e) => changeVolume(Number(e.target.value))} title="Volumen" aria-label="Volumen" style={{ '--range-progress': (muted ? 0 : volume) + '%' } as React.CSSProperties} />
      </div>
    </section>
  );
};
