import React, { useEffect, useState } from "react";
import { notify } from "../services/notifications";
import { BottomSheet } from "../shared/components/BottomSheet";
import { isDemoMode } from "../shared/demo";
import type { IRoomSettings } from "../types/room";
import { DUCK_DEFAULT_PCT, DUCK_MAX_PCT, DUCK_MIN_PCT, clampDuckPct } from "../shared/perf";

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
  /** Solo el anfitrión controla el vídeo (bloquea sync a no-moderadores). */
  hostOnlySync?: boolean;
  onToggleHostOnlySync?: () => void;
  /** Rol B: solo el anfitrión edita (los demás ven los valores deshabilitados). */
  canEdit?: boolean;
  /** Rol B: valores de rendimiento persistidos en ajustes de sala. */
  dataSaver?: boolean;
  fullscreenToasts?: boolean;
  reactionsEnabled?: boolean;
  visualEffects?: boolean;
  duckingEnabled?: boolean;
  duckingLevelPct?: number;
  /** Rol B: parche parcial que se emite por socket (el servidor fusiona). */
  onUpdatePerf?: (patch: Partial<IRoomSettings>) => void;
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
  canEdit = true,
  hostOnlySync = false,
  onToggleHostOnlySync,
  dataSaver = false,
  fullscreenToasts = true,
  reactionsEnabled = true,
  visualEffects = true,
  duckingEnabled = true,
  duckingLevelPct = DUCK_DEFAULT_PCT,
  onUpdatePerf,
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

  // Rol B: interruptores de rendimiento. Solo emiten si hay editor (leader);
  // el servidor valida la whitelist y difunde `room-settings-updated`.
  const perfDisabled = !canEdit || !onUpdatePerf;
  const duckPct = clampDuckPct(duckingLevelPct);

  return (
    <BottomSheet
      open={isOpen}
      onClose={onClose}
      label="Configuración de la sala"
      className="modal-card--settings"
    >
        <div className="modal-card__header">
          <h3 className="leader-exit-modal__title">Configuración de la sala</h3>
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
                Los invitados esperan tu aprobación en Participantes.
              </p>
            </div>

            {/* Solo anfitriones controlan el video */}
            <div className="room-settings__box">
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">
                  Control solo de anfitriones
                </span>

                <label className="part-switch" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={hostOnlySync}
                    onChange={() => onToggleHostOnlySync?.()}
                    disabled={!canEdit}
                  />
                  <span className="part-slider" />
                </label>
              </div>

              <p className="room-settings__box-desc">
                Activo: solo anfitrión y co-anfitriones controlan el video.
              </p>
            </div>
          </div>

          {/* Rendimiento (rol B): ancho completo en PC */}
          <div className="room-settings__box room-settings__box--perf room-settings__box--full">
              <div className="room-settings__box-head room-settings__box-head--title">
                <span className="room-settings__box-title">Rendimiento</span>
              </div>
              {!canEdit && (
                <p className="room-settings__box-desc">
                  Solo el anfitrión puede cambiar estos ajustes.
                </p>
              )}

              {/* Ahorro de datos */}
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">Modo ahorro de datos</span>
                <label className="part-switch" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={dataSaver}
                    disabled={perfDisabled}
                    onChange={(e) => onUpdatePerf?.({ dataSaver: e.target.checked })}
                    title="Cámaras remotas solo con audio y avisos de posición cada 15 s"
                  />
                  <span className="part-slider" />
                </label>
              </div>
              <p className="room-settings__box-desc">
                Audio en cámaras remotas y avisos cada 15 s.
              </p>

              {/* Avisos en pantalla completa */}
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">Avisos en pantalla completa</span>
                <label className="part-switch" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={fullscreenToasts}
                    disabled={perfDisabled}
                    onChange={(e) => onUpdatePerf?.({ fullscreenToasts: e.target.checked })}
                    title="Muestra los avisos del chat dentro del vídeo en pantalla completa"
                  />
                  <span className="part-slider" />
                </label>
              </div>
              <p className="room-settings__box-desc">
                Avisos del chat sobre el vídeo en pantalla completa.
              </p>

              {/* Reacciones */}
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">Reacciones</span>
                <label className="part-switch" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={reactionsEnabled}
                    disabled={perfDisabled}
                    onChange={(e) => onUpdatePerf?.({ reactionsEnabled: e.target.checked })}
                    title="Muestra las reacciones flotantes sobre el vídeo"
                  />
                  <span className="part-slider" />
                </label>
              </div>
              <p className="room-settings__box-desc">
                Emojis flotantes sobre el vídeo.
              </p>

              {/* Efectos visuales (combo Interestellar + animaciones largas) */}
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">Efectos visuales</span>
                <label className="part-switch" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={visualEffects}
                    disabled={perfDisabled}
                    onChange={(e) => onUpdatePerf?.({ visualEffects: e.target.checked })}
                    title="Muestra el combo Interestellar y las animaciones largas"
                  />
                  <span className="part-slider" />
                </label>
              </div>
              <p className="room-settings__box-desc">
                Combo Interestellar y animaciones largas.
              </p>

              {/* Atenuación al hablar (ducking dinámico) */}
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">Atenuar vídeo al hablar</span>
                <label className="part-switch" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={duckingEnabled}
                    disabled={perfDisabled}
                    onChange={(e) => onUpdatePerf?.({ duckingEnabled: e.target.checked })}
                    title="Baja el volumen del vídeo mientras hablas por el micrófono"
                  />
                  <span className="part-slider" />
                </label>
              </div>
              <p className="room-settings__box-desc">
                Baja el vídeo mientras hablas.
              </p>
              <div className="perf-slider-row">
                <label className="room-settings__label" htmlFor="perf-duck-level">
                  Nivel
                </label>
                <input
                  id="perf-duck-level"
                  type="range"
                  className="perf-slider"
                  min={DUCK_MIN_PCT}
                  max={DUCK_MAX_PCT}
                  step={1}
                  value={duckPct}
                  disabled={perfDisabled || !duckingEnabled}
                  onChange={(e) => onUpdatePerf?.({ duckingLevel: Number(e.target.value) })}
                  title={`Volumen del vídeo al hablar: ${duckPct}%`}
                />
                <span className="perf-slider-value">{duckPct}%</span>
              </div>
            </div>
        </div>

        {/* Actions */}
        <div className="room-settings__actions">
          <button
            type="button"
            className="leader-exit-modal__cancel-btn"
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
