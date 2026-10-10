import React from 'react';
import { BottomSheet } from '../shared/components/BottomSheet';

interface MemberExitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmLeave: () => void;
}

export const MemberExitModal: React.FC<MemberExitModalProps> = ({
  isOpen,
  onClose,
  onConfirmLeave,
}) => {
  return (
    <BottomSheet
      open={isOpen}
      onClose={onClose}
      label="¿Estás seguro de que quieres salir?"
      className="leader-exit-modal"
    >
      <div className="modal-card__header">
        <h3 className="leader-exit-modal__title">¿Estás seguro de que quieres salir?</h3>
      </div>

      <p className="leader-exit-modal__desc">
        ¿Estás seguro de que deseas abandonar la reunión? Podrás volver a unirte más tarde si la sala sigue activa.
      </p>

      <div className="leader-exit-modal__actions">
        <button
          type="button"
          onClick={onConfirmLeave}
          className="leader-exit-modal__opt-btn leader-exit-modal__opt-btn--danger"
        >
          <div className="leader-exit-modal__btn-text" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
            <strong>Sí, salir de la sala</strong>
          </div>
        </button>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="leader-exit-modal__cancel-btn"
      >
        Cancelar
      </button>
    </BottomSheet>
  );
};
