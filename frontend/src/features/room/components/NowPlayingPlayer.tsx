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
    <div>

    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.65rem' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#a78bfa', fontSize: '0.84rem', fontWeight: 600 }}>
        <AudioLines size={15} />
        Sonando ahora
      </span>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.6rem' }}>
      {thumb ? (
        <img
          src={thumb}
          alt=""
          style={{ width: '52px', height: '52px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '8px',
            background: 'rgba(139, 92, 246, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#a78bfa',
            flexShrink: 0,
          }}
        >
          <Youtube size={22} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </p>
        <p style={{ margin: '0.1rem 0 0', fontSize: '0.75rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {subtitle}
        </p>
      </div>
    </div>
    {/* The queue uses its own controls and keeps the iframe out of the layout. */}
    <div aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
      <YouTubePlayerView
        key={trackKey}
        videoId={videoId}
        className=""
        onReady={(player) => {
          playerRef.current = player;
          tryPlay();
        }}
        onStateChange={(event) => {
          if (event.data === 1) setPlaying(true);
          else if (event.data === 2) setPlaying(false);
          else if (event.data === 0) {
            // Advance the shared queue once the iframe reports the track ended.
            setPlaying(false);
            onEndedRef.current();
          }
        }}
      />
    </div>
    <div
      className="yt-miniplayer-controls"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginTop: '0.5rem',
      }}
    >
      <button
        type="button"
        onClick={restart}
        title="Reiniciar canción"
        aria-label="Reiniciar canción"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: 'transparent',
          color: '#cbd5e1',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <SkipBack size={14} />
      </button>
      <button
        type="button"
        onClick={togglePlay}
        title={playing ? 'Pausar' : 'Reproducir'}
        aria-label={playing ? 'Pausar' : 'Reproducir'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: '#7c3aed',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {playing ? <Pause size={17} /> : <Play size={17} style={{ marginLeft: 2 }} />}
      </button>
      {showModerator && (
        <button
          type="button"
          onClick={onNext}
          title="Siguiente canción"
          aria-label="Siguiente canción"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: 'transparent',
            color: '#cbd5e1',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <SkipForward size={14} />
        </button>
      )}
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration))}
        step={1}
        value={Math.min(Math.floor(current), Math.max(1, Math.floor(duration)))}
        onChange={(e) => seekTo(Number(e.target.value))}
        title="Adelantar o retroceder"
        aria-label="Adelantar o retroceder"
        disabled={duration <= 0}
        style={{ flex: 1, minWidth: 0, accentColor: '#8b5cf6', cursor: 'pointer' }}
      />
      <button
        type="button"
        onClick={toggleMute}
        title={muted ? 'Activar sonido' : 'Silenciar'}
        aria-label={muted ? 'Activar sonido' : 'Silenciar'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: 'transparent',
          color: '#cbd5e1',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={muted ? 0 : volume}
        onChange={(e) => changeVolume(Number(e.target.value))}
        title="Volumen"
        aria-label="Volumen"
        style={{ width: 64, flexShrink: 0, accentColor: '#8b5cf6', cursor: 'pointer' }}
      />
      {showModerator && (
        <button
          type="button"
          onClick={() => {
            const position = playerRef.current?.getCurrentTime?.() ?? current;
            playerRef.current?.pauseVideo?.();
            onExpand(position);
          }}
          title="Ampliar a la pantalla de la sala"
          aria-label="Ampliar a la pantalla de la sala"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: 'transparent',
            color: '#cbd5e1',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Maximize2 size={15} />
        </button>
      )}
      {showModerator && <button type="button" className="music-row-options" title="Detener música" aria-label="Detener música" onClick={onStop}><Square size={14} /></button>}
    </div>
    </div>
  );
};
