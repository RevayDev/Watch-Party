import React, { useState, useRef, useEffect } from 'react';
import { Tv, Hash, Link as LinkIcon, Share2, Users, Settings } from 'lucide-react';
import { usePresence } from '../hooks/usePresence';

interface RoomHeaderProps {
  roomId: string;
  participantCount: number;
  isHost: boolean;
  roomName?: string;
  roomDescription?: string;
  timerEndsAt?: string | null;
  onOpenSettings?: () => void;
  onLeaveClick?: () => void;
  className?: string;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  roomId,
  participantCount,
  isHost,
  roomName,
  roomDescription,
  timerEndsAt,
  onOpenSettings,
  className = '',
}) => {
  const [showShareMenu, setShowShareMenu] = useState(false);
  const sharePresence = usePresence(showShareMenu, 160);
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
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(fullUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const hasRoomName = Boolean(roomName && roomName.trim());

  return (
    <header className={`header ${className} ${hasRoomName ? 'header--has-name' : ''}`}>
      {/* Brand */}
      <div className="header__brand">
        <Tv className="header__logo-icon" size={20} />
        <span className="header__brand-text">Watch Party</span>
      </div>

      {/* Room name (set from ⚙ Configuración de sala) */}
      {hasRoomName && (
        <div
          className="header__name-pill"
          title={roomDescription?.trim() ? `${roomName} — ${roomDescription}` : roomName}
        >
          <span>{roomName}</span>
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
            <div className={`header-share-menu ${sharePresence.closing ? 'header-share-menu--closing' : ''}`}>
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

              {(copiedCode || copiedLink) && (
                <span className="header-share-menu__toast">
                  {copiedCode && !copiedLink ? '¡Código copiado!' : '¡Link copiado!'}
                </span>
              )}
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

        {/* Participant count */}
        <div className="header__users-pill" title={`${participantCount} participantes`}>
          <Users size={14} />
          <span>{participantCount}</span>
        </div>

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
