import { SoundSettingsSection } from './SoundSettingsSection';
import { Button, Field, TextArea, Surface, Range } from '../shared/components/ui';
import React, { useEffect, useState } from "react";
import { YouTubeSettingsSection } from './YouTubeSettingsSection';
import { MediaSettingsSection } from './MediaSettings';
import { notify } from "../services/notifications";
import { BottomSheet } from "../shared/components/BottomSheet";
import { isDemoMode } from "../shared/demo";
import type { IRoomSettings } from "../types/room";
import { DUCK_DEFAULT_PCT, DUCK_MAX_PCT, DUCK_MIN_PCT, clampDuckPct } from "../shared/perf";
import './RoomSettingsModal.css';

interface RoomSettingsModalProps {
  youtubeProvider?: string;
  onYouTubeProviderChange?: (provider: string) => void;
  serverContent?: React.ReactNode;
  browserHosted?: boolean;
  localStream?: MediaStream | null;
  onRetryMedia?: () => void;
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
  /** Tu vista de la barra (personal, local: jamás se emite a la sala). */
  barShowLabels?: boolean;
  barLayout?: 'spread' | 'centered';
  onBarPrefsChange?: (patch: { showLabels?: boolean; layout?: 'spread' | 'centered' }) => void;
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
  barShowLabels = true,
  barLayout = 'spread',
  onBarPrefsChange,
  youtubeProvider,
  onYouTubeProviderChange,
  serverContent,
  browserHosted = false,
  localStream = null,
  onRetryMedia,
}) => {
  const [name, setName] = useState(roomName);
  const [description, setDescription] = useState(roomDescription);
  const [choice, setChoice] = useState<number | null>(timerMinutes);
  // Organización por pestañas: General, Barra (local) y Rendimiento.
  // Mismo contenido y handlers, solo agrupado.
  const [tab, setTab] = useState<'general' | 'barra' | 'rendimiento' | 'media' | 'server' | 'youtube' | 'sound'>('general');

  // Demo: la persistencia y el cierre automático configurable quedan
  // deshabilitados solo visualmente (el timer lo pone el servidor).
  // El código original queda intacto tras el flag.
  const demo = !browserHosted && isDemoMode();

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
      className="modal-card--settings room-settings-shell"
    >
        <div className="modal-card__header">
          <h3 className="leader-exit-modal__title">Configuración de la sala</h3>
        </div>

        <div className="room-settings__workspace">
        <div className="room-settings__tabs" role="tablist" aria-label="Secciones de configuración">
          {(
            [
              ['general', 'General'],
              ['barra', 'Apariencia'],
              ['rendimiento', 'Rendimiento'],
              ['media', 'Micrófono y cámara'],
              ['sound', 'Sonido'],
              ['server', 'Servidor'],
              ['youtube', 'YouTube'],
            ] as const
          ).map(([key, label]) => (
            <Button variant="unstyled"
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`room-settings__tab${tab === key ? ' room-settings__tab--active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        <section className="room-settings__page" role="tabpanel" aria-label={tab === 'sound' ? 'Sonido' : tab === 'barra' ? 'Apariencia' : tab === 'media' ? 'Micrófono y cámara' : tab === 'youtube' ? 'YouTube' : tab === 'server' ? 'Servidor' : tab === 'general' ? 'General' : 'Rendimiento'}>
        {tab === 'sound' && <SoundSettingsSection />}
        {tab === 'youtube' && <YouTubeSettingsSection provider={youtubeProvider} onChange={onYouTubeProviderChange} canEdit={canEdit} />}
        {tab === 'media' && onRetryMedia && <MediaSettingsSection localStream={localStream} onRetry={onRetryMedia} />}
        {tab === 'server' && (serverContent ?? <section className="room-settings__box">
          <h4>Servidor externo</h4>
          <p className="room-settings__box-desc">El backend administra la sala, los archivos y el proxy de video. El modo de servidor se elige al crear la sala.</p>
        </section>)}

        {tab === 'general' && (
        <>
        {browserHosted && <p className="room-settings__box-desc">Las salas del navegador son temporales. El temporizador y la aprobación de entrada requieren el servidor externo.</p>}
        <div className="room-settings__columns">
          {/* COLUMNA 1 — Información */}
          <div className="room-settings__column">
            {/* Nombre */}
            <div className="room-settings__group">
              <label className="room-settings__label" htmlFor="room-settings-name">Nombre de la sala</label>

              <Field
                id="room-settings-name"
                type="text"
                className="room-settings__input"
                maxLength={60}
                placeholder="Ej: Noche de viernes con amigos"
                value={name}
                disabled={!canEdit}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Información */}
            <div className="room-settings__group">
              <label className="room-settings__label" htmlFor="room-settings-description">
                Información de la sala
              </label>

              <TextArea id="room-settings-description"
                className="room-settings__textarea"
                maxLength={240}
                rows={3}
                placeholder="Ej: Cada viernes compartimos videos. Respeto y buen ambiente."
                value={description}
                disabled={!canEdit}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Temporizador */}
            <Surface className="room-settings__box">
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">
                  Temporizador de sala
                </span>

                {timerEndsAt && !demo && (
                  <Button variant="unstyled"
                    type="button"
                    className="room-settings__timer-remove"
                    onClick={() => handleSetTimer(null)}
                  >
                    Eliminar
                  </Button>
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
                  <Button variant="unstyled"
                    key={min}
                    type="button"
                    className={`room-settings__timer-chip ${
                      choice === min ? "room-settings__timer-chip--active" : ""
                    }`}
                    onClick={() => handleSetTimer(min)}
                    disabled={demo || browserHosted || !canEdit}
                    title={demo ? 'En la demo el temporizador lo configura el servidor' : undefined}
                  >
                    {min >= 60 ? `${min / 60} h` : `${min} min`}
                  </Button>
                ))}
              </div>

              <p className="room-settings__box-desc">
                Al llegar a 0 la sala se cierra para todos
                {isTemporary && " y se borra el video temporalmente"}.
              </p>
            </Surface>
          </div>

          {/* COLUMNA 2 — Opciones */}
          <div className="room-settings__column">
            {/* Sala temporal */}
            <Surface className="room-settings__box">
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">
                  {demo ? "Sala Temporal" : isTemporary ? "Sala Temporal" : "Video Guardado"}
                </span>

                <label
                  className="part-switch"
                  style={{ margin: 0, opacity: demo ? 0.5 : 1 }}
                  title={demo ? 'En la demo todas las salas son temporales' : undefined}
                >
                  <Field
                    type="checkbox"
                    checked={demo ? true : isTemporary}
                    onChange={() => onToggleTemporary()}
                    disabled={demo || browserHosted || !canEdit}
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
            </Surface>

            {/* Aprobar entrada */}
            <Surface className="room-settings__box">
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">
                  Aprobar entrada
                </span>

                <label className="part-switch" style={{ margin: 0 }}>
                  <Field
                    type="checkbox"
                    checked={requireApproval}
                    disabled={!canEdit || !onToggleRequireApproval}
                    onChange={() => onToggleRequireApproval?.()}
                  />
                  <span className="part-slider" />
                </label>
              </div>

              <p className="room-settings__box-desc">
                Los invitados esperan tu aprobación en Participantes.
              </p>
            </Surface>

            {/* Solo anfitriones controlan el video */}
            <Surface className="room-settings__box">
              <div className="room-settings__box-head">
                <span className="room-settings__box-title">
                  Control solo de anfitriones
                </span>

                <label className="part-switch" style={{ margin: 0 }}>
                  <Field
                    type="checkbox"
                    checked={hostOnlySync}
                    onChange={() => onToggleHostOnlySync?.()}
                    disabled={!canEdit || !onToggleHostOnlySync}
                  />
                  <span className="part-slider" />
                </label>
              </div>

              <p className="room-settings__box-desc">
                Activo: solo anfitrión y co-anfitriones controlan el video.
              </p>
            </Surface>
          </div>
        </div>
        </>
        )}

        {/* Rendimiento (rol B): ancho completo en PC */}
        {tab === 'rendimiento' && (
          <Surface className="room-settings__box room-settings__box--perf room-settings__box--full">
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
                  <Field
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
                  <Field
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
                  <Field
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
                  <Field
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
                  <Field
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
                <Range
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
            </Surface>
        )}


        {/* Tu vista de la barra: gusto personal, solo en este navegador.
            No se emite a la sala (a diferencia de Rendimiento). */}
        {tab === 'barra' && (
        <Surface className="room-settings__box room-settings__box--full">
            <div className="room-settings__box-head room-settings__box-head--title">
              <span className="room-settings__box-title">Tu vista de la barra</span>
            </div>
            <p className="room-settings__box-desc">
              Solo para ti, en este navegador. No afecta a los demás.
            </p>

            <div className="room-settings__box-head">
              <span className="room-settings__box-title">Textos bajo los iconos</span>
              <label className="part-switch" style={{ margin: 0 }}>
                <Field
                  type="checkbox"
                  checked={barShowLabels}
                  onChange={(e) => onBarPrefsChange?.({ showLabels: e.target.checked })}
                  title="Muestra u oculta los textos bajo los iconos de la barra"
                />
                <span className="part-slider" />
              </label>
            </div>
            <p className="room-settings__box-desc">
              Nombres como Silenciar, Chat o Música.
            </p>

            <div className="room-settings__box-head">
              <span className="room-settings__box-title">Barra distribuida en PC</span>
              <label className="part-switch" style={{ margin: 0 }}>
                <Field
                  type="checkbox"
                  checked={barLayout === 'spread'}
                  onChange={(e) => onBarPrefsChange?.({ layout: e.target.checked ? 'spread' : 'centered' })}
                  title="Agrupa comunicación, visibilidad y características en PC (apagado: barra compacta)"
                />
                <span className="part-slider" />
              </label>
            </div>
            <p className="room-settings__box-desc">
              Micrófono, cámara y conversación a la izquierda; ocultar en el centro; música y pantalla a la derecha. Colgar queda al final.
            </p>
        </Surface>
        )}

        </section>
        </div>
        {/* Actions */}
        <div className="room-settings__actions">
          <Button variant="secondary"
            type="button"
            className="leader-exit-modal__cancel-btn"
            onClick={onClose}
          >
            {tab === 'general' && canEdit ? 'Cancelar' : 'Cerrar'}
          </Button>

          {tab === 'general' && canEdit && <Button variant="primary"
            type="button"
            className="btn btn--primary"
            onClick={handleSave}
          >
            Guardar
          </Button>}
        </div>
    </BottomSheet>
  );
};
