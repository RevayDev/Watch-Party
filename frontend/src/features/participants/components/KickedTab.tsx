import React from 'react';
import { Check } from 'lucide-react';
import { IKickedParticipant } from '../../../types/room';
import { notify } from '../../../services/notifications';
import { getInitials } from '../../../shared/utils';

export interface KickedTabProps {
  kickedUsers: IKickedParticipant[];
  onUnbanUser?: (targetUserName: string, targetUserId?: string) => void;
}

/** Tab 3: expulsados/baneados (JSX movido verbatim). */
export const KickedTab: React.FC<KickedTabProps> = ({
  kickedUsers,
  onUnbanUser,
}) => {
  return (
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
              style={{ background: '#374151' }}
            >
              {getInitials(k.name)}
            </div>
            <div className="part-info">
              <div className="part-name-row">
                <span className="part-name">{k.name}</span>
                <span
                  className={
                    k.banned ? 'part-badge-banned' : 'part-badge-kicked'
                  }
                >
                  {k.banned ? 'Baneado' : 'Expulsado'}
                </span>
                <span className="part-float-actions">
                  <button
                    type="button"
                    className="part-float-btn part-float-btn--ok part-float-btn--text"
                    title="Permitir de nuevo (desbanear)"
                    onClick={() => {
                      onUnbanUser?.(k.name, k.userId);
                      notify(
                        'success',
                        `${k.name} ya puede volver a entrar.`,
                        'Desbaneado',
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
  );
};
