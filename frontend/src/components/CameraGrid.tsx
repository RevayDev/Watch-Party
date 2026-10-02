import React, { useEffect, useRef, useState } from 'react';
import { RemotePeer, PeerMediaState } from '../hooks/useWebRTC';
import { IParticipant } from '../types/room';
import { Crown, Mic, MicOff } from 'lucide-react';

interface CameraGridProps {
  localStream: MediaStream | null;
  remotePeers: RemotePeer[];
  participants: IParticipant[];
  currentUserName: string;
  isHost: boolean;
  isMicOn: boolean;
  isCameraOn: boolean;
  peerMediaStates?: Record<string, PeerMediaState>;
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
    } catch (_) {}

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
  isHost?: boolean;
  isLocal?: boolean;
  isMicOn?: boolean;
  isCameraOn?: boolean;
}> = ({ stream = null, userName, isHost = false, isLocal = false, isMicOn = false, isCameraOn = false }) => {
  const isSpeaking = useIsSpeaking(stream, isLocal, isMicOn);
  const initial = (userName || '?').charAt(0).toUpperCase();

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
      {isCameraOn && (isLocal || stream) ? (
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

      {/* Mic Badge — icon stays white; speaking is shown by the tile/avatar frame only */}
      <div className={`cam-tile__mic-badge ${isMicOn ? '' : 'cam-tile__mic-badge--off'}`}>
        {isMicOn
          ? <Mic size={12} color="#ffffff" />
          : <MicOff size={12} color="#ffffff" />}
      </div>

      {/* Name plate */}
      <div className="cam-tile__nameplate">
        {isHost && <Crown size={10} color="#f59e0b" />}
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
  isHost,
  isMicOn,
  isCameraOn,
  peerMediaStates = {},
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
    <div className="cam-grid">
      {/* 1. Local User Tile */}
      <CameraTile
        stream={localStream}
        userName={currentUserName}
        isHost={isHost}
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

        return (
          <CameraTile
            key={p.name}
            stream={stream}
            userName={p.name}
            isHost={p.isHost}
            isLocal={false}
            isMicOn={peerMicOn}
            isCameraOn={peerCameraOn}
          />
        );
      })}
    </div>
  );
};
