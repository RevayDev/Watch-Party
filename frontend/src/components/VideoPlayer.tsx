import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Film, UploadCloud, RefreshCw, Loader2, Volume2 } from 'lucide-react';
import { IVideoMetadata, ReactionItem } from '../types/room';

interface VideoPlayerProps {
  roomId: string;
  video: IVideoMetadata | null | undefined;
  isHost: boolean;
  onUploadVideo: (file: File) => Promise<void>;
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
  uploadProgress,
  onSyncAction,
  remoteAction,
  reactions,
  isMicOn = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
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
    // When mic is on lower to 30% so voice can be heard clearly
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

  // 1. Upload in progress state
  if (uploadProgress !== null) {
    return (
      <div ref={containerRef} className="player-container">
        <div className="player-container__placeholder">
          <Loader2 size={40} className="animate-spin" color="#6366f1" />
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Subiendo video al servidor...</h3>
          <p style={{ fontSize: '0.9rem' }}>{uploadProgress}% completado</p>
          <div className="upload-progress">
            <div className="upload-progress__bar" style={{ width: `${uploadProgress}%` }} />
          </div>
          <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
            Los videos grandes pueden tardar unos segundos según tu conexión.
          </span>
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
            <div
              className={`dropzone ${isDragOver ? 'dropzone--active' : ''}`}
              onClick={triggerFileInput}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <UploadCloud size={44} className="dropzone__icon" />
              <div className="dropzone__title">Sube una película o video</div>
              <div className="dropzone__subtitle">
                Haz clic o arrastra tu archivo aquí (.mp4, .mkv, .webm, etc.)
              </div>
              <button
                type="button"
                className="btn btn--primary"
                style={{ marginTop: '0.5rem', padding: '0.5rem 1.2rem', fontSize: '0.875rem' }}
              >
                Seleccionar archivo
              </button>
            </div>
          ) : (
            <>
              <Film size={48} color="#6366f1" />
              <div>
                <h3>Aún no hay video en la sala</h3>
                <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
                  Esperando a que el Anfitrión (Host) suba una película para comenzar.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // 3. Fast HTTP 206 Byte-Range streaming URL
  const backendBase = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';
  const videoSrc = `${backendBase}/api/rooms/${roomId}/video/stream`;
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
        key={video.fileName}
        className="player-container__video"
        controls
        playsInline
        preload="auto"
        src={videoSrc}
        onPlay={handlePlay}
        onPause={handlePause}
        onSeeked={handleSeeked}
      >
        Tu navegador no soporta reproducción de video HTML5.
      </video>
    </div>
  );
};
