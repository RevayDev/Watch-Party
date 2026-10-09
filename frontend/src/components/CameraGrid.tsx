import React, { useEffect, useRef, useState } from 'react';
import { RemotePeer, PeerMediaState } from '../hooks/useWebRTC';
import type { PeerSignalState } from '../shared/webrtc-quality';
import { IParticipant } from '../types/room';
import { Crown, Mic, MicOff } from 'lucide-react';

interface CameraGridProps {
  localStream: MediaStream | null;
  remotePeers: RemotePeer[];
  participants: IParticipant[];
  currentUserName: string;
  isLeader: boolean;
  isMicOn: boolean;
  isCameraOn: boolean;
  peerMediaStates?: Record<string, PeerMediaState>;
  /**
   * Rol B (ahorro de datos): con true, las cámaras REMOTAS se muestran como
   * avatar (audio-only). El elemento <audio> remoto sigue sonando; no se toca
   * nada de useWebRTC (solo presentación). Agente A: si deshabilita pistas a
   * nivel WebRTC, compone sin conflicto con este interruptor.
   */
  dataSaverMode?: boolean;
  /** Rol A: señal por peer remoto (key = socketId o nombre en minúsculas). */
  peerSignalStates?: Record<string, PeerSignalState>;
}

// ─── Audio Level Speaking Hook ────────────────────────────────────────────────
function useIsSpeaking(stream: MediaStream | null, isLocal: boolean, isMicOn: boolean): boolean {
  const [speaking, setSpeaking] = useState(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || !isMicOn) {
      setSpeaking(false);
      return;
    }
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setSpeaking(false);
      return;
    }

    let cancelled = false;
    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;

    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (cancelled) return;
        analyser?.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        setSpeaking(avg > 15);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {}

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      source?.disconnect();
      ctx?.close().catch(() => {});
      setSpeaking(false);
    };
  }, [stream, isMicOn, isLocal]);

  return speaking;
}

// ─── Single Camera Tile ────────────────────────────────────────────────────────
const CameraTile: React.FC<{
  stream?: MediaStream | null;
  userName: string;
  isLeader?: boolean;
  isLocal?: boolean;
  isMicOn?: boolean;
  isCameraOn?: boolean;
  /** El remoto se congeló o pierde paquetes: avatar + "señal débil" (el audio sigue). */
  weakSignal?: boolean;
  /** Nivel crítico: audio-only en recepción (se oculta su <video>, nunca su <audio>). */
  criticalSignal?: boolean;
}> = ({ stream = null, userName, isLeader = false, isLocal = false, isMicOn = false, isCameraOn = false, weakSignal = false, criticalSignal = false }) => {
  const isSpeaking = useIsSpeaking(stream, isLocal, isMicOn);
  const initial = (userName || '?').charAt(0).toUpperCase();
  // Remoto con señal débil/crítica: no mostrar el frame congelado; el <audio>
  // remoto de arriba sigue sonando siempre (audio-only en recepción).
  const showFrozenAvatar = !isLocal && (weakSignal || criticalSignal);

  return (
    <div className={`cam-tile ${isSpeaking ? 'cam-tile--speaking' : ''}`}>
      {/* Remote Audio Track Player (Always active to ensure clear sound output) */}
      {!isLocal && stream && (
        <audio
          ref={(el) => {
            if (el && el.srcObject !== stream) {
              el.srcObject = stream;
              el.play().catch(() => {});
            }
          }}
          autoPlay
          playsInline
        />
      )}

      {/* Video Element when Camera is ON */}
      {isCameraOn && (isLocal || stream) && !showFrozenAvatar ? (
        <video
          ref={(el) => {
            if (el && stream && el.srcObject !== stream) {
              el.srcObject = stream;
              el.play().catch(() => {});
            }
          }}
          autoPlay
          playsInline
          muted={isLocal}
          className={`cam-tile__video ${isLocal ? 'cam-tile__video--mirror' : ''}`}
        />
      ) : (
        <div className="cam-tile__avatar-bg">
          <div className={`cam-tile__avatar-circle ${isSpeaking ? 'cam-tile__avatar-circle--speaking' : ''}`}>
            {initial}
          </div>
        </div>
      )}

      {/* Señal débil: insignia sobre el avatar en vez del frame congelado */}
      {showFrozenAvatar && (
        <div className="cam-tile__signal-badge" title="Conexión débil: solo se escucha el audio">
          <span className="cam-tile__signal-dot" />
          <span>señal débil</span>
        </div>
      )}

      {/* Mic Badge — icon stays white; speaking is shown by the tile/avatar frame only */}
      <div className={`cam-tile__mic-badge ${isMicOn ? '' : 'cam-tile__mic-badge--off'}`}>
        {isMicOn
          ? <Mic size={12} color="#ffffff" />
          : <MicOff size={12} color="#ffffff" />}
      </div>

      {/* Name plate */}
      <div className="cam-tile__nameplate">
        {isLeader && <Crown size={10} color="#f59e0b" />}
        <span className="cam-tile__name">{isLocal ? 'Tú' : userName}</span>
      </div>
    </div>
  );
};

// ─── Camera Grid Container ─────────────────────────────────────────────────────
export const CameraGrid: React.FC<CameraGridProps> = ({
  localStream,
  remotePeers,
  participants,
  currentUserName,
  isLeader,
  isMicOn,
  isCameraOn,
  peerMediaStates = {},
  dataSaverMode = false,
  peerSignalStates = {},
}) => {
  const normCurrent = (currentUserName || '').trim().toLowerCase();

  // Deduplicate participants excluding current user
  const otherParticipantsMap = new Map<string, IParticipant>();
  participants.forEach((p) => {
    const norm = (p.name || '').trim().toLowerCase();
    if (norm && norm !== normCurrent && !otherParticipantsMap.has(norm)) {
      otherParticipantsMap.set(norm, p);
    }
  });

  const otherList = Array.from(otherParticipantsMap.values());

  // Map remote peers by lowercase username
  const remotePeersByName = new Map<string, RemotePeer>();
  remotePeers.forEach((p) => {
    const norm = (p.userName || '').trim().toLowerCase();
    if (norm && norm !== normCurrent) {
      remotePeersByName.set(norm, p);
    }
  });

  return (
    <div className={`cam-grid${dataSaverMode ? ' cam-grid--datasaver' : ''}`}>
      {/* 1. Local User Tile */}
      <CameraTile
        stream={localStream}
        userName={currentUserName}
        isLeader={isLeader}
        isLocal={true}
        isMicOn={isMicOn}
        isCameraOn={isCameraOn}
      />

      {/* 2. Other Participants Tiles */}
      {otherList.map((p, idx) => {
        const norm = p.name.trim().toLowerCase();
        const peer = remotePeersByName.get(norm) || (otherList.length === 1 && remotePeers.length === 1 ? remotePeers[0] : remotePeers[idx]);
        const stream = peer?.stream || null;
        const mediaState = peerMediaStates[norm] || (peer?.socketId ? peerMediaStates[peer.socketId] : undefined);

        // Strict media state check
        const peerCameraOn = mediaState?.isCameraOn !== undefined
          ? mediaState.isCameraOn
          : Boolean(stream && stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled && !t.muted));

        const peerMicOn = mediaState?.isMicOn !== undefined
          ? mediaState.isMicOn
          : false;

        // Señal del remoto (por socketId; respaldo por nombre en minúsculas).
        const signal = (peer?.socketId ? peerSignalStates[peer.socketId] : undefined)
          ?? peerSignalStates[norm];

        return (
          <CameraTile
            key={p.name}
            stream={stream}
            userName={p.name}
            isLeader={p.isLeader}
            isLocal={false}
            isMicOn={peerMicOn}
            // Rol B (ahorro): avatar en vez de vídeo remoto; el audio sigue
            // sonando por el <audio> dedicado del tile.
            isCameraOn={dataSaverMode ? false : peerCameraOn}
            weakSignal={signal?.weak === true}
            criticalSignal={signal?.critical === true}
          />
        );
      })}
    </div>
  );
};
