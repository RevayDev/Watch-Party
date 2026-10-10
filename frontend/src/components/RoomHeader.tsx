import React, { useState, useRef, useEffect } from 'react';
import { Video, Hash, Link as LinkIcon, Share2, Users, Settings, Clock, Hourglass } from 'lucide-react';
import { usePresence } from '../hooks/usePresence';
import { useSwipeDown } from '../shared/hooks/useSheetDrag';
import { formatRemaining } from '../shared/utils';
import { DEMO_MAX_USERS_PER_ROOM, isDemoMode } from '../shared/demo';

interface RoomHeaderProps {
  roomId: string;
  participantCount: number;
  isLeader: boolean;
  createdAt?: string;
  roomName?: string;
  roomDescription?: string;
  timerEndsAt?: string | null;
  /** Estado de la sala (demo: se muestra como píldora informativa). */
  roomStatus?: 'waiting' | 'active' | 'closed';
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
  isLeader,
  createdAt,
  roomName,
  roomDescription,
  timerEndsAt,
  roomStatus,
  onOpenSettings,
  onOpenParticipants,
  participantsActive = false,
  className = '',
}) => {
  const [showShareMenu, setShowShareMenu] = useState(false);
  const sharePresence = usePresence(showShareMenu, 160);
  const shareSheetRef = useSwipeDown<HTMLDivElement>(
    () => setShowShareMenu(false),
    showShareMenu
  );

  const [showClockMenu, setShowClockMenu] = useState(false);
  const clockPresence = usePresence(showClockMenu, 160);
  const clockSheetRef = useSwipeDown<HTMLDivElement>(
    () => setShowClockMenu(false),
    showClockMenu
  );

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [totalTimerDurationMs, setTotalTimerDurationMs] = useState<number | null>(null);

  const shareRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);

  const fullUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;

  // Close menus on outside click / Escape
  useEffect(() => {
    if (!showShareMenu && !showClockMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (showShareMenu && shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
      if (showClockMenu && clockRef.current && !clockRef.current.contains(e.target as Node)) {
        setShowClockMenu(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowShareMenu(false);
        setShowClockMenu(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showShareMenu, showClockMenu]);

  // Elapsed time and timer countdown tick
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      let createdMs = now;
      if (createdAt) {
        createdMs = new Date(createdAt).getTime();
        setElapsedMs(Math.max(0, now - createdMs));
      }
      if (timerEndsAt) {
        const endsMs = new Date(timerEndsAt).getTime();
        const ms = endsMs - now;
        setRemainingMs(ms > 0 ? ms : 0);
        setTotalTimerDurationMs(Math.max(1, endsMs - createdMs));
      } else {
        setRemainingMs(null);
        setTotalTimerDurationMs(null);
      }
    };
    tick();
    const iv = window.setInterval(tick, 1000);
    return () => window.clearInterval(iv);
  }, [createdAt, timerEndsAt]);

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
  const demo = isDemoMode();

  const formattedCloseTime = timerEndsAt
    ? new Date(timerEndsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  // Estado del temporizador:
  // waiting → muestra tiempo transcurrido ("En espera", neutro)
  // active  → muestra cuenta regresiva con colores:
  //   - normalito por defecto
  //   - amarillo cuando va por la mitad
  //   - rojo cuando quedan ≤50 min
  const isWaiting = roomStatus === 'waiting';
  let timerToneClass = 'header__timer-pill--normal';
  let timerIconColor = '#94a3b8'; // color neutro por defecto

  if (!isWaiting && remainingMs !== null) {
    const fiftyMinutesMs = 50 * 60 * 1000;
    const isHalfWay = totalTimerDurationMs !== null && remainingMs <= totalTimerDurationMs / 2;

    if (remainingMs <= fiftyMinutesMs) {
      timerToneClass = 'header__timer-pill--urgent';
      timerIconColor = '#f87171'; // rojo
    } else if (isHalfWay) {
      timerToneClass = 'header__timer-pill--warning';
      timerIconColor = '#fbbf24'; // amarillo
    }
  }

  // Texto y tooltip del pill
  const timerPillText = isWaiting
    ? `En espera · ${formatRemaining(elapsedMs)}`
    : remainingMs !== null
      ? formatRemaining(remainingMs)
      : formatRemaining(elapsedMs);

  const timerPillTitle = isWaiting
    ? 'Esperando a que alguien entre — el temporizador inicia al unirse un participante'
    : 'Tiempo restante de la sala (ver detalles)';

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

        {/* Participant count: abre el panel igual que el botón de abajo */}
        <button
          type="button"
          onClick={onOpenParticipants}
          className={`header__users-pill ${participantsActive ? 'header__users-pill--active' : ''}`}
          title={
            demo
              ? `${participantCount} de ${DEMO_MAX_USERS_PER_ROOM} participantes — ver lista`
              : `${participantCount} participantes — ver lista`
          }
          data-testid="room-capacity"
        >
          <Users size={14} />
          <span>{demo ? `${participantCount}/${DEMO_MAX_USERS_PER_ROOM}` : participantCount}</span>
        </button>


        {/* Clock Pill: Penúltimo elemento (antes de Configuración) */}
        {/* Nota: la pill de duración del vídeo se quitó a propósito: con el
            reloj ya hay un solo contador en el header. */}
        <div className="header__share-wrap" ref={clockRef}>
          <button
            onClick={() => setShowClockMenu((v) => !v)}
            className={`header__room-pill header__timer-pill ${timerToneClass}`}
            title={timerPillTitle}
            type="button"
          >
            {isWaiting ? <Hourglass size={13} color={timerIconColor} /> : <Clock size={13} color={timerIconColor} />}
            <span className="header__timer-pill__label">{timerPillText}</span>
          </button>

          {clockPresence.shown && (
            <div
              className={`header-share-menu ${clockPresence.closing ? 'header-share-menu--closing' : ''}`}
              ref={clockSheetRef}
            >
              {/* Estado de espera o tiempo transcurrido */}
              <div className="header-share-menu__row">
                <div className="header-share-menu__info">
                  <span className="header-share-menu__label">
                    {isWaiting ? <Hourglass size={12} /> : <Clock size={12} />}
                    {isWaiting ? ' Esperando participantes' : ' Tiempo en sala'}
                  </span>
                  <span className="header-share-menu__value">
                    {isWaiting
                      ? `Esperando… ${formatRemaining(elapsedMs)}`
                      : `Llevan ${formatRemaining(elapsedMs)}`}
                  </span>
                </div>
              </div>

              {/* Info extra para waiting */}
              {isWaiting && (
                <div className="header-share-menu__row">
                  <div className="header-share-menu__info">
                    <span className="header-share-menu__label">
                      <Clock size={12} /> Temporizador
                    </span>
                    <span className="header-share-menu__value">Inicia cuando alguien entre</span>
                  </div>
                </div>
              )}

              {/* Tiempo restante hasta el cierre si hay temporizador (solo activo) */}
              {!isWaiting && remainingMs !== null && (
                <div className="header-share-menu__row">
                  <div className="header-share-menu__info">
                    <span className="header-share-menu__label">
                      <Hourglass size={12} /> Tiempo restante
                    </span>
                    <span className="header-share-menu__value">Quedan {formatRemaining(remainingMs)}</span>
                  </div>
                </div>
              )}

              {/* Hora estimada de cierre (solo activo) */}
              {!isWaiting && formattedCloseTime && (
                <div className="header-share-menu__row">
                  <div className="header-share-menu__info">
                    <span className="header-share-menu__label">Hora de cierre</span>
                    <span className="header-share-menu__value">Cierra a las {formattedCloseTime}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ⚙ Room settings (leader only): name, info, save-mode, approval, timer */}
        {isLeader && onOpenSettings && (
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
