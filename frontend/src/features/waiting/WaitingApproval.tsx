import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, Mic, MicOff, Video, VideoOff, Clock } from 'lucide-react';

interface WaitingApprovalProps {
  roomId: string;
  userName: string;
  roomName?: string;
  roomDescription?: string;
  /** Initial media preferences (kept from a previous attempt, if any) */
  initialMicOn?: boolean;
  initialCamOn?: boolean;
  /** Notified on every toggle so Room can carry the prefs into the actual join */
  onPrefChange?: (micOn: boolean, camOn: boolean) => void;
  /** Cancel the join request and leave */
  onCancel: () => void;
}

/**
 * Full-screen "waiting for leader approval" lobby.
 * Shows a live camera preview with mic/cam toggles so the guest can set up
 * before being admitted. Media is local-only: nothing is sent until approved.
 */
export const WaitingApproval: React.FC<WaitingApprovalProps> = ({
  roomId,
  userName,
  roomName,
  roomDescription,
  initialMicOn = false,
  initialCamOn = true,
  onPrefChange,
  onCancel,
}) => {
  const [micOn, setMicOn] = useState(initialMicOn);
  const [camOn, setCamOn] = useState(initialCamOn);
  const [mediaError, setMediaError] = useState('');
  const [askingPermission, setAskingPermission] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const camTrackRef = useRef<MediaStreamTrack | null>(null);

  // Keep the latest prefs available for the parent without stale closures
  const notifyPrefs = useCallback(
    (mic: boolean, cam: boolean) => {
      onPrefChange?.(mic, cam);
    },
    [onPrefChange]
  );

  const rebuildStream = useCallback(() => {
    const tracks: MediaStreamTrack[] = [];
    if (micTrackRef.current && micTrackRef.current.readyState === 'live') tracks.push(micTrackRef.current);
    if (camTrackRef.current && camTrackRef.current.readyState === 'live') tracks.push(camTrackRef.current);

    const stream = tracks.length > 0 ? new MediaStream(tracks) : null;
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      if (stream) {
        videoRef.current.play().catch(() => {});
      }
    }
  }, []);

  const stopAll = useCallback(() => {
    if (micTrackRef.current) {
      micTrackRef.current.stop();
      micTrackRef.current = null;
    }
    if (camTrackRef.current) {
      camTrackRef.current.stop();
      camTrackRef.current = null;
    }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Apply desired media state (mic/cam) to the local preview stream
  const applyMedia = useCallback(
    async (wantMic: boolean, wantCam: boolean) => {
      setAskingPermission(true);
      setMediaError('');
      try {
        // Microphone
        if (wantMic && !micTrackRef.current) {
          const s = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          const track = s.getAudioTracks()[0];
          if (track) micTrackRef.current = track;
        } else if (!wantMic && micTrackRef.current) {
          micTrackRef.current.stop();
          micTrackRef.current = null;
        }

        // Camera
        if (wantCam && !camTrackRef.current) {
          const s = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
          });
          const track = s.getVideoTracks()[0];
          if (track) camTrackRef.current = track;
        } else if (!wantCam && camTrackRef.current) {
          camTrackRef.current.stop();
          camTrackRef.current = null;
        }

        rebuildStream();
      } catch (err: any) {
        const name = err?.name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setMediaError('Permiso denegado. Permite el acceso a la cámara/micrófono en tu navegador.');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setMediaError('No se detectó cámara o micrófono disponible.');
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
          setMediaError('La cámara o micrófono está siendo usado por otra aplicación.');
        } else {
          setMediaError(`Error de dispositivo: ${err?.message || name || 'desconocido'}`);
        }
      } finally {
        // Sync toggles with what actually got granted (rolls back on error)
        // and propagate the real state so Room doesn't re-request on entry.
        const realMic = Boolean(micTrackRef.current && micTrackRef.current.readyState === 'live');
        const realCam = Boolean(camTrackRef.current && camTrackRef.current.readyState === 'live');
        setMicOn(realMic);
        setCamOn(realCam);
        notifyPrefs(realMic, realCam);
        setAskingPermission(false);
      }
    },
    [rebuildStream, notifyPrefs]
  );

  // Initial media state on mount
  useEffect(() => {
    if (initialMicOn || initialCamOn) {
      applyMedia(initialMicOn, initialCamOn);
    }
    return () => {
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    notifyPrefs(next, camOn);
    applyMedia(next, camOn);
  };

  const handleToggleCam = () => {
    const next = !camOn;
    setCamOn(next);
    notifyPrefs(micOn, next);
    applyMedia(micOn, next);
  };

  return (
    <div className="waiting-screen">
      <div className="waiting-card">
        {/* Barra de carga: borde superior de la card, color dominante de la interfaz */}
        <div className="waiting-card__topbar" aria-hidden="true">
          <span />
        </div>
        <div className="waiting-card__head">
          <span className="waiting-card__badge" aria-hidden="true">
            <Clock size={18} />
          </span>
          <div>
            <h2>Esperando aprobación</h2>
            <p>
              Un anfitrión o co-anfitrión debe permitir tu entrada a <strong>{roomId}</strong>
            </p>
          </div>
        </div>

        {(roomName?.trim() || roomDescription?.trim()) && (
          <div className="waiting-card__room">
            {roomName?.trim() && <strong>{roomName.trim()}</strong>}
            {roomDescription?.trim() && <span>{roomDescription.trim()}</span>}
          </div>
        )}

        {/* Camera preview */}
        <div className={`waiting-preview ${camOn ? '' : 'waiting-preview--off'}`}>
          <video ref={videoRef} className="waiting-preview__video" autoPlay playsInline muted />
          {!camOn && (
            <div className="waiting-preview__placeholder">
              <span>{userName.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <span className="waiting-preview__name">{userName} (tú)</span>
          {askingPermission && (
            <span className="waiting-preview__loading">
              <Loader2 size={14} className="animate-spin" />
            </span>
          )}
        </div>

        {mediaError && <div className="waiting-error">⚠️ {mediaError}</div>}

        {/* Media controls */}
        <div className="waiting-controls">
          <button
            type="button"
            onClick={handleToggleMic}
            className={`meet-circle-btn meet-circle-btn--text ${micOn ? 'meet-circle-btn--mic-on' : 'meet-circle-btn--off'}`}
            title={micOn ? 'Apagar micrófono' : 'Encender micrófono'}
          >
            {micOn ? <Mic size={16} /> : <MicOff size={16} />}
            <span>Mic {micOn ? 'activado' : 'apagado'}</span>
          </button>
          <button
            type="button"
            onClick={handleToggleCam}
            className={`meet-circle-btn meet-circle-btn--text ${camOn ? 'meet-circle-btn--on' : 'meet-circle-btn--off'}`}
            title={camOn ? 'Apagar cámara' : 'Encender cámara'}
          >
            {camOn ? <Video size={16} /> : <VideoOff size={16} />}
            <span>Cámara {camOn ? 'encendida' : 'apagada'}</span>
          </button>
        </div>

        <button type="button" className="waiting-cancel" onClick={onCancel}>
          <span>Cancelar solicitud</span>
        </button>
      </div>
    </div>
  );
};

export default WaitingApproval;
