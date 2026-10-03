import React from 'react';
import { MoreVertical, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { IParticipant } from '../../../types/room';
import { getAvatarColor, getInitials } from '../../../shared/utils';

export interface RoomTabProps {
  filteredParticipants: IParticipant[];
  isSameUser: (p: IParticipant) => boolean;
  getParticipantMediaState: (p: IParticipant) => { mic: boolean; cam: boolean };
  canModerate: boolean;
  selectedName?: string;
  onSelect: (p: IParticipant) => void;
  onMuteClick: (p: IParticipant, e: React.MouseEvent) => void;
  onCamClick: (p: IParticipant, e: React.MouseEvent) => void;
}

/** Tab 1: lista de participantes en sala (JSX movido verbatim). */
export const RoomTab: React.FC<RoomTabProps> = ({
  filteredParticipants,
  isSameUser,
  getParticipantMediaState,
  canModerate,
  selectedName,
  onSelect,
  onMuteClick,
  onCamClick,
}) => {
  return (
    <div className="part-list">
      {filteredParticipants.map((p, idx) => {
        const isMe = isSameUser(p);
        const isHostUser = p.isHost || p.role === 'host';
        const isCoHostUser = !isHostUser && p.role === 'cohost';
        const media = getParticipantMediaState(p);
        const isSelected = selectedName === p.name;

        return (
          <div
            key={`${p.name}-${idx}`}
            onClick={() => onSelect(p)}
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
                  media.mic
                    ? 'part-status-dot--speaking'
                    : 'part-status-dot--online'
                }`}
              />
            </div>

            {/* Middle: Name & role tag */}
            <div className="part-info">
              <div className="part-name-row">
                <span className="part-name">{p.name}</span>
                {(isMe || isHostUser || isCoHostUser) && (
                  <span className="part-name-tag">
                    {isMe
                      ? '(Tú)'
                      : isHostUser
                        ? '(Host)'
                        : '(Co-Host)'}
                  </span>
                )}
              </div>
            </div>

            {/* Right: Interactive Action Buttons */}
            <div className="part-actions">
              {/* Interactive Mic Button */}
              <button
                type="button"
                onClick={(e) => onMuteClick(p, e)}
                className={`part-media-btn ${
                  media.mic
                    ? 'part-media-btn--mic-on'
                    : 'part-media-btn--mic-off'
                }`}
                title={
                  isMe
                    ? media.mic
                      ? 'Silenciar mi micrófono'
                      : 'Activar mi micrófono'
                    : canModerate
                      ? media.mic
                        ? `Silenciar a ${p.name}`
                        : 'El usuario tiene el micro apagado'
                      : media.mic
                        ? 'Micrófono activo'
                        : 'Micrófono apagado'
                }
                disabled={!isMe && (!canModerate || !media.mic)}
              >
                {media.mic ? <Mic size={13} /> : <MicOff size={13} />}
              </button>

              {/* Interactive Camera Button */}
              <button
                type="button"
                onClick={(e) => onCamClick(p, e)}
                className={`part-media-btn ${
                  media.cam
                    ? 'part-media-btn--cam-on'
                    : 'part-media-btn--cam-off'
                }`}
                title={
                  isMe
                    ? media.cam
                      ? 'Apagar mi cámara'
                      : 'Activar mi cámara'
                    : canModerate
                      ? media.cam
                        ? `Apagar cámara de ${p.name}`
                        : 'Cámara apagada'
                      : media.cam
                        ? 'Cámara encendida'
                        : 'Cámara apagada'
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
                  onSelect(p);
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
  );
};
