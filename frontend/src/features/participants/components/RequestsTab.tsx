import React from 'react';
import { Check, X, Ban } from 'lucide-react';
import { IJoinRequest } from '../../../types/room';
import { confirmAction, notify } from '../../../services/notifications';
import { getAvatarColor, getInitials } from '../../../shared/utils';

export interface RequestsTabProps {
  joinRequests: IJoinRequest[];
  onApproveJoin?: (userId: string | undefined, name: string) => void;
  onRejectJoin?: (userId: string | undefined, name: string, ban: boolean) => void;
}

/** Tab 2: solicitudes en espera (JSX movido verbatim). */
export const RequestsTab: React.FC<RequestsTabProps> = ({
  joinRequests,
  onApproveJoin,
  onRejectJoin,
}) => {
  if (joinRequests.length === 0) {
    return (
      <div className="part-empty-state">
        <p>No hay solicitudes pendientes</p>
        <span>
          Los invitados que soliciten unirse aparecerán aquí para ser
          aceptados.
        </span>
      </div>
    );
  }
  return (
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
            </div>
            <span className="part-request-time">
              pidió unirse{' '}
              {new Date(r.requestedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {/* Actions below the name: own wrapping row, never clipped */}
            <div className="part-request-actions">
              <button
                type="button"
                className="part-float-btn part-float-btn--ok part-float-btn--text"
                title="Aceptar solicitud"
                onClick={() => {
                  onApproveJoin?.(r.userId, r.name);
                  notify(
                    'success',
                    `${r.name} ya puede entrar a la sala.`,
                    'Solicitud aceptada',
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
                    title: 'Rechazar solicitud',
                    message: `¿Rechazar la solicitud de ${r.name}? Podrá volver a pedir unirse.`,
                    confirmLabel: 'Rechazar',
                    danger: true,
                  }).then((ok) => {
                    if (ok) {
                      onRejectJoin?.(r.userId, r.name, false);
                      notify(
                        'info',
                        `Se rechazó la solicitud de ${r.name}.`,
                        'Solicitud rechazada',
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
                    title: 'Banear usuario',
                    message: `¿Banear a ${r.name}? No podrá unirse a la sala.`,
                    confirmLabel: 'Banear',
                    danger: true,
                  }).then((ok) => {
                    if (ok) {
                      onRejectJoin?.(r.userId, r.name, true);
                      notify(
                        'warning',
                        `${r.name} fue baneado de la sala.`,
                        'Usuario baneado',
                      );
                    }
                  });
                }}
              >
                <Ban size={13} />
                Banear
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
