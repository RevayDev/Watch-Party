import React, { useEffect, useState } from "react";
import { notify } from "../services/notifications";
import { BottomSheet } from "../shared/components/BottomSheet";
import { isDemoMode } from "../shared/demo";

interface RoomSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isTemporary: boolean;
  onToggleTemporary: () => void;
  roomName: string;
  roomDescription: string;
  timerMinutes?: number | null;
  timerEndsAt?: string | null;
  requireApproval?: boolean;
  onSaveDetails: (name: string, description: string) => void;
  onSetTimer: (minutes: number | null) => void;
  onToggleRequireApproval?: () => void;
}

const TIMER_OPTIONS = [15, 30, 45, 60, 120, 180];

export const RoomSettingsModal: React.FC<RoomSettingsModalProps> = ({
  isOpen,
  onClose,
  isTemporary,
  onToggleTemporary,
  roomName,
  roomDescription,
  timerMinutes = null,
  timerEndsAt,
  requireApproval = false,
  onSaveDetails,
  onSetTimer,
  onToggleRequireApproval,
}) => {
  const [name, setName] = useState(roomName);
  const [description, setDescription] = useState(roomDescription);
  const [choice, setChoice] = useState<number | null>(timerMinutes);

  // Demo: la persistencia y el cierre automático configurable quedan
  // deshabilitados solo visualmente (el timer lo pone el servidor).
  // El código original queda intacto tras el flag.
  const demo = isDemoMode();

  // Re-sync from props every time the modal opens
  useEffect(() => {
    if (isOpen) {
      setName(roomName);
      setDescription(roomDescription);
      setChoice(timerMinutes ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSave = () => {
    onSaveDetails(name.trim(), description.trim());
    notify(
      "success",
      "Nombre e información de la sala actualizados.",
      "Configuración de sala",
    );
    onClose();
  };

  const handleSetTimer = (minutes: number | null) => {
    setChoice(minutes);
    onSetTimer(minutes);
  };

  const endsLabel = timerEndsAt
    ? new Date(timerEndsAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <BottomSheet
      open={isOpen}
      onClose={onClose}
      label="Configuración de la sala"
      className="modal-card--settings"
    >
        <div className="modal-card__header">
          <h3 className="host-exit-modal__title">Configuración de la sala</h3>
        </div>

        <div className="room-settings__columns">
          {/* COLUMNA 1 — Información */}
          <div className="room-settings__column">
            {/* Nombre */}
            <div className="room-settings__group">
              <label className="room-settings__label">Nombre de la sala</label>

              <input
                type="text"
                className="room-settings__input"
                maxLength={60}
                placeholder="Ej: Noche de viernes con amigos"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Información */}
            <div className="room-settings__group">
              <label className="room-settings__label">
                Información de la sala
              </label>

              <textarea
                className="room-settings__textarea"
                maxLength={240}
                rows={3}
                placeholder="Ej: Cada viernes compartimos videos. Respeto y buen ambiente."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Temporizador */}
            <div className="room-settings__box">
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">
                  Temporizador de sala
                </span>

                {timerEndsAt && !demo && (
                  <button
                    type="button"
                    className="room-settings__timer-remove"
                    onClick={() => handleSetTimer(null)}
                  >
                    Eliminar
                  </button>
                )}
              </div>

              {timerEndsAt && (
                <p className="room-settings__box-desc">
                  La sala se cerrará automáticamente a las{" "}
                  <strong>{endsLabel}</strong>.
                </p>
              )}

              {demo && (
                <p
                  className="room-settings__box-desc"
                  data-testid="demo-timer-note"
                >
                  En la demo el temporizador lo configura el servidor y no se
                  puede cambiar desde aquí.
                </p>
              )}

              <div className="room-settings__timer-grid">
                {TIMER_OPTIONS.map((min) => (
                  <button
                    key={min}
                    type="button"
                    className={`room-settings__timer-chip ${
                      choice === min ? "room-settings__timer-chip--active" : ""
                    }`}
                    onClick={() => handleSetTimer(min)}
                    disabled={demo}
                    title={demo ? 'En la demo el temporizador lo configura el servidor' : undefined}
                  >
                    {min >= 60 ? `${min / 60} h` : `${min} min`}
                  </button>
                ))}
              </div>

              <p className="room-settings__box-desc">
                Al llegar a 0 la sala se cierra para todos
                {isTemporary && " y se borra el video temporalmente"}.
              </p>
            </div>
          </div>

          {/* COLUMNA 2 — Opciones */}
          <div className="room-settings__column">
            {/* Sala temporal */}
            <div className="room-settings__box">
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">
                  {demo ? "Sala Temporal" : isTemporary ? "Sala Temporal" : "Video Guardado"}
                </span>

                <label
                  className="part-switch"
                  style={{ margin: 0, opacity: demo ? 0.5 : 1 }}
                  title={demo ? 'En la demo todas las salas son temporales' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={demo ? true : isTemporary}
                    onChange={() => onToggleTemporary()}
                    disabled={demo}
                    title={demo ? 'En la demo todas las salas son temporales' : undefined}
                  />
                  <span className="part-slider" />
                </label>
              </div>

              <p className="room-settings__box-desc">
                {demo
                  ? "En la demo todas las salas son temporales y no se puede cambiar."
                  : isTemporary
                    ? "Al cerrar la sala se borra el video y la sala automáticamente (ideal para videos pesados o funciones rápidas)."
                    : "El video se conserva subido en el servidor para futuras sesiones."}
              </p>
            </div>

            {/* Aprobar entrada */}
            <div className="room-settings__box">
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">
                  Aprobar entrada
                </span>

                <label className="part-switch" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={requireApproval}
                    onChange={() => onToggleRequireApproval?.()}
                  />
                  <span className="part-slider" />
                </label>
              </div>

              <p className="room-settings__box-desc">
                Los invitados que se unan quedarán en espera hasta que tú
                apruebes su entrada desde la lista de participantes.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="room-settings__actions">
          <button
            type="button"
            className="host-exit-modal__cancel-btn"
            onClick={onClose}
          >
            Cancelar
          </button>

          <button
            type="button"
            className="btn btn--primary"
            onClick={handleSave}
          >
            Guardar
          </button>
        </div>
    </BottomSheet>
  );
};
