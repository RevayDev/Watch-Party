import React, { useState, useMemo } from 'react';
import {
  Users,
  Crown,
  Search,
  Mic,
  MicOff,
  Video,
  VideoOff,
  MoreVertical,
  Shield,
  UserX,
  UserCheck,
  Edit2,
  X,
  Clock,
  Laptop,
  Check,
  VolumeX,
} from 'lucide-react';
import { IParticipant, IKickedParticipant, IRoomSettings } from '../types/room';

interface ParticipantsProps {
  participants: IParticipant[];
  currentUserName: string;
  isHost: boolean;
  isCoHost?: boolean;
  kickedUsers?: IKickedParticipant[];
  peerMediaStates?: Record<string, { isCameraOn: boolean; isMicOn: boolean; userName?: string }>;
  isMicOn?: boolean;
  isCameraOn?: boolean;
  onToggleMyMic?: () => void;
  onToggleMyCamera?: () => void;
  onMuteUser?: (targetUserName: string, targetSocketId?: string) => void;
  onDisableCamUser?: (targetUserName: string, targetSocketId?: string) => void;
  onMuteAll?: () => void;
  onDisableAllCameras?: () => void;
  onKickUser?: (targetUserName: string) => void;
  onToggleCoHost?: (targetUserName: string, makeCoHost: boolean) => void;
  onRenameUser?: (oldName: string, newName: string) => void;
  onUpdateSettings?: (settings: Partial<IRoomSettings>) => void;
  onClose?: () => void;
}

export const Participants: React.FC<ParticipantsProps> = ({
  participants,
  currentUserName,
  isHost,
  isCoHost = false,
  kickedUsers = [],
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
  onToggleCoHost,
  onRenameUser,
  onUpdateSettings,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'room' | 'requests' | 'kicked'>('room');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedParticipant, setSelectedParticipant] = useState<IParticipant | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newNameVal, setNewNameVal] = useState('');

  // Entry settings state
  const [muteOnEntry, setMuteOnEntry] = useState(false);
  const [cameraOffOnEntry, setCameraOffOnEntry] = useState(false);

  // Can the current user moderate (Host or Co-host)?
  const canModerate = isHost || isCoHost;

  // Filter participants by search query
  const filteredParticipants = useMemo(() => {
    return participants.filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [participants, searchQuery]);

  // Color avatar generator
  const getAvatarColor = (name: string) => {
    const colors = [
      'linear-gradient(135deg, #6366f1, #4338ca)',
      'linear-gradient(135deg, #ec4899, #be185d)',
      'linear-gradient(135deg, #3b82f6, #1d4ed8)',
      'linear-gradient(135deg, #f59e0b, #b45309)',
      'linear-gradient(135deg, #10b981, #047857)',
      'linear-gradient(135deg, #8b5cf6, #6d28d9)',
      'linear-gradient(135deg, #14b8a6, #0f766e)',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Helper to determine media state of any participant
  const getParticipantMediaState = (p: IParticipant) => {
    const isMe = p.name.toLowerCase() === currentUserName.toLowerCase();
    if (isMe) {
      return { mic: isMicOn, cam: isCameraOn };
    }
    const state =
      (p.socketId && peerMediaStates[p.socketId]) ||
      peerMediaStates[p.name.toLowerCase()] ||
      { isMicOn: false, isCameraOn: false };
    return { mic: state.isMicOn, cam: state.isCameraOn };
  };

  const handleMuteClick = (p: IParticipant, e: React.MouseEvent) => {
    e.stopPropagation();
    const isMe = p.name.toLowerCase() === currentUserName.toLowerCase();
    if (isMe) {
      onToggleMyMic?.();
      return;
    }
    if (canModerate) {
      // Afitrión / Co-Afitrión can turn OFF microphone
      onMuteUser?.(p.name, p.socketId);
    }
  };

  const handleCamClick = (p: IParticipant, e: React.MouseEvent) => {
    e.stopPropagation();
    const isMe = p.name.toLowerCase() === currentUserName.toLowerCase();
    if (isMe) {
      onToggleMyCamera?.();
      return;
    }
    if (canModerate) {
      // Afitrión / Co-Afitrión can turn OFF camera
      onDisableCamUser?.(p.name, p.socketId);
    }
  };

  return (
    <div className="part-layout">
      {/* ── LEFT PANEL: PARTICIPANTS MAIN LIST ── */}
      <div className="part-main-panel">
        {/* Header with Title and Close */}
        <div className="part-header">
          <div className="part-header__title">
            <Users size={20} className="part-header__icon" />
            <h2>Participantes <span className="part-count">({participants.length})</span></h2>
          </div>
          {onClose && (
            <button className="part-icon-btn" onClick={onClose} title="Cerrar">
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
            <Users size={15} />
            <span>Sala ({participants.length})</span>
          </button>
          <button
            className={`part-tab ${activeTab === 'requests' ? 'part-tab--active' : ''}`}
            onClick={() => setActiveTab('requests')}
          >
            <UserCheck size={15} />
            <span>Solicitudes</span>
            <span className="part-badge part-badge--blue">0</span>
          </button>
          <button
            className={`part-tab ${activeTab === 'kicked' ? 'part-tab--active' : ''}`}
            onClick={() => setActiveTab('kicked')}
          >
            <UserX size={15} />
            <span>Expulsados ({kickedUsers.length})</span>
          </button>
        </div>

        {/* Search Input Bar */}
        {activeTab === 'room' && (
          <div className="part-search-wrap">
            <Search size={16} className="part-search-icon" />
            <input
              type="text"
              placeholder="Buscar participante..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="part-search-input"
            />
            {searchQuery && (
              <button
                className="part-search-clear"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* Tab 1: Active In-Room Participants List */}
        {activeTab === 'room' && (
          <div className="part-list">
            {filteredParticipants.map((p, idx) => {
              const isMe = p.name.toLowerCase() === currentUserName.toLowerCase();
              const isHostUser = p.isHost || p.role === 'host';
              const isCoHostUser = !isHostUser && p.role === 'cohost';
              const media = getParticipantMediaState(p);
              const isSelected = selectedParticipant?.name === p.name;

              return (
                <div
                  key={`${p.name}-${idx}`}
                  onClick={() => setSelectedParticipant(p)}
                  className={`part-item ${isSelected ? 'part-item--selected' : ''}`}
                >
                  {/* Left: Avatar */}
                  <div
                    className="part-avatar"
                    style={{ background: getAvatarColor(p.name) }}
                  >
                    {getInitials(p.name)}
                    <span
                      className={`part-status-dot ${
                        media.mic ? 'part-status-dot--speaking' : 'part-status-dot--online'
                      }`}
                    />
                  </div>

                  {/* Middle: Name & Role Badge */}
                  <div className="part-info">
                    <div className="part-name-row">
                      <span className="part-name">{p.name}</span>
                      {isMe && <span className="part-me-tag">(Tú)</span>}
                      {isHostUser && (
                        <span className="part-badge-host">
                          <Crown size={11} />
                          <span>Host</span>
                        </span>
                      )}
                      {isCoHostUser && (
                        <span className="part-badge-cohost">
                          <Shield size={11} />
                          <span>Co-Host</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Interactive Action Buttons */}
                  <div className="part-actions">
                    {/* Interactive Mic Button */}
                    <button
                      type="button"
                      onClick={(e) => handleMuteClick(p, e)}
                      className={`part-media-btn ${
                        media.mic ? 'part-media-btn--mic-on' : 'part-media-btn--mic-off'
                      }`}
                      title={
                        isMe
                          ? media.mic ? 'Silenciar mi micrófono' : 'Activar mi micrófono'
                          : canModerate
                          ? media.mic ? `Silenciar a ${p.name}` : 'El usuario tiene el micro apagado'
                          : media.mic ? 'Micrófono activo' : 'Micrófono apagado'
                      }
                      disabled={!isMe && (!canModerate || !media.mic)}
                    >
                      {media.mic ? <Mic size={16} /> : <MicOff size={16} />}
                    </button>

                    {/* Interactive Camera Button */}
                    <button
                      type="button"
                      onClick={(e) => handleCamClick(p, e)}
                      className={`part-media-btn ${
                        media.cam ? 'part-media-btn--cam-on' : 'part-media-btn--cam-off'
                      }`}
                      title={
                        isMe
                          ? media.cam ? 'Apagar mi cámara' : 'Activar mi cámara'
                          : canModerate
                          ? media.cam ? `Apagar cámara de ${p.name}` : 'Cámara apagada'
                          : media.cam ? 'Cámara encendida' : 'Cámara apagada'
                      }
                      disabled={!isMe && (!canModerate || !media.cam)}
                    >
                      {media.cam ? <Video size={16} /> : <VideoOff size={16} />}
                    </button>

                    {/* 3-dots inspect button */}
                    <button
                      type="button"
                      className="part-more-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedParticipant(p);
                      }}
                      title="Opciones de participante"
                    >
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tab 2: Requests */}
        {activeTab === 'requests' && (
          <div className="part-empty-state">
            <UserCheck size={36} style={{ opacity: 0.4 }} />
            <p>No hay solicitudes pendientes</p>
            <span>Los invitados que soliciten unirse aparecerán aquí para ser aceptados.</span>
          </div>
        )}

        {/* Tab 3: Kicked Users */}
        {activeTab === 'kicked' && (
          <div className="part-kicked-list">
            {kickedUsers.length === 0 ? (
              <div className="part-empty-state">
                <UserX size={36} style={{ opacity: 0.4 }} />
                <p>No hay usuarios expulsados</p>
              </div>
            ) : (
              kickedUsers.map((k, idx) => (
                <div key={`${k.name}-${idx}`} className="part-kicked-item">
                  <div className="part-avatar" style={{ background: '#374151' }}>
                    {getInitials(k.name)}
                  </div>
                  <div className="part-info">
                    <span className="part-name">{k.name}</span>
                    <span className="part-kicked-sub">Expulsado por {k.kickedBy}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Bottom Section: Entry Options & General Restrictions */}
        {canModerate && (
          <div className="part-footer-controls">
            {/* Left: Opciones al entrar */}
            <div className="part-footer-col">
              <span className="part-footer-title">Al entrar</span>
              <div className="part-toggle-row">
                <label className="part-switch">
                  <input
                    type="checkbox"
                    checked={muteOnEntry}
                    onChange={(e) => {
                      setMuteOnEntry(e.target.checked);
                      onUpdateSettings?.({ muteOnEntry: e.target.checked });
                    }}
                  />
                  <span className="part-slider" />
                </label>
                <div className="part-toggle-label">
                  <MicOff size={14} />
                  <span>Micro apagado</span>
                </div>
              </div>
              <div className="part-toggle-row">
                <label className="part-switch">
                  <input
                    type="checkbox"
                    checked={cameraOffOnEntry}
                    onChange={(e) => {
                      setCameraOffOnEntry(e.target.checked);
                      onUpdateSettings?.({ cameraOffOnEntry: e.target.checked });
                    }}
                  />
                  <span className="part-slider" />
                </label>
                <div className="part-toggle-label">
                  <VideoOff size={14} />
                  <span>Cámara apagada</span>
                </div>
              </div>
            </div>

            {/* Right: Restricciones generales */}
            <div className="part-footer-col">
              <span className="part-footer-title">Restricciones</span>
              <div className="part-footer-actions">
                <button
                  type="button"
                  onClick={onMuteAll}
                  className="part-outline-action-btn"
                >
                  <VolumeX size={14} />
                  <span>Silenciar todos</span>
                </button>
                <button
                  type="button"
                  onClick={onDisableAllCameras}
                  className="part-outline-action-btn"
                >
                  <VideoOff size={14} />
                  <span>Apagar cámaras</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL: PARTICIPANT INSPECT / MODERATION CARD ── */}
      {selectedParticipant && (
        <div className="part-detail-card">
          {/* Top User Header */}
          <div className="part-detail-header">
            <div
              className="part-detail-avatar"
              style={{ background: getAvatarColor(selectedParticipant.name) }}
            >
              {getInitials(selectedParticipant.name)}
              <span className="part-status-dot part-status-dot--online" />
            </div>

            <div className="part-detail-identity">
              <div className="part-detail-name-row">
                <h3>{selectedParticipant.name}</h3>
                {(selectedParticipant.isHost || selectedParticipant.role === 'host') && (
                  <span className="part-badge-host">
                    <Crown size={11} />
                    <span>Host</span>
                  </span>
                )}
                {selectedParticipant.role === 'cohost' && (
                  <span className="part-badge-cohost">
                    <Shield size={11} />
                    <span>Co-Host</span>
                  </span>
                )}
              </div>
              <span className="part-detail-status">
                ● En línea
              </span>
            </div>

            <button
              className="part-icon-btn"
              onClick={() => {
                setSelectedParticipant(null);
                setIsRenaming(false);
              }}
              title="Cerrar perfil"
            >
              <X size={18} />
            </button>
          </div>

          {/* Quick Actions Grid */}
          <div className="part-quick-actions">
            {/* Cambiar nombre */}
            <button
              className="part-quick-btn"
              onClick={() => {
                setIsRenaming(true);
                setNewNameVal(selectedParticipant.name);
              }}
              disabled={!canModerate && selectedParticipant.name.toLowerCase() !== currentUserName.toLowerCase()}
              title="Renombrar"
            >
              <Edit2 size={16} />
              <span>Renombrar</span>
            </button>

            {/* Silenciar mic del participante */}
            {canModerate && selectedParticipant.name.toLowerCase() !== currentUserName.toLowerCase() && (
              <button
                className="part-quick-btn"
                onClick={() => onMuteUser?.(selectedParticipant.name, selectedParticipant.socketId)}
                title="Silenciar micrófono"
              >
                <MicOff size={16} />
                <span>Silenciar</span>
              </button>
            )}

            {/* Apagar cámara del participante */}
            {canModerate && selectedParticipant.name.toLowerCase() !== currentUserName.toLowerCase() && (
              <button
                className="part-quick-btn"
                onClick={() => onDisableCamUser?.(selectedParticipant.name, selectedParticipant.socketId)}
                title="Apagar cámara"
              >
                <VideoOff size={16} />
                <span>Apagar cam</span>
              </button>
            )}

            {/* Hacer / Quitar Co-Host */}
            {isHost && !selectedParticipant.isHost && (
              <button
                className={`part-quick-btn ${selectedParticipant.role === 'cohost' ? 'part-quick-btn--active' : ''}`}
                onClick={() => {
                  const isCurrentlyCoHost = selectedParticipant.role === 'cohost';
                  onToggleCoHost?.(selectedParticipant.name, !isCurrentlyCoHost);
                }}
                title={selectedParticipant.role === 'cohost' ? 'Quitar Co-Host' : 'Hacer Co-Host'}
              >
                <Shield size={16} />
                <span>
                  {selectedParticipant.role === 'cohost' ? 'Quitar Co-H.' : 'Co-Host'}
                </span>
              </button>
            )}

            {/* Expulsar */}
            {canModerate && !selectedParticipant.isHost && selectedParticipant.name.toLowerCase() !== currentUserName.toLowerCase() && (
              <button
                className="part-quick-btn part-quick-btn--danger"
                onClick={() => {
                  if (confirm(`¿Expulsar a ${selectedParticipant.name}?`)) {
                    onKickUser?.(selectedParticipant.name);
                    setSelectedParticipant(null);
                  }
                }}
                title="Expulsar"
              >
                <UserX size={16} />
                <span>Expulsar</span>
              </button>
            )}
          </div>

          {/* Formulario de Renombrado en Línea */}
          {isRenaming && (
            <div className="part-rename-box">
              <input
                type="text"
                value={newNameVal}
                onChange={(e) => setNewNameVal(e.target.value)}
                placeholder="Nuevo nombre..."
                className="part-search-input"
                autoFocus
              />
              <button
                className="part-rename-save-btn"
                title="Guardar nombre"
                onClick={() => {
                  if (newNameVal.trim() && newNameVal.trim() !== selectedParticipant.name) {
                    onRenameUser?.(selectedParticipant.name, newNameVal.trim());
                    setSelectedParticipant((prev) => (prev ? { ...prev, name: newNameVal.trim() } : null));
                  }
                  setIsRenaming(false);
                }}
              >
                <Check size={16} />
              </button>
              <button
                className="part-icon-btn"
                title="Cancelar"
                onClick={() => setIsRenaming(false)}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Ficha de Información Detallada */}
          <div className="part-info-section">
            <div className="part-info-section-title">
              <span>Info</span>
            </div>
            <div className="part-info-grid">
              <div className="part-info-item">
                <span className="part-info-label">Rol</span>
                <span className="part-info-value">
                  {selectedParticipant.isHost || selectedParticipant.role === 'host'
                    ? '👑 Host'
                    : selectedParticipant.role === 'cohost'
                    ? '🛡️ Co-Host'
                    : '👤 Miembro'}
                </span>
              </div>
              <div className="part-info-item">
                <span className="part-info-label">
                  <Clock size={13} /> Unido
                </span>
                <span className="part-info-value">
                  {new Date(selectedParticipant.joinedAt || Date.now()).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div className="part-info-item">
                <span className="part-info-label">
                  <Laptop size={13} /> Dispositivo
                </span>
                <span className="part-info-value">
                  {selectedParticipant.device || 'Web'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

