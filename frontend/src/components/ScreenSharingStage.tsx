import { useEffect, useRef } from 'react';
import { Maximize2, Monitor } from 'lucide-react';
import type { PeerMediaState, RemotePeer } from '../hooks/useWebRTC';
import { Button } from '../shared/components/ui';
export function ScreenSharingStage({ localStream, isScreenSharing, remotePeers, peerMediaStates }: { localStream: MediaStream | null; isScreenSharing?: boolean; remotePeers: RemotePeer[]; peerMediaStates: Record<string, PeerMediaState> }) {
 const video = useRef<HTMLVideoElement>(null);
 const remote = remotePeers.find(peer => peerMediaStates[peer.socketId]?.isScreenSharing);
 const stream = isScreenSharing ? localStream : remote?.stream;
 const name = isScreenSharing ? 'Tu pantalla' : remote ? 'Pantalla de ' + remote.userName : '';
 useEffect(() => { const element = video.current; if (!element) return; element.srcObject = stream ?? null; if (stream) void element.play().catch(() => {}); return () => { element.srcObject = null; }; }, [stream]);
 if (!stream) return null;
 return <section className="screen-sharing-stage" aria-label={name}><header><span><Monitor size={16} />{name}</span><Button variant="icon" title="Ampliar pantalla compartida" aria-label="Ampliar pantalla compartida" onClick={() => { void video.current?.requestFullscreen?.().catch(() => {}); }}><Maximize2 size={18} /></Button></header><video ref={video} autoPlay playsInline muted /></section>;
}
