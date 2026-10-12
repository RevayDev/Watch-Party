import React, { useCallback, useEffect, useState } from "react";
import { Youtube } from "lucide-react";
import { notify } from "../services/notifications";
import { BottomSheet } from "../shared/components/BottomSheet";
import { isDemoMode } from "../shared/demo";
import type { IRoomSettings } from "../types/room";
import { DUCK_DEFAULT_PCT, DUCK_MAX_PCT, DUCK_MIN_PCT, clampDuckPct } from "../shared/perf";
import { ApiService } from "../services/api";
import {
  clearOwnSpotify,
  getOwnClientId,
  getSelfStatus,
  openOAuthTab,
  setOwnClientId,
  startSelfOAuth,
} from "../features/room/components/spotifyUser";
import { SelfSpotifyLink } from "../features/room/components/SelfSpotifyLink";

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
  /** Tu vista de la barra (personal, local: jamás se emite a la sala). */
  barShowLabels?: boolean;
  barLayout?: 'spread' | 'centered';
  onBarPrefsChange?: (patch: { showLabels?: boolean; layout?: 'spread' | 'centered' }) => void;
  /** Sala para el bloque de conexión Spotify (sin roomId se oculta). */
  roomId?: string;
  /** Música y Karaoke (YouTube) (todo se emite por onUpdatePerf como Rendimiento). */
  musicEnabled?: boolean;
  musicAllowSearch?: boolean;
  musicCanAdd?: 'anyone' | 'moderator';
  musicQueueMode?: 'fifo' | 'votes';
  musicCanRemove?: 'proposer' | 'moderator';
  musicAllowReorder?: boolean;
  musicRequireApproval?: boolean;
  musicMaxPerUser?: number;
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
  roomId,
  musicEnabled = false,
  musicAllowSearch = true,
  musicCanAdd = 'anyone',
  musicQueueMode = 'fifo',
  musicCanRemove = 'proposer',
  musicAllowReorder = true,
  musicRequireApproval = false,
  musicMaxPerUser = 3,
}) => {
  const [name, setName] = useState(roomName);
  const [description, setDescription] = useState(roomDescription);
  const [choice, setChoice] = useState<number | null>(timerMinutes);
  // Organización por pestañas: General (sala+timer), Música, Barra (local),
  // Rendimiento. Mismo contenido y handlers, solo agrupado.
  const [tab, setTab] = useState<'general' | 'musica' | 'barra' | 'rendimiento'>('general');

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

  const refreshSpotStatus = useCallback(async () => {
    if (!roomId) return;
    try {
      const s = await ApiService.spotifyStatus(roomId);
      setSpotConnected(s.connected === true);
      setSpotConfigured(s.configured !== false);
    } catch {
      setSpotConnected(null);
    }
  }, [roomId]);

  // ── Música y Spotify: estado de conexión (solo con roomId) ─────────────
  const [spotConnected, setSpotConnected] = useState<boolean | null>(null);
  const [spotConfigured, setSpotConfigured] = useState(true);
  const [spotBusy, setSpotBusy] = useState(false);
  // Cuenta propia (sin .env): se ofrece cuando el servidor no la da.
  const [selfLinked, setSelfLinked] = useState(false);
  const [selfAccount, setSelfAccount] = useState<string | null>(null);
  const refreshSelfStatus = useCallback(async () => {
    try {
      const s = await getSelfStatus();
      setSelfLinked(s.connected);
      setSelfAccount(s.accountName);
    } catch {
      setSelfLinked(false);
      setSelfAccount(null);
    }
  }, []);
  useEffect(() => {
    if (!isOpen || !roomId) return;
    let alive = true;
    setSpotConnected(null);
    ApiService.spotifyStatus(roomId)
      .then((s) => {
        if (!alive) return;
        setSpotConnected(s.connected === true);
        setSpotConfigured(s.configured !== false);
      })
      .catch(() => {
        if (alive) setSpotConnected(null);
      });
    void refreshSelfStatus();
    // Al volver de la pestaña de Spotify, re-consulta el estado.
    const onFocus = () => {
      void refreshSpotStatus();
      void refreshSelfStatus();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [isOpen, roomId, refreshSpotStatus, refreshSelfStatus]);

  const handleSpotConnect = async () => {
    if (!roomId || spotBusy) return;
    setSpotBusy(true);
    try {
      const ok = await openOAuthTab(async () => (await ApiService.spotifyAuthUrl(roomId)).authUrl);
      if (!ok) notify('error', 'Spotify no está configurado en este servidor.', 'Spotify');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'No se pudo conectar Spotify', 'Spotify');
    } finally {
      setSpotBusy(false);
    }
  };

  const handleSelfConnect = async () => {
    const clientId = getOwnClientId();
    if (!clientId) return;
    setSpotBusy(true);
    try {
      const ok = await openOAuthTab(async () => (await startSelfOAuth(clientId, roomId ?? '')).authUrl);
      if (!ok) notify('error', 'No se pudo iniciar la vinculación.', 'Spotify');
    } finally {
      setSpotBusy(false);
    }
  };

  const handleSpotDisconnect = async () => {
    if (!roomId || spotBusy) return;
    setSpotBusy(true);
    try {
      await ApiService.spotifyDisconnect(roomId);
      setSpotConnected(false);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'No se pudo desconectar Spotify', 'Spotify');
    } finally {
      setSpotBusy(false);
    }
  };

  const clampMaxPerUser = (v: number): number => {
    if (!Number.isFinite(v)) return 3;
    return Math.min(20, Math.max(1, Math.round(v)));
  };

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

        <div className="room-settings__tabs" role="tablist" aria-label="Secciones de configuración">
          {(
            [
              ['general', 'General'],
              ['musica', 'Música'],
              ['barra', 'Barra'],
              ['rendimiento', 'Rendimiento'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`room-settings__tab${tab === key ? ' room-settings__tab--active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'general' && (
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
        </div>
        )}

        {/* Rendimiento (rol B): ancho completo en PC */}
        {tab === 'rendimiento' && (
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
        )}


        {/* Tu vista de la barra: gusto personal, solo en este navegador.
            No se emite a la sala (a diferencia de Rendimiento). */}
        {tab === 'barra' && (
        <div className="room-settings__box room-settings__box--full">
            <div className="room-settings__box-head room-settings__box-head--title">
              <span className="room-settings__box-title">Tu vista de la barra</span>
            </div>
            <p className="room-settings__box-desc">
              Solo para ti, en este navegador. No afecta a los demás.
            </p>

            <div className="room-settings__box-head">
              <span className="room-settings__box-title">Textos bajo los iconos</span>
              <label className="part-switch" style={{ margin: 0 }}>
                <input
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
                <input
                  type="checkbox"
                  checked={barLayout === 'spread'}
                  onChange={(e) => onBarPrefsChange?.({ layout: e.target.checked ? 'spread' : 'centered' })}
                  title="Reparte izquierda/centro/derecha en pantalla ancha (apagado: píldora centrada)"
                />
                <span className="part-slider" />
              </label>
            </div>
            <p className="room-settings__box-desc">
              Izquierda, centro y derecha separados en PC.
            </p>
        </div>
        )}

        {/* Música & YouTube: sub-secciones Cola / Permisos / Límites / Conexión */}
        {tab === 'musica' && (
        <div className="room-settings__box room-settings__box--full room-settings__music-container" style={{ padding: '1.25rem' }}>
            <div className="room-settings__box-head room-settings__box-head--title">
              <span className="room-settings__box-title">Música y Karaoke (YouTube)</span>
            </div>

            {/* Hero Banner: YouTube Music & Karaoke */}
            <div className="room-settings__hero-banner">
              <div className="room-settings__hero-icon">
                <Youtube size={24} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 className="room-settings__hero-title">
                  <span>Música & Karaoke con YouTube</span>
                  <span className="room-settings__hero-badge">Recomendado</span>
                </h3>
                <p className="room-settings__hero-desc">
                  ¡Audio 100% compartido para toda la sala sin suscripciones de pago! Disfruta de canciones con letras sincronizadas y karaoke pegando cualquier enlace de <strong>YouTube</strong> directamente con el botón <em>"Cambiar"</em> del reproductor.
                </p>
              </div>
            </div>

            {!canEdit && (
              <p className="room-settings__box-desc" style={{ marginTop: 0 }}>
                Solo el anfitrión puede cambiar estos ajustes de la cola.
              </p>
            )}

            {/* Subsección: Opciones de la Cola */}
            <h4 className="room-settings__subhead">Cola de canciones</h4>

            <div className="room-settings__grid-cards">
              <div className="room-settings__card-row">
                <div className="room-settings__card-info">
                  <span className="room-settings__card-title">Funciones musicales</span>
                  <p className="room-settings__card-desc">Habilita o desactiva la cola colaborativa de la sala.</p>
                </div>
                <label className="part-switch" style={{ margin: 0, flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={musicEnabled}
                    disabled={perfDisabled}
                    onChange={(e) => onUpdatePerf?.({ musicEnabled: e.target.checked })}
                    title="Activa la cola musical colaborativa de la sala"
                  />
                  <span className="part-slider" />
                </label>
              </div>

              <div className="room-settings__card-row">
                <div className="room-settings__card-info">
                  <span className="room-settings__card-title">Búsqueda y propuestas</span>
                  <p className="room-settings__card-desc">Permite a los miembros buscar temas y agregarlos a la cola.</p>
                </div>
                <label className="part-switch" style={{ margin: 0, flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={musicAllowSearch}
                    disabled={perfDisabled}
                    onChange={(e) => onUpdatePerf?.({ musicAllowSearch: e.target.checked })}
                    title="Permite proponer canciones a la cola"
                  />
                  <span className="part-slider" />
                </label>
              </div>

              <div className="room-settings__card-row">
                <div className="room-settings__card-info">
                  <span className="room-settings__card-title">Reordenar (moderador)</span>
                  <p className="room-settings__card-desc">Los moderadores pueden mover y priorizar temas.</p>
                </div>
                <label className="part-switch" style={{ margin: 0, flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={musicAllowReorder}
                    disabled={perfDisabled}
                    onChange={(e) => onUpdatePerf?.({ musicAllowReorder: e.target.checked })}
                    title="Los moderadores pueden reordenar la cola"
                  />
                  <span className="part-slider" />
                </label>
              </div>

              <div className="room-settings__card-row">
                <div className="room-settings__card-info">
                  <span className="room-settings__card-title">Aprobar propuestas</span>
                  <p className="room-settings__card-desc">Las canciones requieren visto bueno antes de sonar.</p>
                </div>
                <label className="part-switch" style={{ margin: 0, flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={musicRequireApproval}
                    disabled={perfDisabled}
                    onChange={(e) => onUpdatePerf?.({ musicRequireApproval: e.target.checked })}
                    title="Las propuestas esperan aprobación de un moderador"
                  />
                  <span className="part-slider" />
                </label>
              </div>
            </div>

            {/* Subsección: Permisos y Reglas */}
            <h4 className="room-settings__subhead">Permisos</h4>

            <div className="room-settings__form-grid">
              <div className="room-settings__field-card">
                <label className="room-settings__field-label" htmlFor="music-can-add">
                  Quién puede proponer
                </label>
                <select
                  id="music-can-add"
                  className="room-settings__input"
                  value={musicCanAdd}
                  disabled={perfDisabled}
                  onChange={(e) => onUpdatePerf?.({ musicCanAdd: e.target.value as 'anyone' | 'moderator' })}
                >
                  <option value="anyone">Todos los miembros</option>
                  <option value="moderator">Solo moderadores</option>
                </select>
              </div>

              <div className="room-settings__field-card">
                <label className="room-settings__field-label" htmlFor="music-order">
                  Orden de la cola
                </label>
                <select
                  id="music-order"
                  className="room-settings__input"
                  value={musicQueueMode}
                  disabled={perfDisabled}
                  onChange={(e) => onUpdatePerf?.({ musicQueueMode: e.target.value as 'fifo' | 'votes' })}
                >
                  <option value="fifo">Orden de llegada</option>
                  <option value="votes">Por votación</option>
                </select>
              </div>

              <div className="room-settings__field-card">
                <label className="room-settings__field-label" htmlFor="music-can-remove">
                  Quién puede quitar
                </label>
                <select
                  id="music-can-remove"
                  className="room-settings__input"
                  value={musicCanRemove}
                  disabled={perfDisabled}
                  onChange={(e) => onUpdatePerf?.({ musicCanRemove: e.target.value as 'proposer' | 'moderator' })}
                >
                  <option value="proposer">Proponente</option>
                  <option value="moderator">Moderadores</option>
                </select>
              </div>
            </div>

            <h4 className="room-settings__subhead">Límites</h4>

            <div className="room-settings__form-grid">
              <div className="room-settings__field-card">
                <label className="room-settings__field-label" htmlFor="music-max-user">
                  Máximo por persona
                </label>
                <input
                  id="music-max-user"
                  type="number"
                  className="room-settings__input"
                  min={1}
                  max={20}
                  value={musicMaxPerUser}
                  disabled={perfDisabled}
                  onChange={(e) => onUpdatePerf?.({ musicMaxPerUser: clampMaxPerUser(Number(e.target.value)) })}
                />
              </div>
            </div>

            {/* Subsección: Conexión */}
            {roomId && (
              <>
                <h4 className="room-settings__subhead">Conexión</h4>
                {spotConfigured ? (
                  <div className="room-settings__card-row">
                    <div className="room-settings__card-info">
                      <span className="room-settings__card-title">
                        Spotify {spotConnected === null ? '' : spotConnected ? '● conectado' : '○ desconectado'}
                      </span>
                      <p className="room-settings__card-desc">
                        {spotConnected 
                          ? 'Cuenta conectada para buscar canciones en Spotify.' 
                          : 'Opcional si deseas importar búsquedas desde tu cuenta.'}
                      </p>
                    </div>
                    {spotConnected ? (
                      <button
                        type="button"
                        className="leader-exit-modal__cancel-btn"
                        disabled={spotBusy}
                        onClick={() => void handleSpotDisconnect()}
                      >
                        Desconectar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={spotBusy}
                        onClick={() => void handleSpotConnect()}
                      >
                        Conectar
                      </button>
                    )}
                  </div>
                ) : (
                  <SelfSpotifyLink
                    linked={selfLinked}
                    accountName={selfAccount}
                    ownClientId={getOwnClientId()}
                    busy={spotBusy}
                    onSaveClientId={(id) => setOwnClientId(id)}
                    onConnect={() => void handleSelfConnect()}
                    onUnlink={() => {
                      clearOwnSpotify();
                      void refreshSelfStatus();
                    }}
                  />
                )}
              </>
            )}
        </div>
        )}

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
