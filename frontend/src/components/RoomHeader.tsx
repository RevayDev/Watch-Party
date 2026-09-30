import React, { useState } from 'react';
import { Tv, Copy, Check, Users, Crown, Link as LinkIcon, Zap, HardDrive } from 'lucide-react';

interface RoomHeaderProps {
  roomId: string;
  participantCount: number;
  isHost: boolean;
  isTemporary?: boolean;
  onToggleTemporary?: () => void;
  onLeaveClick?: () => void;
  className?: string;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  roomId,
  participantCount,
  isHost,
  isTemporary = true,
  onToggleTemporary,
  className = '',
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    const fullUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <header className={`header ${className}`}>
      {/* Brand */}
      <div className="header__brand">
        <Tv className="header__logo-icon" size={20} />
        <span className="header__brand-text">Watch Party</span>
      </div>

      {/* Actions / Info */}
      <div className="header__actions">
        {/* Copy Direct Room Link Button */}
        <button
          onClick={handleCopyLink}
          className="header__room-pill"
          title="Copiar link de invitación directo de la sala"
          type="button"
          style={{ background: copiedLink ? 'rgba(16, 185, 129, 0.2)' : 'rgba(99, 102, 241, 0.15)', borderColor: copiedLink ? 'rgba(16, 185, 129, 0.4)' : 'rgba(99, 102, 241, 0.3)' }}
        >
          {copiedLink ? <Check size={13} color="#10b981" /> : <LinkIcon size={13} color="#818cf8" />}
          <span style={{ fontSize: '0.74rem', fontWeight: 600, color: copiedLink ? '#34d399' : '#c7d2fe' }}>
            {copiedLink ? '¡Link Copiado!' : 'Copiar Link'}
          </span>
        </button>

        {/* Room Code Pill with 1-click Copy */}
        <button
          onClick={handleCopyCode}
          className="header__room-pill"
          title="Copiar código de sala"
          type="button"
        >
          <span className="header__room-pill-code">{roomId}</span>
          <span className="header__room-pill-btn">
            {copiedCode ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
          </span>
        </button>

        {/* Temporary vs Persistent indicator / Host config button */}
        <button
          type="button"
          onClick={isHost ? onToggleTemporary : undefined}
          className="header__room-pill"
          style={{
            background: isTemporary ? 'rgba(234, 179, 8, 0.12)' : 'rgba(14, 165, 233, 0.12)',
            borderColor: isTemporary ? 'rgba(234, 179, 8, 0.3)' : 'rgba(14, 165, 233, 0.3)',
            cursor: isHost ? 'pointer' : 'default',
          }}
          title={
            isHost
              ? isTemporary
                ? 'Sala Temporal (clic para cambiar a Guardar Video)'
                : 'Sala Persistente / Video Guardado (clic para cambiar a Temporal)'
              : isTemporary
              ? 'Sala Temporal'
              : 'Sala Persistente'
          }
        >
          {isTemporary ? <Zap size={13} color="#facc15" /> : <HardDrive size={13} color="#38bdf8" />}
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: isTemporary ? '#fde047' : '#7dd3fc' }}>
            {isTemporary ? 'Temporal' : 'Video Guardado'}
          </span>
        </button>

        {/* Host badge */}
        {isHost && (
          <div className="header__host-pill" title="Eres el anfitrión">
            <Crown size={13} />
            <span>Host</span>
          </div>
        )}

        {/* Participant count */}
        <div className="header__users-pill" title={`${participantCount} participantes`}>
          <Users size={13} />
          <span>{participantCount}</span>
        </div>
      </div>
    </header>
  );
};

