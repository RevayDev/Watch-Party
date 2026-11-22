import { Button } from '../shared/components/ui';
import React from 'react';
import { BottomSheet } from '../shared/components/BottomSheet';

interface LeaderExitModalProps {
  browserHosted?: boolean;
  busy?: boolean;
  error?: string;
  isOpen: boolean;
  participantCount: number;
  isTemporary?: boolean;
  onClose: () => void;
  onLeaveOnlyMe: () => void;
  onDeleteRoomForAll: () => void;
}

export const LeaderExitModal: React.FC<LeaderExitModalProps> = ({
  browserHosted = false, busy = false, error,
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
      onClose={busy ? () => {} : onClose}
      label="¿Estás seguro de que quieres salir?"
      className="leader-exit-modal"
    >
        <div className="modal-card__header">
          <h3 className="leader-exit-modal__title">¿Estás seguro de que quieres salir?</h3>
        </div>

        <p className="leader-exit-modal__desc">
          {browserHosted ? 'Puedes salir y transferir el servidor a otro participante, o cerrar la sala para todos.' : isTemporary
            ? 'Esta sala está en modo Temporal. Al finalizar la sala se cerrará y se borrarán los archivos.'
            : 'Esta sala está en modo Permanente / Guardado. Puedes salir sin borrar la sala ni el video.'}
        </p>

        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">Transfiriendo el servidor y la propiedad. Mantén esta pestaña abierta.</p>}
        <div className="leader-exit-modal__actions">
          {/* Salir sólo yo (siempre disponible para anfitrión en salas permanentes, o cuando hay más participantes) */}
          <Button variant="unstyled"
            type="button"
            disabled={busy} onClick={onLeaveOnlyMe}
            className="leader-exit-modal__opt-btn leader-exit-modal__opt-btn--transfer"
          >
            <div className="leader-exit-modal__btn-text">
              <strong>{busy ? 'Esperando el relevo…' : 'Salir solo yo'}</strong>
              <span>
                {browserHosted ? (hasOtherParticipants ? 'Esperaremos la confirmación del siguiente servidor antes de desconectarte.' : 'No quedan participantes: la sala terminará cuando salgas.') : hasOtherParticipants
                  ? 'Tú saldrás de la llamada y se transferirá el rol al siguiente usuario.'
                  : 'Saldrás de la sala pero el código y el video seguirán guardados para cuando vuelvas.'}
              </span>
            </div>
          </Button>

          {/* Eliminar sala para todos */}
          <Button variant="danger"
            type="button"
            disabled={busy} onClick={onDeleteRoomForAll}
            className="leader-exit-modal__opt-btn leader-exit-modal__opt-btn--danger"
          >
            <div className="leader-exit-modal__btn-text">
              <strong>{browserHosted ? 'Cerrar sala para todos' : isTemporary ? 'Cerrar y eliminar sala' : 'Eliminar sala permanentemente'}</strong>
              <span>{browserHosted ? 'Finaliza la sesión de todos los participantes.' : 'Desconecta a todos los miembros y elimina el registro de la sala.'}</span>
            </div>
          </Button>
        </div>

        <Button variant="secondary"
          type="button"
          disabled={busy} onClick={onClose}
          className="leader-exit-modal__cancel-btn"
        >
          Cancelar
        </Button>
    </BottomSheet>
  );
};
