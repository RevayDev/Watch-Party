import { useEffect, useMemo, useRef, useState } from 'react';
import type { RemotePeer } from '../hooks/useWebRTC';

function RemoteAudioTrack({ track, userName }: { track: MediaStreamTrack; userName: string }) {
  const stream = useMemo(() => new MediaStream([track]), [track]);
  const audio = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.srcObject = stream;
    let active = true;
    element.play().catch((error: DOMException) => {
      if (active && error.name === 'NotAllowedError') setBlocked(true);
    });
    return () => {
      active = false;
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <>
      <audio ref={audio} autoPlay onPlaying={() => setBlocked(false)} />
      {blocked && (
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => audio.current?.play().then(() => setBlocked(false)).catch(() => {})}
        >
          Escuchar a {userName}
        </button>
      )}
    </>
  );
}

export function RemoteAudio({ peers }: { peers: RemotePeer[] }) {
  const tracks = peers.flatMap(({ socketId, stream, userName }) =>
    stream.getAudioTracks().map((track) => (
      <RemoteAudioTrack key={`${socketId}:${track.id}`} track={track} userName={userName} />
    ))
  );
  return tracks.length > 0 ? <div className="remote-audio">{tracks}</div> : null;
}
