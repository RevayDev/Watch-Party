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
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
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
    <fieldset className="room-settings__box">
      <legend>Servidor de la sala</legend>
      <label className="server-selector__option">
        <input type="radio" name="server-mode" value="external" checked={mode === 'external'}
          disabled={availability !== 'available'} onChange={() => onChange('external')} />
        Servidor externo · Render
      </label>
      <p className="room-settings__box-desc">La sala se administra en el backend y permite servir archivos y usar el proxy de video. Consume recursos de Render.</p>
      <p role="status">{availability === 'checking' ? 'Comprobando Render…' : availability === 'available'
        ? 'Render está disponible.' : 'Render no respondió. Puede estar dormido o sin conexión.'}</p>
      {availability === 'unavailable' && <button type="button" className="leader-exit-modal__cancel-btn" onClick={() => setAttempt((value) => value + 1)}>Volver a comprobar</button>}
      <label className="server-selector__option">
        <input type="radio" name="server-mode" value="host" checked={mode === 'host'} onChange={() => onChange('host')} />
        Navegador del anfitrión
      </label>
      <p className="room-settings__box-desc">Video, chat y llamadas entre participantes, con relevo automático. Depende de sus equipos y conexiones. Usa señalización independiente de PeerJS. Hasta 8 personas y archivos de 256 MB.</p>
    </fieldset>
  );
}
