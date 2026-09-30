import React from 'react';
import { X } from 'lucide-react';

interface HostExitModalProps {
  isOpen: boolean;
  participantCount: number;
  onClose: () => void;
  onLeaveOnlyMe: () => void;
  onDeleteRoomForAll: () => void;
}

export const HostExitModal: React.FC<HostExitModalProps> = ({
  isOpen,
  participantCount,
  onClose,
  onLeaveOnlyMe,
  onDeleteRoomForAll,
}) => {
  if (!isOpen) return null;

  const hasOtherParticipants = participantCount > 1;

  return (
    <div className="modal-overlay">
      <div className="modal-card host-exit-modal">
        <div className="modal-card__header">
          <h3 className="host-exit-modal__title">Salir de la sala</h3>
          <button onClick={onClose} className="meet-drawer__close-btn" title="Cancelar">
            <X size={18} />
          </button>
        </div>

        <p className="host-exit-modal__desc">
          Elige si deseas salir de la sala o finalizarla para todos los participantes.
        </p>

        <div className="host-exit-modal__actions">
          {hasOtherParticipants && (
            <button
              type="button"
              onClick={onLeaveOnlyMe}
              className="host-exit-modal__opt-btn host-exit-modal__opt-btn--transfer"
            >
              <div className="host-exit-modal__btn-text">
                <strong>Salir de la llamada</strong>
                <span>Se transferirá el rol de anfitrión al siguiente usuario.</span>
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={onDeleteRoomForAll}
            className="host-exit-modal__opt-btn host-exit-modal__opt-btn--danger"
          >
            <div className="host-exit-modal__btn-text">
              <strong>Finalizar sala para todos</strong>
              <span>Se cerrará la sala y se desconectará a todos los miembros.</span>
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="host-exit-modal__cancel-btn"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
};
