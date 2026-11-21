import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { VideoPlayer } from '../player/VideoPlayer';
import { CameraGrid } from '../../components/CameraGrid';
import { RemoteAudio } from '../../components/RemoteAudio';
import { MediaSettings } from '../../components/MediaSettings';
import { RoomHeader } from '../../components/RoomHeader';
import { MemberExitModal } from '../../components/MemberExitModal';
import { RoomLayout } from '../room/components/RoomLayout';
import { RoomControls } from '../room/components/RoomControls';
import { RoomDrawer } from '../room/components/RoomDrawer';
import { useBarPrefs } from '../room/hooks/useBarPrefs';
import { usePresence } from '../../hooks/usePresence';
import { useSwipeDown } from '../../shared/hooks/useSheetDrag';
import { BottomSheet } from '../../shared/components/BottomSheet';
import { useWebRTC } from '../../hooks/useWebRTC';
import { parseYouTubeUrl } from '../../shared/youtube';
import { HostSession, type HostSessionView } from './HostSession';
import { hostInvite, type HostRoomOptions } from './protocol';
import type { IVideoMetadata, IRoomData, ReactionItem } from '../../types/room';
import './host-room.css';

const initialView: HostSessionView = {
  id: '', state: null, status: 'Conectando…', error: '', fileUrl: null, fileProgress: 0, replicas: 0,
};

export function HostRoom({ options, onLeave }: { options: HostRoomOptions; onLeave: () => void }) {
  const [name, setName] = useState(options.name);
  const [entered, setEntered] = useState(!!options.name);
  if (!globalThis.crypto?.subtle) {
    const localUrl = new URL(window.location.href);
    localUrl.hostname = 'localhost';
    return (
      <main className="host-room-entry">
        <section className="host-room-entry__card" role="alert">
          <span className="host-room-entry__eyebrow">Conexión de la sala</span>
          <h2>Abre la sala con una conexión segura</h2>
          <p>Esta dirección HTTP de la red local bloquea la conexión segura, el micrófono y la cámara del navegador.</p>
          <p>En este equipo, abre localhost. Para entrar desde otro dispositivo, usa la web publicada con HTTPS y el enlace de invitación generado allí.</p>
          <a className="btn btn--primary" href={localUrl.href}>Abrir en este equipo</a>
          <button type="button" className="btn btn--secondary" onClick={onLeave}>Volver al inicio</button>
        </section>
      </main>
    );
  }
  if (!entered) {
    return (
      <main className="host-room-entry">
        <form className="host-room-entry__card" onSubmit={(event) => {
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
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const optionsRef = useRef(options);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [activeSideTab, setActiveSideTab] = useState<'chat' | 'participants' | 'music' | null>(null);
  const [sideTabView, setSideTabView] = useState<'chat' | 'participants' | 'music'>('chat');
  const [camerasCollapsed, setCamerasCollapsed] = useState(false);
  const [uiPinned, setUiPinned] = useState(true);
  const [isBarVisible, setIsBarVisible] = useState(true);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showExit, setShowExit] = useState(false);
  const [reactions, setReactions] = useState<ReactionItem[]>([]);
  const emojiPresence = usePresence(showEmojiPicker, 160);
  const morePresence = usePresence(showMoreMenu, 160);
  const emojiSheetRef = useSwipeDown<HTMLDivElement>(() => setShowEmojiPicker(false), showEmojiPicker);
  const moreSheetRef = useSwipeDown<HTMLDivElement>(() => setShowMoreMenu(false), showMoreMenu);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const barPrefs = useBarPrefs();
  const createdAt = useRef(new Date().toISOString());
  const state = view.state;
  const isHost = state?.hostId === view.id;
  const media = useWebRTC(session, options.roomId, options.name, isHost);
  useEffect(() => {
    let current: HostSession | undefined;
    setView(initialView);
    try {
      current = new HostSession(optionsRef.current, setView);
      setSession(current);
      current.start();
    } catch (cause) {
      current?.stop();
      setView((previous) => ({ ...previous, status: 'No se pudo iniciar la sala',
        error: cause instanceof Error ? cause.message : 'Intenta abrir la sala de nuevo.' }));
    }
    return () => current?.stop();
  }, [connectionAttempt]);
  useEffect(() => {
    if (activeSideTab) setSideTabView(activeSideTab);
  }, [activeSideTab]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const activity = () => {
      setIsBarVisible(true);
      clearTimeout(timer);
      if (!uiPinned && !showEmojiPicker && !showMoreMenu && !activeSideTab) {
        timer = setTimeout(() => setIsBarVisible(false), 4500);
      }
    };
    window.addEventListener('mousemove', activity);
    window.addEventListener('touchstart', activity, { passive: true });
    window.addEventListener('click', activity);
    activity();
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', activity);
      window.removeEventListener('touchstart', activity);
      window.removeEventListener('click', activity);
    };
  }, [uiPinned, showEmojiPicker, showMoreMenu, activeSideTab]);
  useEffect(() => {
    if (!session) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const receive = (packet: { id: string; emoji: string; userName: string }) => {
      if (typeof packet.emoji !== 'string' || packet.emoji.length > 32) return;
      const reaction = { id: packet.id, emoji: packet.emoji, user: packet.userName, xOffset: Math.random() * 80 + 10 };
      setReactions((previous) => [...previous.slice(-39), reaction]);
      const timer = setTimeout(() => {
        setReactions((previous) => previous.filter((entry) => entry.id !== reaction.id));
        timers.delete(timer);
      }, 5000);
      timers.add(timer);
    };
    session.on('reaction', receive);
    return () => { session.off('reaction', receive); timers.forEach(clearTimeout); };
  }, [session]);

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

  const setVideoUrl = async (input: string, title?: string) => {
    setError('');
    try {
      const parsed = new URL(input);
      if (parsed.protocol !== 'https:') throw new Error('Usa un enlace HTTPS de video.');
      const youtube = parseYouTubeUrl(input);
      session?.command({ type: 'video', video: {
        id: crypto.randomUUID(), name: title?.trim() || (youtube ? 'YouTube' : parsed.hostname === 'drive.google.com' ? 'Video de Google Drive' : parsed.pathname.split('/').pop() || 'Video'),
        source: youtube ? 'youtube' : 'url', url: youtube?.cleanUrl ?? parsed.href, size: 0, mime: 'video/mp4',
      } });
      setUrl('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enlace inválido.');
    }
  };

  const roomData: IRoomData | null = state ? {
    roomId: options.roomId, leaderName: state.members.find((member) => member.id === state.hostId)?.name ?? options.name,
    status: selected ? 'active' : 'waiting', isTemporary: true, video, createdAt: createdAt.current,
    participants: state.members.map((member) => ({
      name: member.name, userId: member.id, socketId: member.id, isLeader: member.id === state.hostId,
      role: member.id === state.hostId ? 'leader' : 'member', joinedAt: new Date(member.joinedAt).toISOString(),
    })),
    settings: { muteOnEntry: false, cameraOffOnEntry: false, allowMicReactivation: true, allowCamReactivation: true,
      hostOnlySync: true, musicEnabled: true, musicCanAdd: 'anyone', musicAllowReorder: true, musicCanRemove: 'proposer' },
    musicQueue: state.musicQueue, musicNowPlaying: state.musicNowPlaying,
  } : null;

  if (!roomData || !state || !session) return (
    <div className="room-loading">
      {!view.error && <Loader2 size={40} className="animate-spin room-loading__icon" />}
      <p className="room-loading__text" role="status">{view.status}</p>
      {view.error && <p role="alert">{view.error}</p>}
      {view.error && <button type="button" className="btn btn--primary" onClick={() => setConnectionAttempt((value) => value + 1)}>Reintentar conexión</button>}
      <button type="button" className="btn btn--primary" onClick={onLeave}>Volver al inicio</button>
    </div>
  );

  return (
    <RoomLayout uiPinned={uiPinned} camerasCollapsed={camerasCollapsed}
      header={<RoomHeader roomId={options.roomId} participantCount={state.members.length} capacity={8}
        inviteUrl={hostInvite(options.roomId, options.key)} isLeader={isHost} showSettings
        createdAt={createdAt.current} roomStatus={roomData.status}
        onOpenSettings={() => setSettingsOpen(true)} onOpenMediaSettings={() => setDevicesOpen(true)}
        onOpenParticipants={() => setActiveSideTab((tab) => tab === 'participants' ? null : 'participants')}
        participantsActive={activeSideTab === 'participants'} onLeaveClick={() => setShowExit(true)}
        className={!uiPinned ? 'header--hidden' : ''} />}
      player={<>
        <RemoteAudio peers={media.remotePeers} />
        {selected?.source === 'file' && !view.fileUrl ? (
          <div className="player-container"><div className="player-container__placeholder" role="status">
            <p>Recibiendo el video… {view.fileProgress}%</p>
            <progress max={100} value={view.fileProgress} aria-label="Recepción del video" />
            <button type="button" className="btn btn--primary" onClick={() => session.retryVideo()}>Reintentar copia</button>
          </div></div>
        ) : (
          <VideoPlayer directPlayback roomId={options.roomId} video={video} isLeader={isHost}
            onUploadVideo={selectFile} onSetVideoUrl={setVideoUrl} uploadProgress={null}
            reactions={reactions} isMicOn={media.isMicOn}
            onSyncAction={(action, currentTime) => session.command({ type: 'playback', action, currentTime })}
            onPlaybackHeartbeat={isHost ? (currentTime, playing) => session.command({
              type: 'playback', action: playing ? 'play' : 'pause', currentTime,
            }) : undefined} remoteAction={isHost ? null : state.playback} />
        )}
      </>}
      cameras={<CameraGrid localStream={media.localStream} remotePeers={media.remotePeers}
        participants={roomData.participants} currentUserName={options.name} isLeader={isHost}
        isMicOn={media.isMicOn} isCameraOn={media.isCameraOn}
        peerMediaStates={media.peerMediaStates} peerSignalStates={media.peerSignalStates} />}
      drawer={<RoomDrawer activeSideTab={activeSideTab} sideTabView={sideTabView} setActiveSideTab={setActiveSideTab}
        messages={state.messages}
        handleSendMessage={(text, reply) => session.command({ type: 'chat', text, id: crypto.randomUUID(), replyTo: reply?.id })}
        handleEditMessage={(id, text) => session.command({ type: 'edit-chat', id, text })}
        typingUsers={[]} onTyping={() => {}} myName={options.name} roomData={roomData} userId={view.id}
        isLeader={isHost} canManageParticipants={false} peerMediaStates={media.peerMediaStates}
        isMicOn={media.isMicOn} isCameraOn={media.isCameraOn} toggleMic={media.toggleMic} toggleCamera={media.toggleCamera}
        socket={session} roomId={options.roomId} musicQueue={state.musicQueue} musicNowPlaying={state.musicNowPlaying}
        musicSettings={roomData.settings} musicIsModerator={isHost}
        onMusicAdd={(track) => session.command({ type: 'music-add', track })}
        onMusicRemove={(id) => session.command({ type: 'music-remove', id })}
        onMusicReorder={(ids) => session.command({ type: 'music-reorder', ids })}
        onMusicNext={() => session.command({ type: 'music-next' })}
        onMusicAutoNext={() => { if (isHost) session.command({ type: 'music-next' }); }}
        onMusicStop={() => session.command({ type: 'music-stop' })}
        onExpandToMain={(link, title) => { void setVideoUrl(link, title); }} />}
      controls={<RoomControls roomId={options.roomId} layout={barPrefs.layout} showLabels={barPrefs.showLabels}
        isMicOn={media.isMicOn} isCameraOn={media.isCameraOn} toggleMic={media.toggleMic} toggleCamera={media.toggleCamera}
        showEmojiPicker={showEmojiPicker} setShowEmojiPicker={setShowEmojiPicker} emojiPresence={emojiPresence}
        emojiSheetRef={emojiSheetRef} handleReaction={(emoji) => session.emit('reaction', { emoji })}
        activeSideTab={activeSideTab} setActiveSideTab={setActiveSideTab} unreadCount={0}
        isRightPanelCollapsed={camerasCollapsed} setIsRightPanelCollapsed={setCamerasCollapsed}
        showMoreMenu={showMoreMenu} setShowMoreMenu={setShowMoreMenu} morePresence={morePresence}
        moreSheetRef={moreSheetRef} moreMenuRef={moreMenuRef} handleLeaveClick={() => setShowExit(true)}
        isBarVisible={isBarVisible} uiPinned={uiPinned} toggleBarsVisibility={() => setUiPinned((value) => !value)}
        musicOpen={activeSideTab === 'music'} onToggleMusic={() => setActiveSideTab((tab) => tab === 'music' ? null : 'music')} />}
    >
      {(view.error || error || media.mediaError) && <div role="alert" className="meet-error-banner">{view.error || error || media.mediaError}</div>}
      {view.status.includes('relevo') && <div className="reconnect-pill" role="status">{view.status}</div>}
      {media.mediaConnectionFailed && <div className="meet-error-banner"><button type="button" className="btn btn--primary" onClick={media.retryMediaConnection}>Reconectar micrófonos y cámaras</button></div>}
      <MemberExitModal isOpen={showExit} onClose={() => setShowExit(false)} onConfirmLeave={onLeave} />
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
    </RoomLayout>
  );
}
