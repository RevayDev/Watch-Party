import React, { useState } from 'react';
import { Users, Crown, User, ChevronDown, ChevronUp } from 'lucide-react';
import { IParticipant } from '../types/room';

interface ParticipantsProps {
  participants: IParticipant[];
  currentUserName: string;
}

export const Participants: React.FC<ParticipantsProps> = ({ participants, currentUserName }) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="panel" style={{ flex: '0 0 auto' }}>
      <div
        className="panel__header"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setIsOpen((v) => !v)}
        role="button"
        aria-expanded={isOpen}
        title={isOpen ? 'Ocultar participantes' : 'Mostrar participantes'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={16} />
          <span>Participantes ({participants.length})</span>
        </div>
        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      {isOpen && (
        <div className="panel__body" style={{ maxHeight: '190px' }}>
          {participants.map((p, idx) => {
            const isMe = p.name.toLowerCase() === currentUserName.toLowerCase();
            return (
              <div key={`${p.name}-${idx}`} className="participant-item">
                <div className="participant-item__name">
                  {p.isHost ? <Crown size={15} color="#f59e0b" /> : <User size={15} />}
                  <span>
                    {p.name}{' '}
                    {isMe && <span style={{ opacity: 0.6, fontSize: '0.8em' }}>(Tú)</span>}
                  </span>
                </div>
                {p.isHost && <span className="participant-item__badge">HOST</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
