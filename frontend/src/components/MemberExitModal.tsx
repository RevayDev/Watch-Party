import React from 'react';
import { BottomSheet } from '../shared/components/BottomSheet';
import { LogOut } from 'lucide-react';

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
      label="¿Salir de la sala?"
      className="host-exit-modal"
    >
      <div className="modal-card__header">
        <h3 className="host-exit-modal__title">¿Salir de la sala?</h3>
      </div>

      <p className="host-exit-modal__desc">
        ¿Estás seguro de que deseas abandonar la reunión? Podrás volver a unirte más tarde si la sala sigue activa.
      </p>

      <div className="host-exit-modal__actions">
        <button
          type="button"
          onClick={onConfirmLeave}
          className="host-exit-modal__opt-btn host-exit-modal__opt-btn--danger"
        >
          <div className="host-exit-modal__btn-text" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <LogOut size={18} />
            <strong>Sí, salir de la sala</strong>
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
