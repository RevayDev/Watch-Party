import { useEffect, useRef } from 'react';
import { Maximize2, Monitor, MonitorOff } from 'lucide-react';
import type { PeerMediaState, RemotePeer } from '../hooks/useWebRTC';
import { Button } from '../shared/components/ui';
export function ScreenSharingStage({ localScreenStream, isScreenSharing, remotePeers, peerMediaStates, onStopSharing }: { localScreenStream: MediaStream | null; isScreenSharing?: boolean; remotePeers: RemotePeer[]; peerMediaStates: Record<string, PeerMediaState>; onStopSharing?: () => void }) {
 const video = useRef<HTMLVideoElement>(null);
 const remote = remotePeers.find(peer => peerMediaStates[peer.socketId]?.isScreenSharing && peer.screenStream);
 // Never paint the presenter's captured display back into the presenter UI.
 // When the whole screen is selected that would create the recursive mirror.
 const stream = isScreenSharing ? null : remote?.screenStream;
 const name = remote ? 'Pantalla de ' + remote.userName : '';
 useEffect(() => { const element = video.current; if (!element) return; element.srcObject = stream ?? null; if (stream) void element.play().catch(() => {}); return () => { element.srcObject = null; }; }, [stream]);
 if (isScreenSharing && localScreenStream) return <section className="screen-sharing-stage screen-sharing-stage--local" aria-label="Estás compartiendo tu pantalla">
   <div className="screen-sharing-stage__local-notice">
     <span className="screen-sharing-stage__local-icon"><Monitor size={28} /></span>
     <div><strong>Estás compartiendo tu pantalla</strong><p>Ocultamos la vista previa para evitar el efecto espejo.</p></div>
     <Button variant="danger" type="button" onClick={onStopSharing}><MonitorOff size={17} /> Dejar de compartir</Button>
   </div>
 </section>;
 if (!stream) return null;
 return <section className="screen-sharing-stage" aria-label={name}><header><span><Monitor size={16} />{name}</span><Button variant="icon" title="Ampliar pantalla compartida" aria-label="Ampliar pantalla compartida" onClick={() => { void video.current?.requestFullscreen?.().catch(() => {}); }}><Maximize2 size={18} /></Button></header><video ref={video} autoPlay playsInline muted /></section>;
}
