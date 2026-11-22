import { useEffect, useState } from 'react';
import { BACKEND_BASE } from '../../services/api';

export type RoomServerMode = 'external' | 'host';
type Availability = 'checking' | 'available' | 'unavailable';

export function ServerSelector({ mode, onChange, onAvailability }: {
  mode: RoomServerMode;
  onChange: (mode: RoomServerMode) => void;
  onAvailability: (available: boolean) => void;
}) {
  const [availability, setAvailability] = useState<Availability>('checking');
  const [attempt, setAttempt] = useState(0);
  const serverName = BACKEND_BASE.includes('onrender.com') ? 'Render' : BACKEND_BASE ? 'Servidor configurado' : 'Backend local';
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    let active = true;
    setAvailability('checking');
    onAvailability(false);
    fetch(`${BACKEND_BASE.replace(/\/$/, '')}/api/health`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const body: unknown = await response.json();
        return response.ok && typeof body === 'object' && body !== null && 'ok' in body && body.ok === true;
      })
      .catch(() => false)
      .then((available) => {
        if (!active) return;
        setAvailability(available ? 'available' : 'unavailable');
        onAvailability(available);
        if (!available) onChange('host');
      })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [attempt, onAvailability, onChange]);

  return (
    <fieldset className="server-selector">
      <legend>¿Dónde quieres alojar la sala?</legend>
      <p className="server-selector__intro">La misma experiencia, dos formas de conectar.</p>
      {availability !== 'unavailable' && (
        <div className={`server-selector__card ${mode === 'external' ? 'is-selected' : ''}`}>
          <label className="server-selector__option">
            <input type="radio" name="server-mode" value="external" checked={mode === 'external'}
              disabled={availability !== 'available'} onChange={() => onChange('external')} />
            Servidor externo – {serverName}
          </label>
          <p className="room-settings__box-desc">El servidor gestiona la sala, los archivos y el proxy de video. Consume recursos del servidor externo.</p>
          <p role="status">{availability === 'checking' ? 'Comprobando conexión…' : 'Servidor disponible.'}</p>
        </div>
      )}
      {availability === 'unavailable' && (
        <p role="status" className="room-settings__box-desc">El servidor externo no está disponible. Se usará el navegador del anfitrión.</p>
      )}
      {availability === 'unavailable' && <button type="button" className="leader-exit-modal__cancel-btn" onClick={() => setAttempt((value) => value + 1)}>Volver a comprobar</button>}
      <div className={`server-selector__card ${mode === 'host' ? 'is-selected' : ''}`}>
        <label className="server-selector__option">
          <input type="radio" name="server-mode" value="host" checked={mode === 'host'} onChange={() => onChange('host')} />
          Navegador del anfitrión
        </label>
        <p className="room-settings__box-desc">Tu equipo coordina video, chat y llamadas, con relevo automático entre participantes. Mantén la pestaña abierta; depende de tu conexión.</p>
        <span className="server-selector__limits">Hasta 8 personas · Archivos de hasta 256 MB</span>
      </div>
    </fieldset>
  );
}
