import React, { useState, useRef, useEffect } from 'react';
import { Video, Hash, Link as LinkIcon, Share2, Users, Settings } from 'lucide-react';
import { usePresence } from '../hooks/usePresence';
import { useSwipeDown } from '../shared/hooks/useSheetDrag';
import { formatRemaining } from '../shared/utils';
import { DEMO_MAX_USERS_PER_ROOM, PREMIUM_MAX_USERS_PER_ROOM, isDemoMode } from '../shared/demo';

interface RoomHeaderProps {
  roomId: string;
  participantCount: number;
  isHost: boolean;
  roomName?: string;
  roomDescription?: string;
  timerEndsAt?: string | null;
  /** Estado de la sala (demo: se muestra como píldora informativa). */
  roomStatus?: 'waiting' | 'active' | 'closed';
  /** Plan de la sala (ausente = 'free'): la capacidad y el badge cambian. */
  roomPlan?: 'free' | 'premium';
  /** Duración del vídeo en segundos, si la hay (demo: se muestra). */
  videoDurationSeconds?: number | null;
  onOpenSettings?: () => void;
  onLeaveClick?: () => void;
  /** Abre/cierra el panel de participantes (igual que el botón de abajo) */
  onOpenParticipants?: () => void;
  participantsActive?: boolean;
  className?: string;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  roomId,
  participantCount,
  isHost,
  roomName,
  roomDescription,
  timerEndsAt,
  roomStatus,
  roomPlan,
  videoDurationSeconds = null,
  onOpenSettings,
  onOpenParticipants,
  participantsActive = false,
  className = '',
}) => {
  const [showShareMenu, setShowShareMenu] = useState(false);
  const sharePresence = usePresence(showShareMenu, 160);
  // Same swipe-down-to-close as the phone sheets
  const shareSheetRef = useSwipeDown<HTMLDivElement>(
    () => setShowShareMenu(false),
    showShareMenu
  );
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);

  const fullUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;

  // Close the share menu on outside click / Escape
  useEffect(() => {
    if (!showShareMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowShareMenu(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showShareMenu]);

  // Room auto-close countdown (seconds tick)
  useEffect(() => {
    if (!timerEndsAt) {
      setRemainingMs(null);
      return;
    }
    const tick = () => {
      const ms = new Date(timerEndsAt).getTime() - Date.now();
      setRemainingMs(ms > 0 ? ms : 0);
    };
    tick();
    const iv = window.setInterval(tick, 1000);
    return () => window.clearInterval(iv);
  }, [timerEndsAt]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 3000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(fullUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  const hasRoomName = Boolean(roomName && roomName.trim());

  // Demo gratuita: cupo visible X/5 (participants incluye al host; las
  // solicitudes en espera NO consumen cupo). Con VITE_DEMO_MODE=false se
  // muestra el conteo original sin capacidad.
  const demo = isDemoMode();
  const statusLabel =
    roomStatus === 'waiting' ? 'En espera' : roomStatus === 'active' ? 'En curso' : roomStatus === 'closed' ? 'Cerrada' : null;

  return (
    <header className={`header ${className} ${hasRoomName ? 'header--has-name' : ''}`}>
      {/* Brand (mismo logo del Home) */}
      <div className="header__brand">
        <span className="header__logo-icon" aria-hidden="true">
          <Video size={17} />
        </span>
        <span className="header__brand-text">Watch Party</span>
      </div>

      {/* Nombre / descripción de la sala (desde ⚙ Configuración de sala) */}
      {hasRoomName && (
        <div
          className="header__name-pill"
          title={roomDescription?.trim() ? `${roomName} — ${roomDescription}` : roomName}
        >
          <span className="header__name-pill__name">{roomName}</span>
          {roomDescription?.trim() && (
            <span className="header__name-pill__desc">{roomDescription}</span>
          )}
        </div>
      )}

      {/* Actions / Info */}
      <div className="header__actions">
        {/* Share: single button → small menu with room code + invite link */}
        <div className="header__share-wrap" ref={shareRef}>
          <button
            onClick={() => setShowShareMenu((v) => !v)}
            className="header__room-pill header__share-btn"
            title="Compartir sala (código y link)"
            type="button"
          >
            <Share2 size={13} color="#818cf8" />
            <span className="header__pill-label">Compartir</span>
          </button>

          {sharePresence.shown && (
            <div
              className={`header-share-menu ${sharePresence.closing ? 'header-share-menu--closing' : ''}`}
              ref={shareSheetRef}
            >
              {/* Room code */}
              <div className="header-share-menu__row">
                <div className="header-share-menu__info">
                  <span className="header-share-menu__label">
                    <Hash size={12} /> Código de la sala
                  </span>
                  <span className="header-share-menu__value">{roomId}</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className={`header-share-menu__copy ${copiedCode ? 'header-share-menu__copy--done' : ''}`}
                  title="Copiar código"
                >
                  {copiedCode ? 'Copiado' : 'Copiar'}
                </button>
              </div>

              {/* Invite link */}
              <div className="header-share-menu__row">
                <div className="header-share-menu__info">
                  <span className="header-share-menu__label">
                    <LinkIcon size={12} /> Link de invitación
                  </span>
                  <span className="header-share-menu__value header-share-menu__value--url">{fullUrl}</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={`header-share-menu__copy ${copiedLink ? 'header-share-menu__copy--done' : ''}`}
                  title="Copiar link"
                >
                  {copiedLink ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Room auto-close countdown (set from ⚙ Configuración de sala) */}
        {remainingMs !== null && (
          <div
            className={`header__room-pill header__timer-pill ${remainingMs <= 60000 ? 'header__timer-pill--urgent' : ''}`}
            title="El temporizador cerrará la sala automáticamente"
          >
            <span className="header__timer-pill__label">{formatRemaining(remainingMs)}</span>
          </div>
        )}

        {/* Participant count: abre el panel igual que el botón de abajo */}
        <button
          type="button"
          onClick={onOpenParticipants}
          className={`header__users-pill ${participantsActive ? 'header__users-pill--active' : ''}`}
          title={
            demo
              ? `${participantCount} de ${roomPlan === 'premium' ? PREMIUM_MAX_USERS_PER_ROOM : DEMO_MAX_USERS_PER_ROOM} participantes — ver lista`
              : `${participantCount} participantes — ver lista`
          }
          data-testid="room-capacity"
        >
          <Users size={14} />
          <span>{demo ? `${participantCount}/${roomPlan === 'premium' ? PREMIUM_MAX_USERS_PER_ROOM : DEMO_MAX_USERS_PER_ROOM}` : participantCount}</span>
        </button>

        {/* Plan premium de la sala */}
        {roomPlan === 'premium' && (
          <div
            className="header__room-pill header__premium-pill"
            title="Sala premium: más capacidad y sin cierre por temporalidad"
          >
            <span className="header__pill-label">Premium</span>
          </div>
        )}

        {/* Demo: estado de la sala y duración del vídeo (si hay) */}
        {demo && statusLabel && (
          <div
            className="header__room-pill"
            title={`Estado de la sala: ${statusLabel}`}
            data-testid="room-status"
          >
            <span className="header__pill-label">{statusLabel}</span>
          </div>
        )}
        {demo && videoDurationSeconds !== null && videoDurationSeconds !== undefined && (
          <div
            className="header__room-pill"
            title="Duración del vídeo"
            data-testid="video-duration"
          >
            <span className="header__pill-label">{formatRemaining(videoDurationSeconds * 1000)}</span>
          </div>
        )}

        {/* ⚙ Room settings (host only): name, info, save-mode, approval, timer */}
        {isHost && onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="header__room-pill header__settings-btn"
            title="Configuración de la sala"
          >
            <Settings size={15} />
          </button>
        )}
      </div>
    </header>
  );
};
