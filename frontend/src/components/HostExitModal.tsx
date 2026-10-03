import React from 'react';
import { BottomSheet } from '../shared/components/BottomSheet';

interface HostExitModalProps {
  isOpen: boolean;
  participantCount: number;
  isTemporary?: boolean;
  onClose: () => void;
  onLeaveOnlyMe: () => void;
  onDeleteRoomForAll: () => void;
}

export const HostExitModal: React.FC<HostExitModalProps> = ({
  isOpen,
  participantCount,
  isTemporary = true,
  onClose,
  onLeaveOnlyMe,
  onDeleteRoomForAll,
}) => {
  const hasOtherParticipants = participantCount > 1;

  return (
    <BottomSheet
      open={isOpen}
      onClose={onClose}
      label="Opciones de salida"
      className="host-exit-modal"
    >
        <div className="modal-card__header">
          <h3 className="host-exit-modal__title">Opciones de salida</h3>
        </div>

        <p className="host-exit-modal__desc">
          {isTemporary
            ? 'Esta sala está en modo Temporal. Al finalizar la sala se cerrará y se borrarán los archivos.'
            : 'Esta sala está en modo Permanente / Guardado. Puedes salir sin borrar la sala ni el video.'}
        </p>

        <div className="host-exit-modal__actions">
          {/* Salir sólo yo (siempre disponible para anfitrión en salas permanentes, o cuando hay más participantes) */}
          <button
            type="button"
            onClick={onLeaveOnlyMe}
            className="host-exit-modal__opt-btn host-exit-modal__opt-btn--transfer"
          >
            <div className="host-exit-modal__btn-text">
              <strong>Salir de la sala (Conservar sala)</strong>
              <span>
                {hasOtherParticipants
                  ? 'Tú saldrás de la llamada y se transferirá el rol al siguiente usuario.'
                  : 'Saldrás de la sala pero el código y el video seguirán guardados para cuando vuelvas.'}
              </span>
            </div>
          </button>

          {/* Eliminar sala para todos */}
          <button
            type="button"
            onClick={onDeleteRoomForAll}
            className="host-exit-modal__opt-btn host-exit-modal__opt-btn--danger"
          >
            <div className="host-exit-modal__btn-text">
              <strong>{isTemporary ? 'Cerrar y eliminar sala' : 'Eliminar sala permanentemente'}</strong>
              <span>Desconecta a todos los miembros y elimina el registro de la sala.</span>
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
    </BottomSheet>
  );
};
