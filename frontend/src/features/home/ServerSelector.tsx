import { RefreshCw } from 'lucide-react';
import { Field, Button } from '../../shared/components/ui';
import { useEffect, useState } from 'react';
import { BACKEND_BASE } from '../../services/api';

export type RoomServerMode = 'external' | 'hybrid' | 'host';
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
    const timeout = setTimeout(() => controller.abort(), import.meta.env.PROD ? 5000 : 2000);
    let active = true;
    setAvailability('checking');
    onAvailability(false);
    fetch(import.meta.env.PROD ? `/api/backend-status${attempt ? '?refresh=1' : ''}` : `${BACKEND_BASE.replace(/\/$/, '')}/api/health`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const body: unknown = await response.json();
        return response.ok && typeof body === 'object' && body !== null && 'ok' in body && body.ok === true;
      })
      .catch(() => false)
      .then((available) => {
        if (!active) return;
        setAvailability(available ? 'available' : 'unavailable');
        onAvailability(available);
        // El modo mixto conserva su intención: al crear, Home decidirá entre
        // Render y el anfitrión. El modo externo explícito sí cae a host para
        // no dejar el botón de crear bloqueado.
        if (!available && mode === 'external') onChange('host');
      })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [attempt, mode, onAvailability, onChange]);

  return (
    <fieldset className="server-selector">
      <legend>¿Dónde quieres alojar la sala?</legend>
      <p className="server-selector__intro">La misma experiencia, dos formas de conectar.</p>
        <div className={`server-selector__card server-selector__card--external ${mode === 'external' ? 'is-selected' : ''}`}>
          <Button variant="unstyled" type="button" className="server-selector__retry" aria-label="Reintentar conexión del servidor" title="Reintentar conexión" disabled={availability === 'checking'} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} /></Button>
          <label className="server-selector__option">
            <Field type="radio" name="server-mode" value="external" checked={mode === 'external'}
              disabled={availability !== 'available'} onChange={() => onChange('external')} />
            Servidor externo – {serverName}
          </label>
          <p className="room-settings__box-desc">El servidor gestiona la sala, los archivos y el proxy de video. Consume recursos del servidor externo.</p>
          <p role="status">{availability === 'checking' ? 'Comprobando conexión…' : availability === 'available' ? 'Servidor disponible.' : 'Servidor no disponible. Se usará el navegador del anfitrión.'}</p>
        </div>
      <div className={`server-selector__card ${mode === 'host' ? 'is-selected' : ''}`}>
        <label className="server-selector__option">
          <Field type="radio" name="server-mode" value="host" checked={mode === 'host'} onChange={() => onChange('host')} />
          Navegador del anfitrión
        </label>
        <p className="room-settings__box-desc">Tu equipo coordina video, chat y llamadas, con relevo automático entre participantes. Mantén la pestaña abierta; depende de tu conexión.</p>
        <span className="server-selector__limits">Hasta 8 personas · Archivos de hasta 256 MB</span>
      </div>
      <div className={`server-selector__card server-selector__card--hybrid ${mode === 'hybrid' ? 'is-selected' : ''}`}>
        <label className="server-selector__option">
          <Field type="radio" name="server-mode" value="hybrid" checked={mode === 'hybrid'} onChange={() => onChange('hybrid')} />
          Mixto inteligente
        </label>
        <p className="room-settings__box-desc">Usa Render para sala, chat, reacciones, YouTube, sincronización y señalización de cámara/micrófono. Si Render no responde al crearla, continúa con el navegador del anfitrión.</p>
        <p role="status">{availability === 'available' ? 'Usará el servidor en tiempo real.' : availability === 'checking' ? 'Comprobando si podrá usar Render…' : 'Render no responde: al crear usará el anfitrión como respaldo.'}</p>
      </div>
    </fieldset>
  );
}
