import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import Hls from 'hls.js';
import { IVideoMetadata, ReactionItem } from '../../types/room';
import { BottomSheet } from '../../shared/components/BottomSheet';
import { VideoUploadPicker } from './VideoUploadPicker';

interface VideoPlayerProps {
  roomId: string;
  video: IVideoMetadata | null | undefined;
  isHost: boolean;
  onUploadVideo: (file: File) => Promise<void>;
  onSetVideoUrl?: (url: string, title?: string) => Promise<void>;
  uploadProgress: number | null;
  onSyncAction: (action: 'play' | 'pause' | 'seek', currentTime: number) => void;
  remoteAction: { action: 'play' | 'pause' | 'seek'; currentTime: number; sentAt?: number; timestamp: number } | null;
  reactions: ReactionItem[];
  isMicOn?: boolean; // used for auto-duck
  /** Periodic position report so the room can resolve a consensus time for newcomers */
  onPlaybackHeartbeat?: (currentTime: number, isPlaying: boolean) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  roomId,
  video,
  isHost,
  onUploadVideo,
  onSetVideoUrl,
  uploadProgress,
  onSyncAction,
  remoteAction,
  reactions,
  isMicOn = false,
  onPlaybackHeartbeat,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsInstanceRef = useRef<Hls | null>(null);
  const lastLoadKeyRef = useRef<string | null>(null);

  const [activeTab, setActiveTab] = useState<'upload' | 'url'>('upload');
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [isSubmittingUrl, setIsSubmittingUrl] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [showChangePanel, setShowChangePanel] = useState(false);

  // Empty-state picker: on phones it opens as a bottom sheet (like the "Cambiar" modal)
  const [showEmptyPicker, setShowEmptyPicker] = useState(true);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const isApplyingRemote = useRef(false);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Monitor fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Auto-duck: lower video volume when mic is on (you're speaking)
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = isMicOn ? 0.30 : 1.0;
  }, [isMicOn]);

  // Position heartbeat (5s): lets the server resolve the consensus time
  // a (re)joining member should adopt. Skipped without video or on error.
  useEffect(() => {
    if (!video || playbackError || !onPlaybackHeartbeat) return;
    const report = () => {
      const vid = videoRef.current;
      if (!vid || !Number.isFinite(vid.currentTime)) return;
      onPlaybackHeartbeat(vid.currentTime, !vid.paused && !vid.ended);
    };
    report();
    const iv = window.setInterval(report, 5000);
    return () => window.clearInterval(iv);
  }, [video, playbackError, onPlaybackHeartbeat, roomId]);

  // Auto-hide overlay top bar (filename + "Cambiar") after mouse idle — always, not just fullscreen
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => setShowControls(false), 2500);
  }, []);

  // Keep the top bar visible while the change panel is open
  useEffect(() => {
    if (showChangePanel) {
      setShowControls(true);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    } else {
      resetHideTimer();
    }
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [showChangePanel, resetHideTimer]);

  // HLS and Media Stream Setup with Recovery mechanism
  useEffect(() => {
    if (!video || !videoRef.current) {
      setPlaybackError(null);
      lastLoadKeyRef.current = null;
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
      return;
    }

    const backendBase = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';
    const isExternal = (video.sourceType === 'url' || video.sourceType === 'hls') && !!video.directUrl;
    // External URLs go through the backend CORS proxy so hls.js/XHR are not blocked
    const videoSrc = isExternal
      ? `${backendBase}/api/proxy?url=${encodeURIComponent(video.directUrl!)}`
      : `${backendBase}/api/rooms/${roomId}/video/stream`;

    const vid = videoRef.current;
    const isHls = video.sourceType === 'hls' || !!video.directUrl?.includes('.m3u8') || videoSrc.includes('.m3u8');

    // Same source already attached (room-state events re-create the video object on every
    // socket message): re-setting src aborts the in-flight request and fires a bogus error.
    const loadKey = `${videoSrc}::${retryToken}`;
    const alreadyLoaded =
      lastLoadKeyRef.current === loadKey &&
      (isHls ? !!hlsInstanceRef.current : vid.getAttribute('src') === videoSrc);
    if (alreadyLoaded) return;

    setPlaybackError(null);
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.destroy();
      hlsInstanceRef.current = null;
    }
    lastLoadKeyRef.current = loadKey;

    if (isHls) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
        });
        hlsInstanceRef.current = hls;
        hls.loadSource(videoSrc);
        hls.attachMedia(vid);

        let fatalNetworkRetries = 0;
        let fatalMediaRetries = 0;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (fatalNetworkRetries < 3) {
                fatalNetworkRetries += 1;
                console.warn(`HLS network error, retrying (${fatalNetworkRetries}/3)...`, data.details);
                hls.startLoad();
                break;
              }
              setPlaybackError(
                `No se pudo cargar la transmisión (${data.details}). El enlace puede haber expirado o no permitir reproducirlo.`
              );
              hls.destroy();
              if (hlsInstanceRef.current === hls) hlsInstanceRef.current = null;
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              if (fatalMediaRetries < 3) {
                fatalMediaRetries += 1;
                console.warn(`HLS media error, recovering (${fatalMediaRetries}/3)...`, data.details);
                hls.recoverMediaError();
                break;
              }
              setPlaybackError('No se pudo decodificar el video del stream. Prueba con otro enlace.');
              hls.destroy();
              if (hlsInstanceRef.current === hls) hlsInstanceRef.current = null;
              break;
            default:
              console.error('Fatal HLS error cannot be recovered:', data);
              setPlaybackError('No se pudo decodificar el stream HLS o el enlace expiró.');
              hls.destroy();
              if (hlsInstanceRef.current === hls) hlsInstanceRef.current = null;
              break;
          }
        });
      } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Safari / iOS HLS support
        vid.src = videoSrc;
      } else {
        setPlaybackError('Tu navegador no soporta reproducción HLS (.m3u8).');
      }
    } else {
      // Standard MP4 / WebM direct streaming
      vid.src = videoSrc;
    }

    return () => {
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
    };
  }, [video, roomId, retryToken]);

  // Apply incoming remote sync actions with latency compensation and smooth tolerance
  useEffect(() => {
    if (!remoteAction || !videoRef.current) return;

    const vid = videoRef.current;
    isApplyingRemote.current = true;

    const latencyOffset = remoteAction.sentAt
      ? Math.max(0, (Date.now() - remoteAction.sentAt) / 1000)
      : 0;
    const targetTime =
      remoteAction.action === 'play'
        ? remoteAction.currentTime + latencyOffset
        : remoteAction.currentTime;

    const diff = Math.abs(vid.currentTime - targetTime);

    if (remoteAction.action === 'play') {
      if (diff > 2.0) {
        // Desfase grande (>2s): salto directo para alinearse a la escena
        vid.currentTime = targetTime;
        vid.playbackRate = 1.0;
      } else if (diff > 0.8) {
        // Desfase leve (0.8s - 2s): micro-ajuste de velocidad para emparejar suavemente sin cortes
        vid.playbackRate = vid.currentTime < targetTime ? 1.05 : 0.95;
        setTimeout(() => {
          if (videoRef.current) videoRef.current.playbackRate = 1.0;
        }, 2000);
      } else {
        vid.playbackRate = 1.0;
      }

      if (vid.paused) {
        vid.play().catch(() => {});
      }
    } else if (remoteAction.action === 'pause') {
      vid.playbackRate = 1.0;
      if (diff > 2.0) {
        vid.currentTime = targetTime;
      }
      if (!vid.paused) {
        vid.pause();
      }
    } else if (remoteAction.action === 'seek') {
      vid.playbackRate = 1.0;
      vid.currentTime = targetTime;
    }

    setTimeout(() => {
      isApplyingRemote.current = false;
    }, 300);
  }, [remoteAction]);

  const handlePlay = () => {
    if (isApplyingRemote.current || !videoRef.current) return;
    onSyncAction('play', videoRef.current.currentTime);
  };

  const handlePause = () => {
    if (isApplyingRemote.current || !videoRef.current) return;
    onSyncAction('pause', videoRef.current.currentTime);
  };

  const handleSeeked = () => {
    if (isApplyingRemote.current || !videoRef.current) return;
    onSyncAction('seek', videoRef.current.currentTime);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handlePickFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handlePickFile(e.dataTransfer.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || !onSetVideoUrl) return;
    try {
      setIsSubmittingUrl(true);
      await onSetVideoUrl(urlInput.trim(), titleInput.trim() || undefined);
      setUrlInput('');
      setTitleInput('');
      setShowChangePanel(false);
    } finally {
      setIsSubmittingUrl(false);
    }
  };

  const handleRetryStream = () => {
    setPlaybackError(null);
    setRetryToken((token) => token + 1);
  };

  // Human description of where the current video comes from (debug helper)
  const describeVideoSource = (): string => {
    if (!video) return 'origen desconocido';
    const direct = video.directUrl || '';
    if (video.sourceType === 'file') return 'archivo subido';
    if (direct.includes('drive.google.com') || direct.includes('drive.usercontent.google.com')) {
      return 'enlace de Google Drive';
    }
    if (video.sourceType === 'hls' || direct.includes('.m3u8')) return 'enlace HLS';
    if (direct) return 'enlace web';
    return 'archivo de la sala';
  };

  // Asks the proxy what the source actually answers, so the error says WHY it failed
  const diagnoseVideoSrc = async (src: string, kind: string): Promise<string> => {
    if (!src) {
      return `No se pudo cargar el video (${kind}). Recarga la página e inténtalo otra vez.`;
    }
    try {
      const res = await fetch(src, { headers: { Range: 'bytes=0-1' } });
      const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
      await res.body?.cancel().catch(() => {});

      if (!res.ok) {
        return `No se pudo cargar el video (${kind}): el servidor respondió HTTP ${res.status}. El enlace puede haber expirado o no ser público.`;
      }
      if (contentType.includes('text/html')) {
        return `No se pudo cargar el video (${kind}): el enlace devolvió una página HTML en vez del video. Verifica que el archivo sea público.`;
      }
      return `No se pudo cargar el video (${kind}): el origen responde ${res.status} (${contentType || 'sin content-type'}) pero el navegador no pudo reproducirlo. Verifica el formato.`;
    } catch (err: any) {
      return `No se pudo conectar con el video (${kind}): ${err?.message || 'error de red'}.`;
    }
  };

  const handleVideoElementError = () => {
    if (playbackError) return;
    const kind = describeVideoSource();
    const src =
      videoRef.current?.currentSrc ||
      (lastLoadKeyRef.current ? lastLoadKeyRef.current.split('::')[0] : '');
    setPlaybackError(`No se pudo cargar el video (${kind}). Verificando el enlace...`);
    diagnoseVideoSrc(src, kind).then(setPlaybackError);
  };

  const openChangePanel = (tab?: 'upload' | 'url') => {
    // Default to the tab matching what is currently loaded (link -> link tab, file -> upload tab)
    const defaultTab: 'upload' | 'url' = video && video.sourceType !== 'file' ? 'url' : 'upload';
    setActiveTab(tab ?? defaultTab);
    setShowChangePanel(true);
  };

  // The empty-state picker is only dismissible when it is shown as a phone bottom sheet
  const closeEmptyPicker = () => {
    if (window.matchMedia('(max-width: 768px)').matches) setShowEmptyPicker(false);
  };

  const handlePickFile = (file: File) => {
    setShowChangePanel(false);
    onUploadVideo(file);
  };

  const pickerProps = {
    activeTab,
    setActiveTab,
    urlInput,
    titleInput,
    setUrlInput,
    setTitleInput,
    isSubmittingUrl,
    onUrlSubmit: handleUrlSubmit,
    isDragOver,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    onTriggerFile: triggerFileInput,
  };

  // 1. Upload in progress state (Visible to Host and all Room Members)
  if (uploadProgress !== null) {
    return (
      <div ref={containerRef} className="player-container">
        <div className="player-container__placeholder">
          <div className="dropzone-container" style={{ textAlign: 'center', alignItems: 'center' }}>
            <Loader2 size={44} className="animate-spin" color="#818cf8" />
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.25rem' }}>
                {isHost ? 'Subiendo video a la sala...' : 'El Anfitrión está subiendo el video...'}
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-muted-light)' }}>
                {uploadProgress}% transferido
              </p>
            </div>
            <div className="upload-progress" style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                className="upload-progress__bar"
                style={{
                  width: `${uploadProgress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              La reproducción comenzará de forma sincronizada al terminar la carga.
            </span>
          </div>
        </div>
      </div>
    );
  }

  // 2. No video uploaded yet
  if (!video) {
    return (
      <div ref={containerRef} className="player-container">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-matroska,.mkv,.mp4,.webm"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <div className="player-container__placeholder">
          {isHost ? (
            <>
              {/* Phone bottom sheet, plain inline picker on desktop */}
              <BottomSheet
                open={showEmptyPicker}
                onClose={closeEmptyPicker}
                variant="inline"
                desktopClassName="empty-picker-sheet"
                label="Subir video o pegar enlace"
              >
                <div className="dropzone-container">
                  <VideoUploadPicker {...pickerProps} />
                </div>
              </BottomSheet>
              {!showEmptyPicker && (
                <button
                  type="button"
                  className="btn btn--primary empty-picker-reopen"
                  onClick={() => setShowEmptyPicker(true)}
                >
                  <span>Subir video o pegar enlace</span>
                </button>
              )}
            </>
          ) : (
            <div className="dropzone-container" style={{ textAlign: 'center', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>Aún no hay video en la sala</h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--color-muted-light)', marginTop: '0.35rem' }}>
                  Esperando a que el Anfitrión suba un archivo o configure un enlace para comenzar.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 3. Fast HTTP 206 / HLS streaming
  const formattedSize = video.sizeBytes
    ? `${(video.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
    : '';

  return (
    <div
      ref={containerRef}
      className={`player-container ${isFullscreen ? 'player-container--fullscreen' : ''}`}
      onMouseMove={resetHideTimer}
      onTouchStart={resetHideTimer}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-matroska,.mkv,.mp4,.webm"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Top overlay: filename left, controls right — auto-hides in fullscreen */}
      <div
        className="player-container__topbar-wrapper"
        style={{ opacity: showControls ? 1 : 0, pointerEvents: showControls ? 'auto' : 'none' }}
      >
        <div className="player-container__filename" title={video.originalName}>
          🎬 {video.originalName} {formattedSize && `(${formattedSize})`}
          {video.sourceType === 'hls' && (
            <span style={{ marginLeft: '0.5rem', background: '#dc2626', color: '#fff', fontSize: '0.68rem', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: 700 }}>
              HLS LIVE/STREAM
            </span>
          )}
        </div>

        <div className="player-container__topbar">
          {/* Volume duck indicator */}
          {isMicOn && (
            <span
              className="player-volume-duck"
              title="Volumen reducido porque el micrófono está activo"
            >
              <span>Volumen 30%</span>
            </span>
          )}

          {isHost && (
            <button
              onClick={() => openChangePanel()}
              className="player-change-btn"
              title="Cambiar video: subir archivo o pegar enlace"
              type="button"
            >
              <RefreshCw size={13} className="player-change-btn__icon" />
              <span>Cambiar</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile-only floating button: opens the "Cambiar video" panel (top bar auto-hides on touch) */}
      {isHost && !showChangePanel && (
        <button
          onClick={() => openChangePanel()}
          className="player-change-fab"
          title="Cambiar video: subir archivo o pegar enlace"
          type="button"
          style={{ opacity: showControls ? 1 : 0, pointerEvents: showControls ? 'auto' : 'none' }}
        >
          <RefreshCw size={13} className="player-change-btn__icon" />
          <span>Cambiar</span>
        </button>
      )}

      {/* Playback error fallback overlay */}
      {playbackError && (
        <div className="player-error-overlay" style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.92)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 40,
          gap: '1rem',
          padding: '1.5rem',
          textAlign: 'center'
        }}>
          <h4 style={{ color: '#f8fafc', fontSize: '1.1rem', margin: 0 }}>Error de Reproducción</h4>
          <p style={{ color: '#cbd5e1', fontSize: '0.85rem', maxWidth: '400px', margin: 0 }}>
            {playbackError}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button onClick={handleRetryStream} className="btn btn--primary" style={{ padding: '0.5rem 1rem', fontSize: '0.84rem' }}>
              <span>Reintentar</span>
            </button>
            {isHost && (
              <button onClick={() => openChangePanel()} className="btn btn--primary" style={{ padding: '0.5rem 1rem', fontSize: '0.84rem' }}>
                <span>Cambiar video (archivo o enlace)</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Floating Reactions Overlay — always pinned bottom-right, visible in fullscreen */}
      <div className="reactions-overlay">
        {reactions.map((r) => (
          <div
            key={r.id}
            className="floating-reaction"
            style={{ '--x-offset': `${r.xOffset ?? 0}px` } as React.CSSProperties}
          >
            <span>{r.emoji}</span>
            {r.user && <span className="floating-reaction__user">{r.user}</span>}
          </div>
        ))}
      </div>

      <video
        ref={videoRef}
        key={video.fileName || video.directUrl}
        className="player-container__video"
        controls
        playsInline
        preload="auto"
        onPlay={handlePlay}
        onPause={handlePause}
        onSeeked={handleSeeked}
        onError={handleVideoElementError}
      >
        Tu navegador no soporta reproducción de video HTML5.
      </video>

      {/* Change-video modal: upload a file OR paste a link (also reachable from the error overlay) */}
      {isHost && (
        <BottomSheet
          open={showChangePanel}
          onClose={() => setShowChangePanel(false)}
          label="Cambiar video de la sala"
          className="modal-card--change"
        >
            <div className="modal-card__header">
              <h3 style={{ margin: 0, fontSize: '1.02rem', color: '#f8fafc' }}>Cambiar video de la sala</h3>
            </div>
            <div className="dropzone-container" style={{ border: 'none', padding: 0 }}>
              <VideoUploadPicker {...pickerProps} />
            </div>
            <div className="room-settings__actions">
              <button
                type="button"
                className="host-exit-modal__cancel-btn"
                onClick={() => setShowChangePanel(false)}
              >
                Cancelar
              </button>
            </div>
        </BottomSheet>
      )}
    </div>
  );
};

export default VideoPlayer;
