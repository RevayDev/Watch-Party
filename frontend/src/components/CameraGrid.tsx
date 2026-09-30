import React, { useEffect, useRef, useState } from 'react';
import { RemotePeer } from '../hooks/useWebRTC';
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
}

// ─── Audio Level Hook ──────────────────────────────────────────────────────────
function useIsSpeaking(stream: MediaStream | null, isLocal: boolean, isMicOn: boolean): boolean {
  const [speaking, setSpeaking] = useState(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || (isLocal && !isMicOn)) { setSpeaking(false); return; }
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) { setSpeaking(false); return; }

    let cancelled = false;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (cancelled) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        setSpeaking(rms > 12);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (_) {}

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      sourceRef.current?.disconnect();
      ctxRef.current?.close().catch(() => {});
      analyserRef.current = null; sourceRef.current = null; ctxRef.current = null;
      setSpeaking(false);
    };
  }, [stream, isMicOn]);

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
}> = ({ stream = null, userName, isHost = false, isLocal = false, isMicOn = true, isCameraOn = true }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isSpeaking = useIsSpeaking(stream, isLocal, isMicOn);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !stream) return;
    if (vid.srcObject !== stream) vid.srcObject = stream;
    vid.play().catch(() => {});
  }, [stream]);

  const hasVideo = stream && stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled && isCameraOn;
  const initial = userName.charAt(0).toUpperCase();

  return (
    <div className={`cam-tile ${isSpeaking ? 'cam-tile--speaking' : ''}`}>
      {/* Video */}
      {hasVideo ? (
        <video
          ref={videoRef}
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

      {/* Mic badge — top right */}
      <div className={`cam-tile__mic-badge ${isMicOn ? '' : 'cam-tile__mic-badge--off'}`}>
        {isMicOn
          ? <Mic size={12} color={isSpeaking ? '#10b981' : '#ffffff'} />
          : <MicOff size={12} color="#ffffff" />}
      </div>

      {/* Name bar — bottom left */}
      <div className="cam-tile__nameplate">
        {isHost && <Crown size={10} color="#f59e0b" />}
        <span className="cam-tile__name">{isLocal ? 'Tú' : userName}</span>
      </div>
    </div>
  );
};

// ─── Camera Grid ──────────────────────────────────────────────────────────────
export const CameraGrid: React.FC<CameraGridProps> = ({
  localStream,
  remotePeers,
  participants,
  currentUserName,
  isHost,
  isMicOn,
  isCameraOn,
}) => {
  const remotePeersByName = new Map(remotePeers.map(p => [p.userName.toLowerCase(), p]));
  const otherWithoutStream = participants.filter(
    p => p.name.toLowerCase() !== currentUserName.toLowerCase() && !remotePeersByName.has(p.name.toLowerCase())
  );

  return (
    <div className="cam-grid">
      {/* Local tile */}
      <CameraTile
        stream={localStream}
        userName={currentUserName}
        isHost={isHost}
        isLocal={true}
        isMicOn={isMicOn}
        isCameraOn={isCameraOn}
      />

      {/* Remote peers with active stream */}
      {remotePeers.map((peer) => (
        <CameraTile
          key={peer.socketId}
          stream={peer.stream}
          userName={peer.userName}
          isHost={peer.isHost}
          isLocal={false}
          isMicOn={true}
          isCameraOn={true}
        />
      ))}

      {/* Participants waiting (no stream yet) */}
      {otherWithoutStream.map((p) => (
        <CameraTile
          key={p.name}
          stream={null}
          userName={p.name}
          isHost={p.isHost}
          isLocal={false}
          isMicOn={false}
          isCameraOn={false}
        />
      ))}
    </div>
  );
};
