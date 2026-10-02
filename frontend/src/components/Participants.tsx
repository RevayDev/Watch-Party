import React, { useState, useMemo, useRef } from "react";
import {
  MoreVertical,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Check,
  X,
  Ban,
  Pencil,
  UserX,
} from "lucide-react";
import {
  IParticipant,
  IJoinRequest,
  IKickedParticipant,
  IRoomSettings,
} from "../types/room";
import { confirmAction, notify } from "../services/notifications";
import { usePresence } from "../hooks/usePresence";

interface ParticipantsProps {
  participants: IParticipant[];
  currentUserName: string;
  currentUserId?: string;
  isHost: boolean;
  isCoHost?: boolean;
  kickedUsers?: IKickedParticipant[];
  joinRequests?: IJoinRequest[];
  settings?: IRoomSettings;
  peerMediaStates?: Record<
    string,
    { isCameraOn: boolean; isMicOn: boolean; userName?: string }
  >;
  isMicOn?: boolean;
  isCameraOn?: boolean;
  onToggleMyMic?: () => void;
  onToggleMyCamera?: () => void;
  onMuteUser?: (targetUserName: string, targetSocketId?: string) => void;
  onDisableCamUser?: (targetUserName: string, targetSocketId?: string) => void;
  onMuteAll?: () => void;
  onDisableAllCameras?: () => void;
  onKickUser?: (targetUserName: string, targetUserId?: string) => void;
  onBanUser?: (targetUserName: string, targetUserId?: string) => void;
  onUnbanUser?: (targetUserName: string, targetUserId?: string) => void;
  onToggleCoHost?: (targetUserName: string, makeCoHost: boolean) => void;
  onRenameUser?: (
    oldName: string,
    newName: string,
    targetUserId?: string,
  ) => void;
  onApproveJoin?: (userId: string | undefined, name: string) => void;
  onRejectJoin?: (
    userId: string | undefined,
    name: string,
    ban: boolean,
  ) => void;
  onUpdateSettings?: (settings: Partial<IRoomSettings>) => void;
  onClose?: () => void;
}

export const Participants: React.FC<ParticipantsProps> = ({
  participants,
  currentUserName,
  currentUserId,
  isHost,
  isCoHost = false,
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
  onRenameUser,
  onApproveJoin,
  onRejectJoin,
  onUpdateSettings,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<"room" | "requests" | "kicked">(
    "room",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedParticipant, setSelectedParticipant] =
    useState<IParticipant | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newNameVal, setNewNameVal] = useState("");

  // Entry settings state
  const [muteOnEntry, setMuteOnEntry] = useState(
    settings?.muteOnEntry === true,
  );
  const [cameraOffOnEntry, setCameraOffOnEntry] = useState(
    settings?.cameraOffOnEntry === true,
  );

  // Detail card keeps rendering while its exit animation plays
  const detailPresence = usePresence(!!selectedParticipant, 220);
  const lastDetailRef = useRef<IParticipant | null>(null);
  if (selectedParticipant) lastDetailRef.current = selectedParticipant;
  const detailView = selectedParticipant ?? lastDetailRef.current;

  // Can the current user moderate (Host or Co-host)?
  const canModerate = isHost || isCoHost;

  // Filter participants by search query
  const filteredParticipants = useMemo(() => {
    return participants.filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [participants, searchQuery]);

  // Color avatar generator
  const getAvatarColor = (name: string) => {
    const colors = [
      "linear-gradient(135deg, #6366f1, #4338ca)",
      "linear-gradient(135deg, #ec4899, #be185d)",
      "linear-gradient(135deg, #3b82f6, #1d4ed8)",
      "linear-gradient(135deg, #f59e0b, #b45309)",
      "linear-gradient(135deg, #10b981, #047857)",
      "linear-gradient(135deg, #8b5cf6, #6d28d9)",
      "linear-gradient(135deg, #14b8a6, #0f766e)",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

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
      // Afitrión / Co-Afitrión can turn OFF microphone
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
      // Afitrión / Co-Afitrión can turn OFF camera
      onDisableCamUser?.(p.name, p.socketId);
    }
  };

  // ── Floating action buttons rendered next to the person's name ────────────
  const canModerateTarget = (p: IParticipant) =>
    canModerate && !isSameUser(p) && !(p.isHost || p.role === "host");

  const openRename = (p: IParticipant) => {
    setSelectedParticipant(p);
    setNewNameVal(p.name);
    setIsRenaming(true);
  };

  const floatingNameActions = (p: IParticipant) => (
    <span
      className="part-float-actions"
      onClick={(e) => e.stopPropagation()}
      role="group"
      aria-label={`Acciones para ${p.name}`}
    >
      {(canModerate || isSameUser(p)) && (
        <button
          type="button"
          className="part-float-btn part-float-btn--text"
          title="Renombrar"
          onClick={() => openRename(p)}
        >
          <Pencil size={13} />
        </button>
      )}
    </span>
  );

  return (
    <div className="part-layout">
      {/* ── LEFT PANEL: PARTICIPANTS MAIN LIST ── */}
      <div className="part-main-panel">
        {/* Header with Title and Close */}
        <div className="part-header">
          <div className="part-header__title">
            <h2>
              Participantes{" "}
              <span className="part-count">({participants.length})</span>
            </h2>
          </div>
          {onClose && (
            <button
              className="part-icon-btn part-header__close"
              onClick={onClose}
              title="Cerrar"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Top 3 Navigation Tabs */}
        <div className="part-tabs">
          <button
            className={`part-tab ${activeTab === "room" ? "part-tab--active" : ""}`}
            onClick={() => setActiveTab("room")}
          >
            <span>Sala ({participants.length})</span>
          </button>
          <button
            className={`part-tab ${activeTab === "requests" ? "part-tab--active" : ""}`}
            onClick={() => setActiveTab("requests")}
          >
            <span>Solicitudes</span>
            <span className="part-badge part-badge--blue">
              {joinRequests.length}
            </span>
          </button>
          <button
            className={`part-tab ${activeTab === "kicked" ? "part-tab--active" : ""}`}
            onClick={() => setActiveTab("kicked")}
          >
            <span>Expulsados ({kickedUsers.length})</span>
          </button>
        </div>

        {/* Search Input Bar */}
        {activeTab === "room" && (
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
                onClick={() => setSearchQuery("")}
                title="Limpiar búsqueda"
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* Tab 1: Active In-Room Participants List */}
        {activeTab === "room" && (
          <div className="part-list">
            {filteredParticipants.map((p, idx) => {
              const isMe = isSameUser(p);
              const isHostUser = p.isHost || p.role === "host";
              const isCoHostUser = !isHostUser && p.role === "cohost";
              const media = getParticipantMediaState(p);
              const isSelected = selectedParticipant?.name === p.name;

              return (
                <div
                  key={`${p.name}-${idx}`}
                  onClick={() => setSelectedParticipant(p)}
                  className={`part-item ${isSelected ? "part-item--selected" : ""}`}
                >
                  {/* Left: Avatar */}
                  <div
                    className="part-avatar"
                    style={{ background: getAvatarColor(p.name) }}
                  >
                    {getInitials(p.name)}
                    <span
                      className={`part-status-dot ${
                        media.mic
                          ? "part-status-dot--speaking"
                          : "part-status-dot--online"
                      }`}
                    />
                  </div>

                  {/* Middle: Name & Role Badge (+ floating actions) */}
                  <div className="part-info">
                    <div className="part-name-row">
                      <span className="part-name">{p.name}</span>
                      {isMe && <span className="part-me-tag">(Tú)</span>}
                      {isHostUser && (
                        <span className="part-badge-host">
                          <span>Host</span>
                        </span>
                      )}
                      {isCoHostUser && (
                        <span className="part-badge-cohost">
                          <span>Co-Host</span>
                        </span>
                      )}
                      {floatingNameActions(p)}
                    </div>
                  </div>

                  {/* Right: Interactive Action Buttons */}
                  <div className="part-actions">
                    {/* Interactive Mic Button */}
                    <button
                      type="button"
                      onClick={(e) => handleMuteClick(p, e)}
                      className={`part-media-btn ${
                        media.mic
                          ? "part-media-btn--mic-on"
                          : "part-media-btn--mic-off"
                      }`}
                      title={
                        isMe
                          ? media.mic
                            ? "Silenciar mi micrófono"
                            : "Activar mi micrófono"
                          : canModerate
                            ? media.mic
                              ? `Silenciar a ${p.name}`
                              : "El usuario tiene el micro apagado"
                            : media.mic
                              ? "Micrófono activo"
                              : "Micrófono apagado"
                      }
                      disabled={!isMe && (!canModerate || !media.mic)}
                    >
                      {media.mic ? <Mic size={13} /> : <MicOff size={13} />}
                    </button>

                    {/* Interactive Camera Button */}
                    <button
                      type="button"
                      onClick={(e) => handleCamClick(p, e)}
                      className={`part-media-btn ${
                        media.cam
                          ? "part-media-btn--cam-on"
                          : "part-media-btn--cam-off"
                      }`}
                      title={
                        isMe
                          ? media.cam
                            ? "Apagar mi cámara"
                            : "Activar mi cámara"
                          : canModerate
                            ? media.cam
                              ? `Apagar cámara de ${p.name}`
                              : "Cámara apagada"
                            : media.cam
                              ? "Cámara encendida"
                              : "Cámara apagada"
                      }
                      disabled={!isMe && (!canModerate || !media.cam)}
                    >
                      {media.cam ? <Video size={13} /> : <VideoOff size={13} />}
                    </button>

                    {/* 3-dots inspect button (icon-only button allowed) */}
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

        {/* Tab 2: Requests (waiting list) */}
        {activeTab === "requests" &&
          (joinRequests.length === 0 ? (
            <div className="part-empty-state">
              <p>No hay solicitudes pendientes</p>
              <span>
                Los invitados que soliciten unirse aparecerán aquí para ser
                aceptados.
              </span>
            </div>
          ) : (
            <div className="part-kicked-list">
              {joinRequests.map((r, idx) => (
                <div
                  key={`${r.userId || r.name}-${idx}`}
                  className="part-kicked-item part-request-item"
                >
                  <div
                    className="part-avatar"
                    style={{ background: getAvatarColor(r.name) }}
                  >
                    {getInitials(r.name)}
                  </div>
                  <div className="part-info">
                    <div className="part-name-row">
                      <span className="part-name">{r.name}</span>
                      <span className="part-request-time">
                        pidió unirse{" "}
                        {new Date(r.requestedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {/* Floating actions next to the name */}
                      <span className="part-float-actions">
                        <button
                          type="button"
                          className="part-float-btn part-float-btn--ok part-float-btn--text"
                          title="Aceptar solicitud"
                          onClick={() => {
                            onApproveJoin?.(r.userId, r.name);
                            notify(
                              "success",
                              `${r.name} ya puede entrar a la sala.`,
                              "Solicitud aceptada",
                            );
                          }}
                        >
                          <Check size={13} />
                          Aceptar
                        </button>
                        <button
                          type="button"
                          className="part-float-btn part-float-btn--danger part-float-btn--text"
                          title="Rechazar solicitud (podrá volver a pedir)"
                          onClick={() => {
                            confirmAction({
                              title: "Rechazar solicitud",
                              message: `¿Rechazar la solicitud de ${r.name}? Podrá volver a pedir unirse.`,
                              confirmLabel: "Rechazar",
                              danger: true,
                            }).then((ok) => {
                              if (ok) {
                                onRejectJoin?.(r.userId, r.name, false);
                                notify(
                                  "info",
                                  `Se rechazó la solicitud de ${r.name}.`,
                                  "Solicitud rechazada",
                                );
                              }
                            });
                          }}
                        >
                          <X size={13} />
                          Rechazar
                        </button>
                        <button
                          type="button"
                          className="part-float-btn part-float-btn--danger part-float-btn--ban part-float-btn--text"
                          title="Banear (no podrá unirse)"
                          onClick={() => {
                            confirmAction({
                              title: "Banear usuario",
                              message: `¿Banear a ${r.name}? No podrá unirse a la sala.`,
                              confirmLabel: "Banear",
                              danger: true,
                            }).then((ok) => {
                              if (ok) {
                                onRejectJoin?.(r.userId, r.name, true);
                                notify(
                                  "warning",
                                  `${r.name} fue baneado de la sala.`,
                                  "Usuario baneado",
                                );
                              }
                            });
                          }}
                        >
                          <Ban size={13} />
                          Banear
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {/* Tab 3: Kicked / Banned Users */}
        {activeTab === "kicked" && (
          <div className="part-kicked-list">
            {kickedUsers.length === 0 ? (
              <div className="part-empty-state">
                <p>No hay usuarios expulsados</p>
              </div>
            ) : (
              kickedUsers.map((k, idx) => (
                <div
                  key={`${k.userId || k.name}-${idx}`}
                  className="part-kicked-item"
                >
                  <div
                    className="part-avatar"
                    style={{ background: "#374151" }}
                  >
                    {getInitials(k.name)}
                  </div>
                  <div className="part-info">
                    <div className="part-name-row">
                      <span className="part-name">{k.name}</span>
                      <span
                        className={
                          k.banned ? "part-badge-banned" : "part-badge-kicked"
                        }
                      >
                        {k.banned ? "Baneado" : "Expulsado"}
                      </span>
                      <span className="part-float-actions">
                        <button
                          type="button"
                          className="part-float-btn part-float-btn--ok part-float-btn--text"
                          title="Permitir de nuevo (desbanear)"
                          onClick={() => {
                            onUnbanUser?.(k.name, k.userId);
                            notify(
                              "success",
                              `${k.name} ya puede volver a entrar.`,
                              "Desbaneado",
                            );
                          }}
                        >
                          <Check size={13} />
                          Permitir
                        </button>
                      </span>
                    </div>
                    <span className="part-kicked-sub">por {k.kickedBy}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Bottom Section: Entry Options & General Restrictions (Pinned to bottom of room tab) */}
        {canModerate && activeTab === "room" && (
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
                      onUpdateSettings?.({
                        cameraOffOnEntry: e.target.checked,
                      });
                    }}
                  />
                  <span className="part-slider" />
                </label>
                <div className="part-toggle-label">
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
                  <MicOff size={14} />
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
      {detailPresence.shown && detailView && (
        <div
          className={`part-detail-card ${detailPresence.closing ? "part-detail-card--closing" : ""}`}
        >
          {/* Top User Header */}
          <div className="part-detail-header">
            <div
              className="part-detail-avatar"
              style={{ background: getAvatarColor(detailView.name) }}
            >
              {getInitials(detailView.name)}
              <span className="part-status-dot part-status-dot--online" />
            </div>

            <div className="part-detail-identity">
              <div className="part-detail-name-row">
                <h3>{detailView.name}</h3>
                {(detailView.isHost || detailView.role === "host") && (
                  <span className="part-badge-host">
                    <span>Host</span>
                  </span>
                )}
                {detailView.role === "cohost" && (
                  <span className="part-badge-cohost">
                    <span>Co-Host</span>
                  </span>
                )}
              </div>
              <span className="part-detail-status">● En línea</span>
            </div>

            <button
              className="part-icon-btn part-detail-close"
              onClick={() => {
                setSelectedParticipant(null);
                setIsRenaming(false);
              }}
              title="Cerrar perfil"
            >
              <X size={14} />
            </button>
          </div>

          {/* Formulario de Renombrado en Línea (abierto con el botón "Renombrar" junto al nombre) */}
          {isRenaming && (
            <div className="part-rename-box">
              <input
                type="text"
                value={newNameVal}
                onChange={(e) => setNewNameVal(e.target.value)}
                placeholder="Nuevo nombre..."
                className="part-search-input"
                autoFocus
              />{" "}
              <button
                className="part-icon-btn"
                title="Cancelar"
                onClick={() => setIsRenaming(false)}
              >
                <X size={13} />
              </button>
              <button
                className="part-rename-save-btn"
                title="Guardar nombre"
                onClick={() => {
                  if (
                    newNameVal.trim() &&
                    newNameVal.trim() !== detailView.name
                  ) {
                    onRenameUser?.(
                      detailView.name,
                      newNameVal.trim(),
                      detailView.userId,
                    );
                    setSelectedParticipant((prev) =>
                      prev ? { ...prev, name: newNameVal.trim() } : prev,
                    );
                  }
                  setIsRenaming(false);
                }}
              >
                <Check size={13} />
              </button>
            </div>
          )}

          {/* Botones extra: Expulsar / Banear */}
          {canModerateTarget(detailView) && (
            <div className="part-detail-actions">
              <button
                type="button"
                className="part-outline-action-btn part-outline-action-btn--danger"
                onClick={() => {
                  confirmAction({
                    title: "Expulsar usuario",
                    message: `¿Expulsar a ${detailView.name}? Podrá volver a entrar a la sala.`,
                    confirmLabel: "Expulsar",
                    danger: true,
                  }).then((ok) => {
                    if (ok) {
                      onKickUser?.(detailView.name, detailView.userId);
                      setSelectedParticipant(null);
                    }
                  });
                }}
              >
                <UserX size={14} />
                <span>Expulsar</span>
              </button>
              <button
                type="button"
                className="part-outline-action-btn part-outline-action-btn--danger"
                onClick={() => {
                  confirmAction({
                    title: "Banear usuario",
                    message: `¿Banear a ${detailView.name}? No podrá volver a entrar a la sala.`,
                    confirmLabel: "Banear",
                    danger: true,
                  }).then((ok) => {
                    if (ok) {
                      onBanUser?.(detailView.name, detailView.userId);
                      setSelectedParticipant(null);
                    }
                  });
                }}
              >
                <Ban size={14} />
                <span>Banear</span>
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
                  {detailView.isHost || detailView.role === "host"
                    ? "Host"
                    : detailView.role === "cohost"
                      ? "Co-Host"
                      : "Miembro"}
                </span>
              </div>
              <div className="part-info-item">
                <span className="part-info-label">Unido</span>
                <span className="part-info-value">
                  {new Date(
                    detailView.joinedAt || Date.now(),
                  ).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="part-info-item">
                <span className="part-info-label">Dispositivo</span>
                <span className="part-info-value">
                  {detailView.device || "Web"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
