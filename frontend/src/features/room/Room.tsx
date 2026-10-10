import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { RoomHeader } from '../../components/RoomHeader';
import { VideoPlayer } from '../player/VideoPlayer';
import { CameraGrid } from '../../components/CameraGrid';
import { LeaderExitModal } from '../../components/LeaderExitModal';
import { MemberExitModal } from '../../components/MemberExitModal';
import { RoomSettingsModal } from '../../components/RoomSettingsModal';
import { WaitingApproval } from '../waiting/WaitingApproval';
import { useRoomSocket } from './hooks/useRoomSocket';
import { buildSocketAuth } from '../../shared/utils';
import { ApiService } from '../../services/api';
import { RoomControls } from './components/RoomControls';
import { RoomDrawer } from './components/RoomDrawer';
import { DEFAULT_AMBIENT_SPOTIFY_URL } from './components/SpotifyListenButton';
import { useBarPrefs } from './hooks/useBarPrefs';

export interface RoomProps {
  roomId: string;
  userName: string;
  isLeader: boolean;
  onLeave: () => void;
}

/**
 * Sala: composición (toda la lógica vive en useRoomSocket).
 * JSX movido verbatim desde pages/Room.tsx — CERO cambios visuales.
 */
export const Room: React.FC<RoomProps> = ({ roomId, userName, isLeader: initialIsLeader, onLeave }) => {
  const r = useRoomSocket({ roomId, userName, initialIsLeader, onLeave });
  // Enlace público de lo que suena en Spotify (footer + chat lo comparten).
  const spotifyVideo = r.roomData?.video?.sourceType === 'spotify' ? r.roomData.video : null;
  const spotifyOpenUrl = spotifyVideo
    ? (spotifyVideo.fileName?.includes('open.spotify.com')
      ? spotifyVideo.fileName
      : spotifyVideo.directUrl ?? null)
    : null;
  const canPlayAmbient = r.isLeader || r.isCohost;
  const handlePlayAmbient = () =>
    r.handleSetVideoUrl(DEFAULT_AMBIENT_SPOTIFY_URL, 'Música ambiente de espera');
  // Spotify conectado (pestaña Música): se consulta al montar/cambiar el video.
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const spotifyVideoKey = spotifyVideo ? (spotifyVideo.fileName ?? spotifyVideo.directUrl ?? '') : '';
  useEffect(() => {
    let alive = true;
    ApiService.spotifyStatus(roomId)
      .then((s) => {
        if (alive) setSpotifyConnected(s.connected === true);
      })
      .catch(() => {
        if (alive) setSpotifyConnected(false);
      });
    return () => {
      alive = false;
    };
  }, [roomId, spotifyVideoKey]);
  const handleMusicConnect = async () => {
    try {
      const { authUrl } = await ApiService.spotifyAuthUrl(roomId);
      window.open(authUrl, '_self');
    } catch {
      // Sin red: no se puede vincular; el panel muestra el error de búsqueda.
    }
  };
  const isModerator = r.isLeader || r.isCohost;
  // Estilo personal de la barra (local, por usuario: nunca se emite a la sala).
  const barPrefs = useBarPrefs();
  // Secuencia cinematográfica: NO sale sola al entrar; solo con el trigger
  // compartido del combo Interestellar (el servidor deja pasar uno por
  // ventana: toda la sala ve las mismas frases). Cada trigger suma una
  // secuencia con key propia; las reconexiones no la re-disparan.
  // Omitir la cierra para TODOS (el hook emite `cinematic-skip`) y la
  // peli sigue.
  const [cineSeq, setCineSeq] = useState(0);
  const lastCineIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = r.cineTrigger?.comboId ?? null;
    if (id && id !== lastCineIdRef.current) {
      lastCineIdRef.current = id;
      setCineSeq((c) => c + 1);
    }
  }, [r.cineTrigger]);
  const activeCine =
    r.cineTrigger && r.cineTrigger.comboId !== r.cineDismissedId ? r.cineTrigger : null;



  // ── Render states ─────────────────────────────────────────────────────────

  if (r.loading) {
    return (
      <div className="room-loading">
        <Loader2 size={40} className="animate-spin room-loading__icon" />
        <p className="room-loading__text">Conectando a la sala <strong>{roomId}</strong>…</p>
      </div>
    );
  }

  if (r.error || !r.roomData) {
    return (
      <div className="container">
        <div className="card card--center">
          <h2 style={{ color: 'var(--color-danger)', marginBottom: '1rem' }}>Error</h2>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
            {r.error || 'Sala no disponible'}
          </p>
          <button onClick={r.handleLeaveOnlyMe} className="btn btn--primary btn--full">
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  // Waiting-list: manual approval rooms block the room UI until accepted
  if (r.awaitingApproval && !r.error) {
    return (
      <WaitingApproval
        roomId={roomId}
        userName={r.myName}
        roomName={r.roomData?.settings?.name}
        roomDescription={r.roomData?.settings?.description}
        initialMicOn={r.pendingMediaPrefRef.current.micOn}
        initialCamOn={r.pendingMediaPrefRef.current.camOn}
        onPrefChange={(micOn, camOn) => {
          r.pendingMediaPrefRef.current = { micOn, camOn };
        }}
        onCancel={r.handleCancelWaiting}
      />
    );
  }

  // Not yet confirmed by the server (waiting for room-state) → keep loading
  if (!r.joined) {
    return (
      <div className="room-loading">
        <Loader2 size={40} className="animate-spin room-loading__icon" />
        <p className="room-loading__text">Conectando a la sala <strong>{roomId}</strong>…</p>
      </div>
    );
  }

  return (
    <div className={`meet-layout ${!r.uiPinned ? 'meet-layout--bars-hidden' : ''}`}>
      {/* ── Top Header (Google Meet style) ── */}
      <RoomHeader
        roomId={r.roomData.roomId}
        participantCount={r.roomData.participants.length}
        isLeader={r.isLeader}
        createdAt={r.roomData.createdAt}
        roomName={r.roomData.settings?.name}
        roomDescription={r.roomData.settings?.description}
        timerEndsAt={r.roomData.settings?.timerEndsAt}
        roomStatus={r.roomData.status}
        onOpenSettings={() => r.setShowRoomSettings(true)}
        onOpenParticipants={() => r.setActiveSideTab((v) => (v === 'participants' ? null : 'participants'))}
        participantsActive={r.sideTabView === 'participants'}
        onLeaveClick={r.handleLeaveClick}
        className={!r.uiPinned ? 'header--hidden' : ''}
      />

      {/* ── Main Stage Area: Left Video + Right Vertical Cameras Strip ── */}
      <main className={`meet-stage ${r.isRightPanelCollapsed ? 'meet-stage--cams-collapsed' : ''}`}>
        {/* Cinematic Video Card */}
        <section className="meet-stage__video-wrapper">
          <VideoPlayer
            roomId={roomId}
            video={r.roomData.video}
            isLeader={r.isLeader || r.isCohost}
            onUploadVideo={r.handleUploadVideo}
            onSetVideoUrl={r.handleSetVideoUrl}
            uploadProgress={r.uploadProgress}
            isVideoLoading={r.isVideoLoading}
            onSyncAction={r.handleSyncAction}
            onPlaybackHeartbeat={r.handlePlaybackHeartbeat}
            heartbeatIntervalMs={r.lowBandwidth || r.dataSaver ? 15000 : 2500}
onVideoReady={r.handleVideoReady}
            remoteAction={r.remoteAction}
            reactions={r.reactions}
            isMicOn={r.isMicOn}
            duckingEnabled={r.duckingEnabled}
            duckingLevelPct={r.duckingLevelPct}
            reactionsEnabled={r.reactionsEnabled}
            visualEffects={r.visualEffects}
            fullscreenToastsEnabled={r.fullscreenToasts}
            cinematicKey={activeCine ? cineSeq : 0}
            cinematicQuotes={activeCine?.quotes ?? null}
            onCinematicDone={(skipped) => {
              // Lee el trigger vigente al pulsar (no el del render): si llegó
              // otro combo mientras tanto, se cierra el que se está viendo.
              const id = r.cineTrigger?.comboId ?? null;
              if (id) r.dismissCinematic(id, skipped === true);
            }}
          />
          {/* Pill "Reconectando…" (Rol A): solo overlay sobre el player.
              Visible al reconectar el socket o con calidad crítica (nivel 3:
              la media se está restableciendo). No destruye sala/chat/video:
              la película sigue reproduciéndose mientras se reintenta. */}
          {(r.isReconnecting || r.qualityLevel >= 3) && (
            <div className="reconnect-pill" role="status" aria-live="polite">
              <span className="reconnect-pill__dot" aria-hidden="true" />
              <span>Reconectando…</span>
            </div>
          )}
        </section>

        {/* Right Vertical Camera Strip (Collapsible Accordion Style) */}
        {!r.isRightPanelCollapsed && (
          <aside className="meet-stage__cams-strip">
            <CameraGrid
              localStream={r.localStream}
              remotePeers={r.remotePeers}
              participants={r.roomData.participants}
              currentUserName={r.myName}
              isLeader={r.isLeader}
              isMicOn={r.isMicOn}
              isCameraOn={r.isCameraOn}
              peerMediaStates={r.peerMediaStates}
              peerSignalStates={r.peerSignalStates}
              dataSaverMode={r.dataSaver}
            />
          </aside>
        )}

        {/* ── Slide-over Right Drawer for Chat or Participants ── */}
        <RoomDrawer
          activeSideTab={r.activeSideTab}
          sideTabView={r.sideTabView}
          setActiveSideTab={r.setActiveSideTab}
          messages={r.messages}
          handleSendMessage={r.handleSendMessage}
          typingUsers={r.typingUsers}
          onTyping={r.emitTyping}
          myName={r.myName}
          roomData={r.roomData}
          userId={r.userId}
          isLeader={r.isLeader}
          peerMediaStates={r.peerMediaStates}
          isMicOn={r.isMicOn}
          isCameraOn={r.isCameraOn}
          toggleMic={r.toggleMic}
          toggleCamera={r.toggleCamera}
          socket={r.socket}
          roomId={roomId}
          spotifyOpenUrl={spotifyOpenUrl}
          canPlayAmbient={canPlayAmbient}
          onPlayAmbient={handlePlayAmbient}
          musicQueue={r.musicQueue}
          musicNowPlaying={r.musicNowPlaying}
          musicSettings={r.roomData.settings}
          musicIsModerator={isModerator}
          musicSpotifyConnected={spotifyConnected}
          onMusicSearch={r.searchMusic}
          onMusicAdd={r.musicAdd}
          onMusicVote={r.musicVote}
          onMusicRemove={r.musicRemove}
          onMusicReorder={r.musicReorder}
          onMusicApprove={r.musicApprove}
          onMusicNext={r.musicNext}
          onMusicStop={r.musicStop}
          onMusicConnect={() => void handleMusicConnect()}
        />
      </main>

      {/* ── Bottom Bar (text buttons) ── */}
      <RoomControls
        roomId={roomId}
        spotifyOpenUrl={spotifyOpenUrl}
        canPlayAmbient={canPlayAmbient}
        onPlayAmbient={handlePlayAmbient}
        layout={barPrefs.layout}
        showLabels={barPrefs.showLabels}
        isMicOn={r.isMicOn}
        isCameraOn={r.isCameraOn}
        toggleMic={r.toggleMic}
        toggleCamera={r.toggleCamera}
        showEmojiPicker={r.showEmojiPicker}
        setShowEmojiPicker={r.setShowEmojiPicker}
        emojiPresence={r.emojiPresence}
        emojiSheetRef={r.emojiSheetRef}
        handleReaction={r.handleReaction}
        activeSideTab={r.activeSideTab}
        setActiveSideTab={r.setActiveSideTab}
        unreadCount={r.unreadCount}
        isRightPanelCollapsed={r.isRightPanelCollapsed}
        setIsRightPanelCollapsed={r.setIsRightPanelCollapsed}
        showMoreMenu={r.showMoreMenu}
        setShowMoreMenu={r.setShowMoreMenu}
        morePresence={r.morePresence}
        moreSheetRef={r.moreSheetRef}
        moreMenuRef={r.moreMenuRef}
        handleLeaveClick={r.handleLeaveClick}
        isBarVisible={r.isBarVisible}
        uiPinned={r.uiPinned}
        toggleBarsVisibility={r.toggleBarsVisibility}
      />

      {r.mediaError && <div className="meet-error-banner">⚠️ {r.mediaError}</div>}
      {r.lowBandwidth && (
        <div className="meet-error-banner">📶 Señal débil: video pausado, seguís con audio</div>
      )}

      <LeaderExitModal
        isOpen={r.showLeaderExitModal}
        participantCount={r.roomData.participants.length}
        isTemporary={r.roomData.isTemporary !== false}
        onClose={() => r.setShowLeaderExitModal(false)}
        onLeaveOnlyMe={r.handleLeaveOnlyMe}
        onDeleteRoomForAll={r.handleDeleteRoomForAll}
      />

      <MemberExitModal
        isOpen={r.showMemberExitModal}
        onClose={() => r.setShowMemberExitModal(false)}
        onConfirmLeave={r.handleLeaveOnlyMe}
      />

      {/* ⚙ Room settings: name, info, save-mode (temporary/stored), approval and auto-close timer */}
      <RoomSettingsModal
        isOpen={r.showRoomSettings}
        onClose={() => r.setShowRoomSettings(false)}
        isTemporary={r.roomData.isTemporary !== false}
        onToggleTemporary={r.handleToggleTemporaryMode}
        roomName={r.roomData.settings?.name || ''}
        roomDescription={r.roomData.settings?.description || ''}
        timerMinutes={r.roomData.settings?.timerMinutes ?? null}
        timerEndsAt={r.roomData.settings?.timerEndsAt || null}
        requireApproval={r.roomData.settings?.requireApproval === true}
        onSaveDetails={r.handleSaveRoomDetails}
        onSetTimer={r.handleSetRoomTimer}
        onToggleRequireApproval={() => {
          const next = !(r.roomData!.settings?.requireApproval === true);
          r.socket.emit('update-room-settings', { roomId, settings: { ...r.roomData!.settings, requireApproval: next }, ...buildSocketAuth(roomId, r.myName) });
        }}
        hostOnlySync={r.roomData.settings?.hostOnlySync === true}
        onToggleHostOnlySync={() => {
          const next = !(r.roomData!.settings?.hostOnlySync === true);
          r.socket.emit('update-room-settings', { roomId, settings: { ...r.roomData!.settings, hostOnlySync: next }, ...buildSocketAuth(roomId, r.myName) });
        }}
        canEdit={r.isLeader}
        dataSaver={r.dataSaver}
        fullscreenToasts={r.fullscreenToasts}
        reactionsEnabled={r.reactionsEnabled}
        visualEffects={r.visualEffects}
        duckingEnabled={r.duckingEnabled}
        duckingLevelPct={r.duckingLevelPct}
        onUpdatePerf={r.handleUpdatePerfSettings}
        roomId={roomId}
        musicEnabled={r.roomData.settings?.musicEnabled === true}
        musicAllowSearch={r.roomData.settings?.musicAllowSearch !== false}
        musicCanAdd={r.roomData.settings?.musicCanAdd ?? 'anyone'}
        musicQueueMode={r.roomData.settings?.musicQueueMode ?? 'fifo'}
        musicCanRemove={r.roomData.settings?.musicCanRemove ?? 'proposer'}
        musicAllowReorder={r.roomData.settings?.musicAllowReorder !== false}
        musicRequireApproval={r.roomData.settings?.musicRequireApproval === true}
        musicMaxPerUser={r.roomData.settings?.musicMaxPerUser ?? 3}
        barShowLabels={barPrefs.showLabels}
        barLayout={barPrefs.layout}
        onBarPrefsChange={(patch) => {
          if (patch.showLabels !== undefined) barPrefs.setShowLabels(patch.showLabels);
          if (patch.layout !== undefined) barPrefs.setLayout(patch.layout);
        }}
      />
    </div>
  );
};

export default Room;
