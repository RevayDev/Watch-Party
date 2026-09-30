import React, { useState } from 'react';
import { Tv, Copy, Check, Users, Crown } from 'lucide-react';

interface RoomHeaderProps {
  roomId: string;
  participantCount: number;
  isHost: boolean;
  onLeaveClick?: () => void;
  className?: string;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  roomId,
  participantCount,
  isHost,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        {/* Room Code Pill with 1-click Copy */}
        <button
          onClick={handleCopyCode}
          className="header__room-pill"
          title="Copiar código de sala"
          type="button"
        >
          <span className="header__room-pill-code">{roomId}</span>
          <span className="header__room-pill-btn">
            {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
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

