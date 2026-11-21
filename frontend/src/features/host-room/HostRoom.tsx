import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Mic, MicOff, Settings, Video, VideoOff } from 'lucide-react';
import { Chat } from '../chat/Chat';
import { VideoPlayer } from '../player/VideoPlayer';
import { CameraGrid } from '../../components/CameraGrid';
import { RemoteAudio } from '../../components/RemoteAudio';
import { MediaSettings } from '../../components/MediaSettings';
import { BottomSheet } from '../../shared/components/BottomSheet';
import { useWebRTC } from '../../hooks/useWebRTC';
import { parseYouTubeUrl } from '../../shared/youtube';
import { HostSession, type HostSessionView } from './HostSession';
import { hostInvite, type HostRoomOptions } from './protocol';
import type { IVideoMetadata } from '../../types/room';
import './host-room.css';

const initialView: HostSessionView = {
  id: '', state: null, status: 'Conectando…', error: '', fileUrl: null, fileProgress: 0, replicas: 0,
};

export function HostRoom({ options, onLeave }: { options: HostRoomOptions; onLeave: () => void }) {
  const [name, setName] = useState(options.name);
  const [entered, setEntered] = useState(!!options.name);
  if (!entered) {
    return (
      <main className="host-room-entry">
        <form className="room-settings__box" onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) setEntered(true);
        }}>
          <h2>Entrar a la sala del anfitrión</h2>
          <label htmlFor="host-member-name">Tu nombre</label>
          <input id="host-member-name" className="form-group__input" value={name} maxLength={50} required onChange={(event) => setName(event.target.value)} />
          <p>La sala y sus copias se mantienen en los navegadores conectados.</p>
          <button type="submit" className="btn btn--primary">Entrar</button>
          <button type="button" className="leader-exit-modal__cancel-btn" onClick={onLeave}>Volver</button>
        </form>
      </main>
    );
  }
  return <ConnectedHostRoom options={{ ...options, name: name.trim() }} onLeave={onLeave} />;
}

function ConnectedHostRoom({ options, onLeave }: { options: HostRoomOptions; onLeave: () => void }) {
  const [view, setView] = useState(initialView);
  const [session, setSession] = useState<HostSession | null>(null);
  const optionsRef = useRef(options);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const state = view.state;
  const isHost = state?.hostId === view.id;
  const media = useWebRTC(session, options.roomId, options.name, isHost);
  useEffect(() => {
    const current = new HostSession(optionsRef.current, setView);
    setSession(current);
    current.start();
    return () => current.stop();
  }, []);

  const selected = state?.video;
  let video: IVideoMetadata | null = null;
  if (selected && (selected.source !== 'file' || view.fileUrl)) {
    video = {
      fileName: selected.id, originalName: selected.name, sizeBytes: selected.size, mimeType: selected.mime,
      sourceType: selected.source === 'youtube' ? 'youtube' : 'url',
      directUrl: selected.source === 'file' ? view.fileUrl! : selected.url,
    };
  }

  const selectFile = async (file: File) => {
    setError('');
    try { await session?.selectFile(file); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo compartir el video.');
    }
  };

  const setVideoUrl = async (input: string) => {
    setError('');
    try {
      const parsed = new URL(input);
      if (parsed.protocol !== 'https:') throw new Error('Usa un enlace HTTPS de video.');
      const youtube = parseYouTubeUrl(input);
      session?.command({ type: 'video', video: {
        id: crypto.randomUUID(), name: youtube ? 'YouTube' : parsed.pathname.split('/').pop() || 'Video',
        source: youtube ? 'youtube' : 'url', url: youtube?.cleanUrl ?? parsed.href, size: 0, mime: 'video/mp4',
      } });
      setUrl('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enlace inválido.');
    }
  };

  return (
    <div className="host-room">
      <header className="host-room__header">
        <button type="button" className="meet-circle-btn" aria-label="Salir de la sala" onClick={onLeave}><ArrowLeft size={18} /></button>
        <div><strong>Sala entre navegadores</strong><p role="status">{view.status}</p></div>
        <button type="button" className="btn btn--primary" onClick={() => {
          void navigator.clipboard.writeText(hostInvite(options.roomId, options.key))
            .then(() => setCopied(true)).catch(() => setError('No se pudo copiar. Copia el enlace desde la barra del navegador.'));
        }}><Copy size={16} /> {copied ? 'Enlace copiado' : 'Invitar'}</button>
        <button type="button" className="meet-circle-btn" aria-label="Configuración del servidor" onClick={() => setSettingsOpen(true)}><Settings size={18} /></button>
      </header>
      {(view.error || error || media.mediaError) && <p role="alert" className="meet-error-banner">{view.error || error || media.mediaError}</p>}
      {media.mediaConnectionFailed && <button type="button" className="btn btn--primary" onClick={media.retryMediaConnection}>Reconectar micrófonos y cámaras</button>}
      {!state ? (
        <main className="host-room-entry">
          <p role="status">{view.status} La señalización puede tardar unos segundos.</p>
          <p>El anfitrión o un participante con una copia debe seguir conectado para recuperar una sala.</p>
        </main>
      ) : (
        <>
          <main className="host-room__stage">
            <section className="host-room__player">
              <RemoteAudio peers={media.remotePeers} />
              {selected?.source === 'file' && !view.fileUrl ? (
                <div className="drawer-chat__empty" role="status">
                  Recibiendo el video completo antes de reproducir… {view.fileProgress}%
                  <progress max={100} value={view.fileProgress} aria-label="Recepción del video" />
                  <button type="button" className="btn btn--primary" onClick={() => session?.retryVideo()}>Reintentar copia</button>
                </div>
              ) : (
                <VideoPlayer
                  directPlayback roomId={options.roomId} video={video} isLeader={isHost}
                  onUploadVideo={selectFile} onSetVideoUrl={setVideoUrl} uploadProgress={null}
                  reactions={[]} isMicOn={media.isMicOn}
                  onSyncAction={(action, currentTime) => session?.command({ type: 'playback', action, currentTime })}
                  onPlaybackHeartbeat={isHost ? (currentTime, playing) => session?.command({
                    type: 'playback', action: playing ? 'play' : 'pause', currentTime,
                  }) : undefined}
                  remoteAction={isHost ? null : state.playback}
                />
              )}
            </section>
            <aside className="host-room__chat"><Chat messages={state.messages} currentUserName={options.name}
              onSendMessage={(text, reply) => session?.command({ type: 'chat', text, id: crypto.randomUUID(), replyTo: reply?.id })}
              onEditMessage={(id, text) => session?.command({ type: 'edit-chat', id, text })} />
            </aside>
          </main>
          <CameraGrid localStream={media.localStream} remotePeers={media.remotePeers}
            participants={state.members.map((member) => ({
              name: member.name, isLeader: member.id === state.hostId, socketId: member.id,
              joinedAt: new Date(member.joinedAt).toISOString(),
            }))}
            currentUserName={options.name} isLeader={isHost} isMicOn={media.isMicOn} isCameraOn={media.isCameraOn}
            peerMediaStates={media.peerMediaStates} peerSignalStates={media.peerSignalStates} />
          <footer className="host-room__controls">
            <button type="button" className="meet-circle-btn" onClick={() => void media.toggleMic()} aria-label={media.isMicOn ? 'Silenciar micrófono' : 'Activar micrófono'}>
              {media.isMicOn ? <Mic size={18} /> : <MicOff size={18} />}
            </button>
            <button type="button" className="meet-circle-btn" onClick={() => void media.toggleCamera()} aria-label={media.isCameraOn ? 'Apagar cámara' : 'Activar cámara'}>
              {media.isCameraOn ? <Video size={18} /> : <VideoOff size={18} />}
            </button>
            <button type="button" className="leader-exit-modal__cancel-btn" onClick={() => setDevicesOpen(true)}>Probar dispositivos</button>
          </footer>
        </>
      )}
      {devicesOpen && <MediaSettings localStream={media.localStream} onClose={() => setDevicesOpen(false)} onRetry={media.retryMediaConnection} />}
      <BottomSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} label="Servidor de la sala" className="modal-card--settings host-server-settings">
        <h3>Servidor de la sala</h3>
        <p>{view.status}. {state?.members.length ?? 0} {state?.members.length === 1 ? 'participante' : 'participantes'}, hasta 8 por sala.</p>
        {state && !isHost && <button type="button" className="leader-exit-modal__cancel-btn" onClick={() => session?.requestTakeover()}>Solicitar relevo del servidor</button>}
        <p>La señalización de PeerJS permite encontrar los equipos. Video, chat y llamadas se intercambian entre navegadores. Mantén la pestaña abierta.</p>
        <p>Los participantes conservan los últimos 300 mensajes de chat mientras la sala sigue abierta.</p>
        <label className="host-room__setting"><input type="checkbox" checked={state?.automaticMigration ?? true} disabled={!isHost} onChange={(event) =>
          session?.command({ type: 'settings', automaticMigration: event.target.checked, replicateVideo: state?.replicateVideo ?? true })
        } /> Relevo automático del servidor</label>
        <label className="host-room__setting"><input type="checkbox" checked={state?.replicateVideo ?? true} disabled={!isHost} onChange={(event) => {
          session?.command({ type: 'settings', automaticMigration: state?.automaticMigration ?? true, replicateVideo: event.target.checked });
          if (event.target.checked) session?.retryVideo();
        }} /> Copiar automáticamente el archivo de video a los participantes</label>
        <p>Si desactivas la copia automática, cada invitado puede solicitar el archivo con «Reintentar copia» para reproducirlo.</p>
        <p>Los archivos de hasta 256 MB se reciben completos y usan memoria y ancho de banda de cada equipo. Las copias completas permiten continuar si sale quien tenía el archivo original.</p>
        <p role="status">{selected?.source === 'file' ? `Copias confirmadas en otros equipos: ${view.replicas}` : 'Los enlaces se reproducen desde el proveedor en cada navegador.'}</p>
        {selected?.source === 'file' && <button type="button" className="btn btn--primary" onClick={() => session?.retryVideo()}>Reintentar copias</button>}
        {isHost && (
          <section className="room-settings__box">
            <label htmlFor="host-video-file">Compartir archivo de video</label>
            <input id="host-video-file" type="file" accept="video/*" onChange={(event) => {
              const file = event.target.files?.[0]; if (file) void selectFile(file);
              event.target.value = '';
            }} />
            <form onSubmit={(event) => { event.preventDefault(); void setVideoUrl(url); }}>
              <label htmlFor="host-video-url">YouTube o enlace directo HTTPS</label>
              <input id="host-video-url" className="form-group__input" value={url} onChange={(event) => setUrl(event.target.value)} type="url" required />
              <button type="submit" className="btn btn--primary">Usar enlace</button>
            </form>
            <p>Los enlaces directos deben permitir reproducción en el navegador. Algunos proveedores requieren el proxy del modo Render.</p>
          </section>
        )}
        <p>Si todos salen, se pierde la sala. Una caída de la señalización o una red que requiera TURN puede impedir nuevas conexiones. El relevo puede tardar varios segundos.</p>
        <button type="button" className="btn btn--primary" onClick={() => setSettingsOpen(false)}>Cerrar</button>
      </BottomSheet>
    </div>
  );
}
