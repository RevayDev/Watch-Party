import React, { useState, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { IParticipant } from '../../types/room';
import { RoomTab } from './components/RoomTab';
import { RequestsTab } from './components/RequestsTab';
import { KickedTab } from './components/KickedTab';
import { ParticipantDetail } from './components/ParticipantDetail';
import { ParticipantsFooter } from './components/ParticipantsFooter';
import { ParticipantsProps } from './types';

/**
 * Shell de participantes: estado + tabs (lógica movida verbatim, JSX en subcomponentes).
 */
export const Participants: React.FC<ParticipantsProps> = ({
  participants,
  currentUserName,
  currentUserId,
  isLeader,
  isCoLeader = false,
  kickedUsers = [],
  joinRequests = [],
  settings,
  peerMediaStates = {},
  isMicOn = false,
  isCameraOn = false,
  onToggleMyMic,
  onToggleMyCamera,
  onMuteUser,
  onDisableCamUser,
  onMuteAll,
  onDisableAllCameras,
  onKickUser,
  onBanUser,
  onUnbanUser,
  onToggleCoLeader,
  onTransferHost,
  onRenameUser,
  onApproveJoin,
  onRejectJoin,
  onUpdateSettings,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'room' | 'requests' | 'kicked'>(
    'room',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedParticipant, setSelectedParticipant] =
    useState<IParticipant | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newNameVal, setNewNameVal] = useState('');

  // Entry settings state
  const [muteOnEntry, setMuteOnEntry] = useState(
    settings?.muteOnEntry === true,
  );
  const [cameraOffOnEntry, setCameraOffOnEntry] = useState(
    settings?.cameraOffOnEntry === true,
  );

  // Detail card keeps rendering while its exit animation plays
  const lastDetailRef = useRef<IParticipant | null>(null);
  if (selectedParticipant) lastDetailRef.current = selectedParticipant;
  const detailView = selectedParticipant ?? lastDetailRef.current;

  const closeDetail = () => {
    setSelectedParticipant(null);
    setIsRenaming(false);
  };

  // Can the current user moderate (Host or Co-leader)?
  const canModerate = isLeader || isCoLeader;
  // Solo el anfitrión gestiona roles (promover/degradar co-anfitrión, pasar sala).
  // La moderación normal (mute/kick/ban) sigue con canModerate.
  const canManageRoles = isLeader;

  // Filter participants by search query
  const filteredParticipants = useMemo(() => {
    return participants.filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [participants, searchQuery]);

  // Identity: userId when available (stable across renames), name as legacy fallback
  const isSameUser = (p: IParticipant) =>
    p.userId && currentUserId
      ? p.userId === currentUserId
      : p.name.toLowerCase() === currentUserName.toLowerCase();

  // Helper to determine media state of any participant
  const getParticipantMediaState = (p: IParticipant) => {
    if (isSameUser(p)) {
      return { mic: isMicOn, cam: isCameraOn };
    }
    const state = (p.socketId && peerMediaStates[p.socketId]) ||
      peerMediaStates[p.name.toLowerCase()] || {
        isMicOn: false,
        isCameraOn: false,
      };
    return { mic: state.isMicOn, cam: state.isCameraOn };
  };

  const handleMuteClick = (p: IParticipant, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSameUser(p)) {
      onToggleMyMic?.();
      return;
    }
    if (canModerate) {
      // Anfitrión / Co-anfitrión can turn OFF microphone
      onMuteUser?.(p.name, p.socketId);
    }
  };

  const handleCamClick = (p: IParticipant, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSameUser(p)) {
      onToggleMyCamera?.();
      return;
    }
    if (canModerate) {
      // Anfitrión / Co-anfitrión can turn OFF camera
      onDisableCamUser?.(p.name, p.socketId);
    }
  };

  // ── Floating action buttons rendered next to the person's name ────────────
  const canModerateTarget = (p: IParticipant) =>
    canModerate && !isSameUser(p) && !(p.isLeader || p.role === 'leader');

  const openRename = (p: IParticipant) => {
    setSelectedParticipant(p);
    setNewNameVal(p.name);
    setIsRenaming(true);
  };

  const saveRename = () => {
    if (!selectedParticipant) return;
    const nextName = newNameVal.trim();
    if (nextName && nextName !== selectedParticipant.name) {
      onRenameUser?.(
        selectedParticipant.name,
        nextName,
        selectedParticipant.userId,
      );
      setSelectedParticipant((participant) =>
        participant ? { ...participant, name: nextName } : participant,
      );
    }
    setIsRenaming(false);
  };

  return (
    <div className="part-layout">
      {/* ── LEFT PANEL: PARTICIPANTS MAIN LIST ── */}
      <div className="part-main-panel">
        {/* Header with Title and Close Button */}
        <div className="part-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="part-header__title">
            <h2>
              Participantes{' '}
              <span className="part-count">({participants.length})</span>
            </h2>
          </div>
          {onClose && (
            <button
              type="button"
              className="drawer-close-btn"
              onClick={onClose}
              title="Cerrar participantes"
              aria-label="Cerrar participantes"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Top 3 Navigation Tabs */}
        <div className="part-tabs">
          <button
            className={`part-tab ${activeTab === 'room' ? 'part-tab--active' : ''}`}
            onClick={() => setActiveTab('room')}
          >
            <span>Sala ({participants.length})</span>
          </button>
          <button
            className={`part-tab ${activeTab === 'requests' ? 'part-tab--active' : ''}`}
            onClick={() => setActiveTab('requests')}
          >
            <span>Solicitudes  ({joinRequests.length})</span>
           
          </button>
          <button
            className={`part-tab ${activeTab === 'kicked' ? 'part-tab--active' : ''}`}
            onClick={() => setActiveTab('kicked')}
          >
            <span>Expulsados ({kickedUsers.length})</span>
          </button>
        </div>

        {/* Search Input Bar */}
        {activeTab === 'room' && (
          <div className="part-search-wrap">
            <input
              type="text"
              placeholder="Buscar participante..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="part-search-input part-search-input--with-clear"
            />
            {searchQuery && (
              <button
                className="part-search-clear"
                onClick={() => setSearchQuery('')}
                title="Limpiar búsqueda"
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* Tab 1: Active In-Room Participants List */}
        {activeTab === 'room' && (
          <RoomTab
            filteredParticipants={filteredParticipants}
            isSameUser={isSameUser}
            getParticipantMediaState={getParticipantMediaState}
            canModerate={canModerate}
            selectedName={selectedParticipant?.name}
            onSelect={(p) => setSelectedParticipant(p)}
            onMuteClick={handleMuteClick}
            onCamClick={handleCamClick}
          />
        )}

        {/* Tab 2: Requests (waiting list) */}
        {activeTab === 'requests' && (
          <RequestsTab
            joinRequests={joinRequests}
            onApproveJoin={onApproveJoin}
            onRejectJoin={onRejectJoin}
          />
        )}

        {/* Tab 3: Kicked / Banned Users */}
        {activeTab === 'kicked' && (
          <KickedTab kickedUsers={kickedUsers} onUnbanUser={onUnbanUser} />
        )}

        {/* Bottom Section: Entry Options & General Restrictions (Pinned to bottom of room tab) */}
        {canModerate && activeTab === 'room' && (
          <ParticipantsFooter
            muteOnEntry={muteOnEntry}
            cameraOffOnEntry={cameraOffOnEntry}
            setMuteOnEntry={setMuteOnEntry}
            setCameraOffOnEntry={setCameraOffOnEntry}
            onUpdateSettings={onUpdateSettings}
            onMuteAll={onMuteAll}
            onDisableAllCameras={onDisableAllCameras}
          />
        )}
      </div>

      {/* ── RIGHT PANEL: PARTICIPANT INSPECT / MODERATION CARD ── */}
      {detailView && (
        <ParticipantDetail
          detailView={detailView}
          open={!!selectedParticipant}
          onClose={closeDetail}
          isSameUser={isSameUser}
          canModerateTarget={canModerateTarget}
          canModerate={canModerate}
          canManageRoles={canManageRoles}
          isLeader={isLeader}
          isRenaming={isRenaming}
          newNameVal={newNameVal}
          setNewNameVal={setNewNameVal}
          setIsRenaming={setIsRenaming}
          openRename={openRename}
          saveRename={saveRename}
          onKickUser={onKickUser}
          onBanUser={onBanUser}
          onToggleCoLeader={onToggleCoLeader}
          onTransferHost={onTransferHost}
          onSelectNone={() => setSelectedParticipant(null)}
        />
      )}
    </div>
  );
};

export default Participants;
