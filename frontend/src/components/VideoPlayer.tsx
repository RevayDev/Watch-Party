import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Film, UploadCloud, RefreshCw, Loader2, Volume2, Link as LinkIcon, AlertCircle } from 'lucide-react';
import Hls from 'hls.js';
import { IVideoMetadata, ReactionItem } from '../types/room';

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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsInstanceRef = useRef<Hls | null>(null);

  const [activeTab, setActiveTab] = useState<'upload' | 'url'>('upload');
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [isSubmittingUrl, setIsSubmittingUrl] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

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

  // Auto-hide overlay controls when fullscreen and mouse idle
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (isFullscreen) {
      hideControlsTimer.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) {
      setShowControls(true);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    } else {
      resetHideTimer();
    }
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [isFullscreen, resetHideTimer]);

  // HLS and Media Stream Setup with Recovery mechanism
  useEffect(() => {
    setPlaybackError(null);
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.destroy();
      hlsInstanceRef.current = null;
    }

    if (!video || !videoRef.current) return;

    const backendBase = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';
    const videoSrc = video.sourceType === 'url' && video.directUrl 
      ? video.directUrl 
      : `${backendBase}/api/rooms/${roomId}/video/stream`;

    const vid = videoRef.current;
    const isHls = video.sourceType === 'hls' || videoSrc.includes('.m3u8');

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

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.warn('HLS Network error encountered, attempting to recover...');
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.warn('HLS Media error encountered, attempting to recover...');
                hls.recoverMediaError();
                break;
              default:
                console.error('Fatal HLS error cannot be recovered:', data);
                setPlaybackError('No se pudo decodificar el stream HLS o el enlace expiró.');
                hls.destroy();
                break;
            }
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
  }, [video, roomId]);

  // Apply incoming remote sync actions with latency compensation
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

    if (diff > 0.5 || remoteAction.action === 'seek') {
      vid.currentTime = targetTime;
    }

    if (remoteAction.action === 'play') {
      if (vid.paused) {
        vid.play().catch(() => {});
      }
    } else if (remoteAction.action === 'pause') {
      if (!vid.paused) {
        vid.pause();
      }
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
      onUploadVideo(e.target.files[0]);
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
      onUploadVideo(e.dataTransfer.files[0]);
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
    } finally {
      setIsSubmittingUrl(false);
    }
  };

  const handleRetryStream = () => {
    setPlaybackError(null);
    if (videoRef.current) {
      videoRef.current.load();
    }
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
              <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
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
            <div className="dropzone-container">
              {/* Tab selector: Archivo Local vs Enlace Web / HLS / Drive */}
              <div className="dropzone-tabs">
                <button
                  type="button"
                  className={`dropzone-tab-btn ${activeTab === 'upload' ? 'dropzone-tab-btn--active' : ''}`}
                  onClick={() => setActiveTab('upload')}
                >
                  <UploadCloud size={16} />
                  <span>Subir Archivo</span>
                </button>
                <button
                  type="button"
                  className={`dropzone-tab-btn ${activeTab === 'url' ? 'dropzone-tab-btn--active' : ''}`}
                  onClick={() => setActiveTab('url')}
                >
                  <LinkIcon size={16} />
                  <span>Enlace Web / HLS</span>
                </button>
              </div>

              {activeTab === 'upload' ? (
                <div
                  className={`dropzone-box ${isDragOver ? 'dropzone-box--active' : ''}`}
                  onClick={triggerFileInput}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <UploadCloud size={40} className="dropzone-box__icon" />
                  <div className="dropzone-box__title">Sube una película o video</div>
                  <div className="dropzone-box__subtitle">
                    Arrastra tu archivo aquí o haz clic (.mp4, .mkv, .webm)
                  </div>
                  <button
                    type="button"
                    className="btn btn--primary"
                    style={{ marginTop: '0.25rem', padding: '0.5rem 1.25rem', fontSize: '0.84rem' }}
                  >
                    Seleccionar de mi PC
                  </button>
                </div>
              ) : (
                <form onSubmit={handleUrlSubmit} className="dropzone-url-card">
                  <div className="dropzone-input-group">
                    <label>Enlace del video o transmisión:</label>
                    <input
                      type="url"
                      required
                      placeholder="https://... playlist.m3u8 o Google Drive"
                      className="dropzone-input"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                    />
                  </div>
                  <div className="dropzone-input-group">
                    <label>Título de la película (opcional):</label>
                    <input
                      type="text"
                      placeholder="Ej: Interstellar (2014)"
                      className="dropzone-input"
                      value={titleInput}
                      onChange={(e) => setTitleInput(e.target.value)}
                    />
                  </div>

                  <div className="dropzone-supported-hints">
                    <span>✓ Compatible con transmisiones HLS (.m3u8, Yandex, etc.)</span>
                    <span>✓ Compatible con enlaces públicos de Google Drive</span>
                    <span>✓ Compatible con URLs directas (.mp4, .webm)</span>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingUrl || !urlInput.trim()}
                    className="btn btn--primary"
                    style={{ marginTop: '0.4rem', padding: '0.65rem', justifyContent: 'center' }}
                  >
                    {isSubmittingUrl ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Cargando enlace...</span>
                      </>
                    ) : (
                      'Transmitir Enlace en la Sala'
                    )}
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div className="dropzone-container" style={{ textAlign: 'center', alignItems: 'center' }}>
              <Film size={44} color="#818cf8" />
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>Aún no hay video en la sala</h3>
                <p style={{ fontSize: '0.84rem', color: '#94a3b8', marginTop: '0.35rem' }}>
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
              <Volume2 size={13} color="#f59e0b" />
              <span>30%</span>
            </span>
          )}

          {isHost && (
            <button
              onClick={triggerFileInput}
              className="player-change-btn"
              title="Cambiar video de la sala"
              type="button"
            >
              <RefreshCw size={14} />
              <span>Cambiar</span>
            </button>
          )}
        </div>
      </div>

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
          <AlertCircle size={40} color="#ef4444" />
          <h4 style={{ color: '#f8fafc', fontSize: '1.1rem', margin: 0 }}>Error de Reproducción</h4>
          <p style={{ color: '#cbd5e1', fontSize: '0.85rem', maxWidth: '400px', margin: 0 }}>
            {playbackError}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button onClick={handleRetryStream} className="btn btn--primary" style={{ padding: '0.5rem 1rem', fontSize: '0.84rem' }}>
              <RefreshCw size={14} />
              <span>Reintentar</span>
            </button>
            {isHost && (
              <button onClick={triggerFileInput} className="btn btn--secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.84rem' }}>
                <span>Subir otro archivo</span>
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
        onError={() => {
          if (!playbackError) {
            setPlaybackError('Hubo un problema al cargar el archivo de video. Verifica el formato o el enlace.');
          }
        }}
      >
        Tu navegador no soporta reproducción de video HTML5.
      </video>
    </div>
  );
};
