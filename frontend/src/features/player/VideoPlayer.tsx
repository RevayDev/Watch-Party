import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type Hls from 'hls.js';
import { IVideoMetadata, ReactionItem } from '../../types/room';

// hls.js (~500KB) solo se carga cuando el video es HLS (dynamic import).
let hlsModulePromise: Promise<typeof import('hls.js')> | null = null;
function loadHls(): Promise<typeof import('hls.js')> {
  if (!hlsModulePromise) hlsModulePromise = import('hls.js');
  return hlsModulePromise;
}
import { BottomSheet } from '../../shared/components/BottomSheet';
import { isDemoMode } from '../../shared/demo';
import { VideoUploadPicker } from './VideoUploadPicker';
import { useToasts } from '../../services/notifications';
import {
  anchorFromRemoteAction,
  behindSeconds,
  clampDuckPct,
  resolveLiveEdge,
  type LiveEdgeAnchor,
} from '../../shared/perf';

interface VideoPlayerProps {
  roomId: string;
  video: IVideoMetadata | null | undefined;
  isHost: boolean;
  onUploadVideo: (file: File) => Promise<void>;
  onSetVideoUrl?: (url: string, title?: string) => Promise<void>;
  uploadProgress: number | null;
  onSyncAction: (action: 'play' | 'pause' | 'seek', currentTime: number) => void;
  remoteAction: { action: 'play' | 'pause' | 'seek'; currentTime: number; sentAt?: number; timestamp: number; autoplay?: boolean } | null;
  reactions: ReactionItem[];
  isMicOn?: boolean; // used for auto-duck
  /** Periodic position report so the room can resolve a consensus time for newcomers */
  onPlaybackHeartbeat?: (currentTime: number, isPlaying: boolean) => void;
  /** Intervalo del heartbeat en ms: 2.5 s normal, 15 s en mala señal (lo decide Room). */
  heartbeatIntervalMs?: number;
  /** Handshake video-ready (Rol A): se llama una vez por video al estar listo para auto-play. */
  onVideoReady?: (fileName: string) => void;
  /** Rol B: atenuación activa (default ON). */
  duckingEnabled?: boolean;
  /** Rol B: nivel de atenuación en % 10–60 (default 30). */
  duckingLevelPct?: number;
  /** Rol B: mostrar reacciones flotantes (default ON). */
  reactionsEnabled?: boolean;
  /** Efectos visuales: combo Interestellar + animaciones largas (default ON). */
  visualEffects?: boolean;
  /** Combo Interestellar activo (lo detecta el padre, useRoomSocket). */
  interestellarActive?: boolean;
  /** Rol B: espejo de avisos dentro del player en fullscreen (default ON). */
  fullscreenToastsEnabled?: boolean;
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
  heartbeatIntervalMs = 2500,
  onVideoReady,
  duckingEnabled = true,
  duckingLevelPct = 30,
  reactionsEnabled = true,
  visualEffects = true,
  interestellarActive = false,
  fullscreenToastsEnabled = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsInstanceRef = useRef<Hls | null>(null);
  const lastLoadKeyRef = useRef<string | null>(null);

  // Demo: la subida de archivos está deshabilitada → el picker arranca en el
  // tab de enlace. Con VITE_DEMO_MODE=false arranca como hoy (subida).
  const demo = isDemoMode();
  const [activeTab, setActiveTab] = useState<'upload' | 'url'>(demo ? 'url' : 'upload');
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
  const [isBuffering, setIsBuffering] = useState(false);
  const isApplyingRemote = useRef(false);
  // Supresión extendida del auto-play grupal: el `play()` es asíncrono y el
  // evento `play`/`seeked` del elemento puede llegar tras los 300 ms base.
  const suppressUntilRef = useRef(0);
  const videoReadySentForRef = useRef<string | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Global player keyboard shortcuts (Space, F, M, Arrows) with input protection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      const isEditable = (document.activeElement as HTMLElement)?.isContentEditable;
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || isEditable) {
        return;
      }
      const vid = videoRef.current;
      if (!vid) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (vid.paused) {
          vid.play().catch(() => {});
        } else {
          vid.pause();
        }
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        if (!document.fullscreenElement) {
          containerRef.current?.requestFullscreen?.().catch(() => {});
        } else {
          document.exitFullscreen?.().catch(() => {});
        }
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        vid.muted = !vid.muted;
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        vid.currentTime = Math.max(0, vid.currentTime - 5);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        vid.currentTime = Math.min(vid.duration || vid.currentTime + 5, vid.currentTime + 5);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  // Auto-duck dinámico (rol B): baja el volumen del video mientras el micro
  // está activo. Nivel configurable 10–60 % (default 30 %) que llega por
  // ajustes de sala; se aplica en vivo sin recargar.
  const duckPct = clampDuckPct(duckingLevelPct);
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = isMicOn && duckingEnabled ? duckPct / 100 : 1.0;
  }, [isMicOn, duckingEnabled, duckPct]);

  // ── Rol B: espejo de avisos + badge "Atrasado" ──────────────────────────
  // Los toasts del root son invisibles en fullscreen nativo: se espeja el
  // último dentro del contenedor del player (que SÍ es visible en fullscreen).
  const mirrorToasts = useToasts();
  const fsToast = mirrorToasts.length > 0 ? mirrorToasts[mirrorToasts.length - 1] : null;
  const fsToastExtra = Math.max(0, mirrorToasts.length - 1);

  // ── Combo Interestellar (solo visual) ────────────────────────────────
  // Si llegan 🪐 y ✨ de DOS usuarios distintos en 5 s (ventana por
  // timestamp de llegada), se muestra el overlay especial ~4 s con fade.
  // `visualEffects === false` lo apaga; las reacciones normales siguen.
  // El estado viene del padre (useRoomSocket) a través de la prop
  // interestellarActive.

  // Borde en vivo = última acción grupal conocida (remoteAction/sentAt que ya
  // recibe el cliente) + tiempo transcurrido. Ticker local de 1 s que NO
  // emite nada: solo decide si mostrar el badge.
  const liveAnchorRef = useRef<LiveEdgeAnchor | null>(null);
  const [behindSecs, setBehindSecs] = useState(0);
  useEffect(() => {
    const prevPlaying = liveAnchorRef.current?.playing ?? false;
    liveAnchorRef.current = anchorFromRemoteAction(remoteAction, prevPlaying);
    if (!remoteAction) setBehindSecs(0);
  }, [remoteAction]);

  useEffect(() => {
    if (!video) return;
    const iv = window.setInterval(() => {
      const vid = videoRef.current;
      if (!vid) return;
      const live = resolveLiveEdge(liveAnchorRef.current, Date.now());
      setBehindSecs(behindSeconds(live, vid.currentTime, !vid.paused && !vid.ended));
    }, 1000);
    return () => window.clearInterval(iv);
  }, [video, roomId]);

  // Salto al consenso SIN alterar a los demás: seek puramente local. Se usa
  // el guardián `isApplyingRemote` existente para que onSeeked/onPlay no
  // emitan sync (cada uno reproduce su copia). Agente A: revisar al cablear.
  const seekToLive = useCallback(() => {
    const vid = videoRef.current;
    const live = resolveLiveEdge(liveAnchorRef.current, Date.now());
    if (!vid || live === null) return;
    const targetTime = Math.max(0, live);
    const willPlay = !vid.paused || Boolean(liveAnchorRef.current?.playing);
    isApplyingRemote.current = true;
    vid.currentTime = targetTime;
    if (!vid.paused) {
      // Ya reproduciendo: basta el seek.
    } else if (liveAnchorRef.current?.playing) {
      vid.play().catch(() => {});
    }
    liveAnchorRef.current = {
      timeSecs: targetTime,
      atMs: Date.now(),
      playing: willPlay,
    };
    setBehindSecs(0);
    window.setTimeout(() => {
      isApplyingRemote.current = false;
    }, 300);
  }, []);

  // Position heartbeat (2.5 s normal, 15 s en mala señal): lets the server
  // resolve the consensus time a (re)joining member should adopt. Skipped
  // without video or on error.
  useEffect(() => {
    if (!video || playbackError || !onPlaybackHeartbeat) return;
    const report = () => {
      const vid = videoRef.current;
      if (!vid || !Number.isFinite(vid.currentTime)) return;
      onPlaybackHeartbeat(vid.currentTime, !vid.paused && !vid.ended);
    };
    report();
    const iv = window.setInterval(report, heartbeatIntervalMs);
    return () => window.clearInterval(iv);
  }, [video, playbackError, onPlaybackHeartbeat, roomId, heartbeatIntervalMs]);

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

  // Identidad estable de la fuente: `room-state` recrea el objeto `video` en
  // cada mensaje. Depender del objeto entero desmontaba/recargaba HLS
  // (el cleanup destruye la instancia) aunque la fuente fuese idéntica.
  const videoSourceType = video?.sourceType;
  const videoDirectUrl = video?.directUrl;
  const videoFileName = video?.fileName;

  // HLS and Media Stream Setup with Recovery mechanism
  useEffect(() => {
    if ((!videoFileName && !videoDirectUrl) || !videoRef.current) {
      setPlaybackError(null);
      lastLoadKeyRef.current = null;
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
      return;
    }

    const backendBase = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';
    const isExternal = (videoSourceType === 'url' || videoSourceType === 'hls') && !!videoDirectUrl;
    // External URLs go through the backend CORS proxy so hls.js/XHR are not blocked
    const videoSrc = isExternal
      ? `${backendBase}/api/proxy?url=${encodeURIComponent(videoDirectUrl!)}`
      : `${backendBase}/api/rooms/${roomId}/video/stream`;

    const vid = videoRef.current;
    const isHls = videoSourceType === 'hls' || !!videoDirectUrl?.includes('.m3u8') || videoSrc.includes('.m3u8');

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
      if (vid.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Safari / iOS HLS support (sin descargar hls.js)
        vid.src = videoSrc;
      } else {
        let cancelled = false;
        loadHls()
          .then((mod) => {
            if (cancelled) return;
            // Revalidar: la fuente pudo cambiar mientras se descargaba hls.js.
            if (lastLoadKeyRef.current !== loadKey) return;
            const HlsClass = mod.default;
            if (!HlsClass.isSupported()) {
              setPlaybackError('Tu navegador no soporta reproducción HLS (.m3u8).');
              return;
            }
            const hls = new HlsClass({
              enableWorker: true,
              lowLatencyMode: true,
              backBufferLength: 90,
            });
            hlsInstanceRef.current = hls;
            hls.loadSource(videoSrc);
            hls.attachMedia(vid);

            let fatalNetworkRetries = 0;
            let fatalMediaRetries = 0;
            hls.on(HlsClass.Events.ERROR, (_event, data) => {
              if (!data.fatal) return;
              switch (data.type) {
                case HlsClass.ErrorTypes.NETWORK_ERROR:
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
                case HlsClass.ErrorTypes.MEDIA_ERROR:
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
          })
          .catch(() => {
            if (!cancelled) setPlaybackError('No se pudo cargar el reproductor HLS. Revisa tu conexión.');
          });
        return () => {
          cancelled = true;
          if (hlsInstanceRef.current) {
            hlsInstanceRef.current.destroy();
            hlsInstanceRef.current = null;
          }
        };
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
  }, [videoSourceType, videoDirectUrl, videoFileName, roomId, retryToken]);

  // Apply incoming remote sync actions with latency compensation and smooth tolerance.
  // Anti-bucle (Rol A): el play de consenso/autoplay SOLO dispara `play`,
  // nunca `seek` repetido ni re-emite `sync-video` (isApplyingRemote +
  // supresión extendida para el play asíncrono del auto-play grupal).
  useEffect(() => {
    if (!remoteAction || !videoRef.current) return;

    const vid = videoRef.current;
    isApplyingRemote.current = true;
    if (remoteAction.autoplay === true) {
      suppressUntilRef.current = Date.now() + 2000;
    }

    const latencyOffset = remoteAction.sentAt
      ? Math.max(0, (Date.now() - remoteAction.sentAt) / 1000)
      : 0;
    const targetTime =
      remoteAction.action === 'play'
        ? remoteAction.currentTime + latencyOffset
        : remoteAction.currentTime;

    const diff = Math.abs(vid.currentTime - targetTime);

    if (diff > 2 || remoteAction.action === 'seek') {
      vid.currentTime = targetTime;
    }

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

  const isLocalEchoSuppressed = () =>
    isApplyingRemote.current || Date.now() < suppressUntilRef.current;

  const handlePlay = () => {
    if (isLocalEchoSuppressed() || !videoRef.current) return;
    onSyncAction('play', videoRef.current.currentTime);
  };

  const handlePause = () => {
    if (isLocalEchoSuppressed() || !videoRef.current) return;
    onSyncAction('pause', videoRef.current.currentTime);
  };

  const handleSeeked = () => {
    if (isLocalEchoSuppressed() || !videoRef.current) return;
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

  // Handshake video-ready (Rol A): al terminar `video-changed`, cada cliente
  // avisa UNA vez por video cuando loadeddata + currentTime≈0. El servidor
  // responde con el `play` grupal (autoplay). Nunca pausa ni recarga nada.
  const handleLoadedData = () => {
    if (!onVideoReady || !videoRef.current) return;
    const loadKey = lastLoadKeyRef.current;
    if (!loadKey || videoReadySentForRef.current === loadKey) return;
    const atStart = Math.abs(videoRef.current.currentTime) < 1;
    if (!atStart) return;
    videoReadySentForRef.current = loadKey;
    onVideoReady(videoFileName || videoDirectUrl || '');
  };

  const openChangePanel = (tab?: 'upload' | 'url') => {
    // Default to the tab matching what is currently loaded (link -> link tab, file -> upload tab)
    // Demo: siempre el tab de enlace (la subida está deshabilitada).
    const defaultTab: 'upload' | 'url' = demo ? 'url' : video && video.sourceType !== 'file' ? 'url' : 'upload';
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
                label={demo ? 'Pegar enlace de Google Drive' : 'Subir video o pegar enlace'}
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
                  <span>{demo ? 'Pegar enlace de Google Drive' : 'Subir video o pegar enlace'}</span>
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
          {/* Volume duck indicator (rol B: muestra el % real configurado) */}
          {isMicOn && duckingEnabled && (
            <span
              className="player-volume-duck"
              title="Volumen reducido porque el micrófono está activo"
            >
              <span>Volumen {duckPct}%</span>
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

      {/* Floating Reactions Overlay — rol B: abajo-derecha dentro del
          contenedor (visible en fullscreen nativo), tamaño que escala con el
          viewport vía CSS (bloque "Perf overlays"). Ocultable por ajustes.
          Con visualEffects OFF las reacciones siguen pero sin animación larga. */}
      {reactionsEnabled && reactions.length > 0 && (
        <div className={`reactions-overlay${visualEffects ? '' : ' reactions-overlay--static'}`} aria-hidden="true">
          {reactions.map((r) => (
            <div
              key={r.id}
              className={`floating-reaction${visualEffects ? '' : ' floating-reaction--static'}`}
              style={{ '--x-offset': `${r.xOffset ?? 0}px` } as React.CSSProperties}
            >
              <span>{r.emoji}</span>
              {r.user && <span className="floating-reaction__user">{r.user}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Combo Interestellar: 🪐 + ✨ de dos usuarios distintos en 5 s.
          Solo visual (~4 s + fade). visualEffects OFF lo apaga. */}
      {visualEffects && interestellarActive && (
        <div className="interstellar-combo" aria-hidden="true">
          <div className="interstellar-combo__emojis">
            <span className="interstellar-combo__emoji">🪐</span>
            <span className="interstellar-combo__emoji">✨</span>
          </div>
          <p className="interstellar-combo__title">Interestellar</p>
        </div>
      )}

      {/* Espejo de avisos en fullscreen (rol B): 1 visible + contador de ráfaga */}
      {fullscreenToastsEnabled && fsToast && (
        <div className="player-fs-toasts" role="status" aria-live="polite">
          <div className={`player-fs-toast player-fs-toast--${fsToast.type}`}>
            <div className="player-fs-toast__body">
              {fsToast.title && <strong className="player-fs-toast__title">{fsToast.title}</strong>}
              <span className="player-fs-toast__message">{fsToast.message}</span>
            </div>
            {fsToastExtra > 0 && (
              <span className="player-fs-toast__more">+{fsToastExtra} más</span>
            )}
          </div>
        </div>
      )}

      {/* Badge "Atrasado −Xs · Ir al en vivo" (rol B): seek local, no emite sync */}
      {behindSecs > 3 && (
        <button
          type="button"
          className="player-live-badge"
          onClick={seekToLive}
          title="Saltar al punto en vivo del grupo (solo te afecta a ti)"
        >
          Atrasado −{Math.round(behindSecs)}s · Ir al en vivo
        </button>
      )}

      {/* Buffering Indicator */}
      {isBuffering && !playbackError && (
        <div className="player-buffering-indicator">
          <Loader2 size={32} className="player-buffering-indicator__spinner" />
          <span>Sincronizando...</span>
        </div>
      )}

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
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
        onLoadedData={handleLoadedData}
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
