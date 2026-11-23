import { Button, Range, Popover } from '../../../shared/components/ui';
import React, { useEffect, useRef, useState } from 'react';
import { AudioLines, Maximize2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, Youtube, Square } from 'lucide-react';
import { YouTubePlayerView } from '../../player/YouTubePlayerView';
import { onPageResume } from '../../../shared/pageResume';

interface QueueYouTubePlayer {
  playVideo?: () => void;
  pauseVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  mute?: () => void;
  unMute?: () => void;
  setVolume?: (volume: number) => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  getPlayerState?: () => number;
}

export function formatPlayerTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const t = Math.floor(totalSeconds);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** The mini-player uses the existing iframe and advances the room queue when playback ends. */
export const NowPlayingPlayer: React.FC<{
  playback?: { currentTime: number; playing: boolean; sentAt: number; awaitingReady?: boolean };
  onReadyToPlay?: () => void;
  startedAt?: string;
  onPlayback?: (currentTime: number, playing: boolean) => void;
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
}> = ({ playback, startedAt, onPlayback, onReadyToPlay, trackKey, videoId, title, subtitle, thumb, onEnded, onNext, onStop, onExpand, showModerator }) => {
  const playerRef = useRef<QueueYouTubePlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeAnchor = useRef<HTMLButtonElement>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [needsActivation, setNeedsActivation] = useState(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const checkpoint = useRef(playback);
  const playingRef = useRef(false);
  const readyTrackRef = useRef<string | null>(null);
  const readyRef = useRef(onReadyToPlay); readyRef.current = onReadyToPlay;
  const synchronize = () => {
    const p = playerRef.current; if (!p) return;
    const point = checkpoint.current;
    const shouldPlay = point?.playing ?? true;
    try {
      // A diferencia del video, la música no corrige segundos entre clientes.
      // Así un móvil que cargue tarde nunca salta, pausa ni arrastra a otro.
      const active = p.getPlayerState ? p.getPlayerState() === 1 : playingRef.current;
      if (shouldPlay && !active) p.playVideo?.();
      if (!shouldPlay) p.pauseVideo?.();
      setCurrent(p.getCurrentTime?.() ?? 0);
    } catch { /* The next ready/foreground event retries the checkpoint. */ }
  };
  const syncRef = useRef(synchronize); syncRef.current = synchronize;
  const reportReady = () => {
    const p = playerRef.current;
    // `onReady` is the reliable signal on mobile. getDuration() can remain 0
    // until after playback starts, which used to leave every client waiting.
    if (p && readyTrackRef.current !== trackKey) {
      readyTrackRef.current = trackKey;
      readyRef.current?.();
    }
  };
  const reportReadyRef = useRef(reportReady); reportReadyRef.current = reportReady;
  useEffect(() => {
    checkpoint.current = playback;
    syncRef.current();
  }, [playback?.sentAt, playback?.currentTime, playback?.playing, startedAt, trackKey]);
  useEffect(() => {
    const stop = onPageResume(() => syncRef.current());
    return stop;
  }, [trackKey]);
  const publish = (seconds: number, active: boolean) => {
    checkpoint.current = { currentTime: seconds, playing: active, sentAt: Date.now() };
    // Los invitados controlan su propio audio. Solo un moderador puede enviar
    // play/pausa al estado común y no se replica la posición entre clientes.
    if (showModerator) onPlayback?.(seconds, active);
  };

  // Android browsers can reject a programmatic iframe play. This function is
  // called directly from the phone's tap and never changes room playback.
  const activateLocalPlayback = () => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.unMute?.();
      p.setVolume?.(volume);
      p.playVideo?.();
      setCurrent(p.getCurrentTime?.() ?? 0);
      setMuted(false);
      setNeedsActivation(false);
    } catch {
      setNeedsActivation(true);
    }
  };

  const togglePlay = () => {
    try {
      const p = playerRef.current;
      if (!p) return;
      // A newly joined phone can know that the room is playing while its
      // iframe is still paused by autoplay policy. The first tap starts only
      // that phone; it must not publish a global pause.
      if (checkpoint.current?.playing && !playingRef.current) {
        activateLocalPlayback();
        return;
      }
      const next = !playingRef.current;
      publish(p.getCurrentTime?.() ?? current, next);
      playingRef.current = next;
      setPlaying(next);
      if (!next) {
        if (typeof p.pauseVideo === 'function') p.pauseVideo();
      } else {
        activateLocalPlayback();
      }
    } catch {
      /* noop */
    }
  };

  const restart = () => {
    publish(0, true);
    playerRef.current?.seekTo?.(0, true);
    setCurrent(0);
    try {
      playerRef.current?.playVideo?.();
    } catch {
      /* noop */
    }
  };

  const seekTo = (seconds: number) => {
    publish(seconds, playing);
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
    playingRef.current = false;
    readyTrackRef.current = null;
    setCurrent(0);
    setDuration(0);
    setNeedsActivation(false);
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
      {/* Keep the iframe painted. Mobile WebKit refuses audio from a fully
          invisible frame even after the user presses this player's button. */}
      <div aria-hidden="true" style={{ position: 'absolute', width: 2, height: 2, overflow: 'hidden', opacity: 0.01, pointerEvents: 'none' }}>
        <YouTubePlayerView key={trackKey} videoId={videoId} className="" onDispose={(player) => { if (playerRef.current === player) playerRef.current = null; }} onReady={(player) => { playerRef.current = player; synchronize(); reportReady(); }} onAutoplayBlocked={() => setNeedsActivation(true)} onStateChange={(event) => {
          if (event.data === 1) { playingRef.current = true; setPlaying(true); setNeedsActivation(false); }
          else if (event.data === 2) { playingRef.current = false; setPlaying(false); }
          else if (event.data === 0) { setPlaying(false); onEndedRef.current(); }
        }} />
      </div>
      <div className="yt-miniplayer-controls music-player__controls">
        {needsActivation && <Button variant="unstyled" type="button" className="music-player__activate" onClick={activateLocalPlayback}>Activar audio en este teléfono</Button>}
        <Button variant="unstyled" type="button" className="music-player__icon" title="Reiniciar canción" aria-label="Reiniciar canción" onClick={restart}><SkipBack size={18} /></Button>
        <Button variant="unstyled" type="button" className="music-player__icon music-player__play" title={playing ? 'Pausar' : 'Reproducir'} aria-label={playing ? 'Pausar' : 'Reproducir'} onClick={togglePlay}>{playing ? <Pause size={20} /> : <Play size={20} />}</Button>
        {showModerator && <Button variant="unstyled" type="button" className="music-player__icon" title="Siguiente canción" aria-label="Siguiente canción" onClick={onNext}><SkipForward size={18} /></Button>}
        <div className="music-player__progress">
          <Range className="music-player__range" type="range" min={0} max={Math.max(1, Math.floor(duration))} step={1} value={Math.min(Math.floor(current), Math.max(1, Math.floor(duration)))} onChange={(e) => seekTo(Number(e.target.value))} title="Adelantar o retroceder" aria-label="Adelantar o retroceder" disabled={duration <= 0} style={{ '--range-progress': (duration > 0 ? Math.min(100, current / duration * 100) : 0) + '%' } as React.CSSProperties} />
          <span className="music-player__time">{formatPlayerTime(current)} / {formatPlayerTime(duration)}</span>
        </div>
        <Button ref={volumeAnchor} variant="unstyled" type="button" className="music-player__icon" title="Volumen de música" aria-label="Volumen de música" aria-expanded={volumeOpen} onClick={() => setVolumeOpen(value => !value)}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</Button>
        {volumeOpen && <Popover placement="top" anchor={volumeAnchor.current} className="music-volume-popup" role="dialog" aria-label="Volumen de música" onDismiss={() => setVolumeOpen(false)}>
          <span>{muted ? 0 : volume}%</span>
          <Range className="music-volume-popup__range" min={0} max={100} value={muted ? 0 : volume} onChange={event => changeVolume(Number(event.target.value))} aria-label="Volumen" />
          <Button variant="unstyled" className="music-player__icon" aria-label={muted ? 'Activar sonido' : 'Silenciar'} onClick={toggleMute}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</Button>
        </Popover>}
      </div>
    </section>
  );
};
