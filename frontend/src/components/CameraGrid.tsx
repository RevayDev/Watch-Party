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
  const audioRef = useRef<HTMLAudioElement>(null);
  const isSpeaking = useIsSpeaking(stream, isLocal, isMicOn);
  // Track version counter to force re-renders when remote tracks change
  const [, setTrackVersion] = useState(0);

  // Listen to track add/remove/mute/unmute events on the stream
  useEffect(() => {
    if (!stream) return;
    const bump = () => setTrackVersion((v) => v + 1);
    stream.addEventListener('addtrack', bump);
    stream.addEventListener('removetrack', bump);
    // Also listen for individual track mute/unmute
    const tracks = stream.getTracks();
    tracks.forEach((t) => {
      t.addEventListener('mute', bump);
      t.addEventListener('unmute', bump);
      t.addEventListener('ended', bump);
    });
    return () => {
      stream.removeEventListener('addtrack', bump);
      stream.removeEventListener('removetrack', bump);
      tracks.forEach((t) => {
        t.removeEventListener('mute', bump);
        t.removeEventListener('unmute', bump);
        t.removeEventListener('ended', bump);
      });
    };
  }, [stream]);

  useEffect(() => {
    const vid = videoRef.current;
    if (vid && stream) {
      if (vid.srcObject !== stream) vid.srcObject = stream;
      vid.play().catch(() => {});
    }

    // Explicit audio playback for remote peers to guarantee sound is heard
    const aud = audioRef.current;
    if (aud && stream && !isLocal) {
      if (aud.srcObject !== stream) aud.srcObject = stream;
      aud.play().catch(() => {});
    }
  }, [stream, isLocal]);

  // Derive actual video/audio state from the stream tracks (works for remote peers too)
  const videoTracks = stream?.getVideoTracks() || [];
  const audioTracks = stream?.getAudioTracks() || [];
  const hasVideo = isLocal
    ? Boolean(videoTracks.length > 0 && videoTracks[0].enabled && isCameraOn)
    : Boolean(videoTracks.length > 0 && videoTracks[0].readyState === 'live' && !videoTracks[0].muted);
  const hasAudio = isLocal
    ? isMicOn
    : Boolean(audioTracks.length > 0 && audioTracks[0].readyState === 'live');

  const initial = userName.charAt(0).toUpperCase();
  const effectiveMicOn = isLocal ? isMicOn : hasAudio;

  return (
    <div className={`cam-tile ${isSpeaking ? 'cam-tile--speaking' : ''}`}>
      {/* Hidden audio element for remote stream to guarantee audio output */}
      {!isLocal && (
        <audio
          ref={audioRef}
          autoPlay
          playsInline
        />
      )}

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
      <div className={`cam-tile__mic-badge ${effectiveMicOn ? '' : 'cam-tile__mic-badge--off'}`}>
        {effectiveMicOn
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
  // Map remote peers by socketId or lowercase userName
  const remotePeersMap = new Map<string, RemotePeer>();
  remotePeers.forEach((p) => {
    if (p.socketId) remotePeersMap.set(p.socketId, p);
    if (p.userName) remotePeersMap.set(p.userName.toLowerCase(), p);
  });

  // Filter other participants in the room
  const otherParticipants = participants.filter(
    (p) => p.name.toLowerCase() !== currentUserName.toLowerCase()
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

      {/* Other participants in the room: matched with their WebRTC stream if available */}
      {otherParticipants.map((p) => {
        const peer = remotePeersMap.get(p.name.toLowerCase());
        const stream = peer?.stream || null;
        const hasAudio = Boolean(stream && stream.getAudioTracks().length > 0 && stream.getAudioTracks()[0].enabled);
        const hasVideo = Boolean(stream && stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled);

        return (
          <CameraTile
            key={p.name}
            stream={stream}
            userName={p.name}
            isHost={p.isHost}
            isLocal={false}
            isMicOn={hasAudio}
            isCameraOn={hasVideo}
          />
        );
      })}

      {/* Any remote peers discovered via WebRTC that might not be in DB participants yet */}
      {remotePeers
        .filter((p) => !otherParticipants.some((op) => op.name.toLowerCase() === p.userName.toLowerCase()))
        .map((peer) => (
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
    </div>
  );
};
