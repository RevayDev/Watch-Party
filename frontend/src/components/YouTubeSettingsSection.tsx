import { Field, Surface, Button } from '../shared/components/ui';
import { useEffect, useState } from 'react';
import { ApiService, BACKEND_BASE } from '../services/api';

export function YouTubeSettingsSection({ provider = '', onChange, canEdit }: {
  provider?: string; onChange?: (provider: string) => void; canEdit: boolean;
}) {
  const [source, setSource] = useState(provider ? 'room' : 'platform');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('Comprobando servicio…');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const base = provider ? BACKEND_BASE.replace(/\/$/, '') : '';
  const editable = canEdit && !!onChange;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}/api/youtube/${provider ? `providers/${provider}` : 'status'}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Servicio no disponible');
        if (!controller.signal.aborted) setStatus(provider
          ? `Proveedor registrado hasta ${new Date(data.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : data.configured ? 'La búsqueda de la plataforma está disponible' : 'La plataforma no tiene una API key configurada. Puedes pegar enlaces o usar un proveedor de sala.');
      }).catch((error) => { if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'Sin conexión al backend'); });
    return () => controller.abort();
  }, [base, provider]);

  async function save() {
    if (!editable) return;
    setBusy(true); setMessage('');
    try {
      if (source === 'platform') {
        onChange?.('');
        try {
          const owner = sessionStorage.getItem(`youtube-provider-owner:${provider}`);
          if (provider && owner) {
            await fetch(`${base}/api/youtube/providers/${provider}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } });
            sessionStorage.removeItem(`youtube-provider-owner:${provider}`);
          }
        } catch { /* The server also expires registrations automatically. */ }
        setMessage('La sala usará el servicio de la plataforma'); return;
      }
      const response = await fetch(`${BACKEND_BASE.replace(/\/$/, '')}/api/youtube/providers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'google', apiKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo registrar el proveedor');
      try { sessionStorage.setItem(`youtube-provider-owner:${data.id}`, data.owner); } catch { /* Registration remains usable until its expiration. */ }
      onChange?.(data.id);
      setApiKey('');
      setMessage('Proveedor registrado para esta sala. Prueba la búsqueda para comprobar las credenciales.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar'); }
    finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMessage('');
    try {
      const tracks = await ApiService.youtubeSearch('música', AbortSignal.timeout(8000), provider || undefined);
      setMessage(`Conexión correcta – ${tracks.length} resultados`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo buscar'); }
    finally { setBusy(false); }
  }

  return <section className="youtube-settings">
    <div className="settings-section-heading"><h4>Búsqueda de YouTube</h4><p>Los enlaces se reproducen sin una clave. La API key se necesita para buscar canciones y videos.</p></div>
    <div className="settings-source-options">
      <label><Field type="radio" name="youtube-source" checked={source === 'platform'} disabled={!editable} onChange={() => setSource('platform')} /><span><strong>Servicio de la plataforma</strong><small>Usa el servicio configurado por el administrador</small></span></label>
      <label><Field type="radio" name="youtube-source" checked={source === 'room'} disabled={!editable} onChange={() => setSource('room')} /><span><strong>Proveedor de esta sala</strong><small>Registra tu API key de YouTube</small></span></label>
    </div>
    <p className="settings-connection-status" role="status">{status}</p>
    {source === 'platform' ? null : <Surface className="room-settings__box">
      <label className="room-settings__group">API key<Field type="password" autoComplete="off" className="room-settings__input" value={apiKey} disabled={!editable} maxLength={200} onChange={(event) => setApiKey(event.target.value)} placeholder="Pega tu API key de YouTube Data API v3" /></label>
      <p className="room-settings__box-desc">La credencial se guarda solo en la memoria del backend durante 6 horas. No se envía a los participantes y debe registrarse de nuevo si el backend se reinicia.</p>
      <a className="settings-help-link" href="https://developers.google.com/youtube/data/guides/authentication" target="_blank" rel="noreferrer">Cómo obtener una API key</a>
    </Surface>}
    <div className="youtube-settings__actions">
      {editable && <Button variant="primary" type="button" className="btn btn--primary" disabled={busy || (source === 'room' && apiKey.trim().length < 20)} onClick={() => void save()}>{busy ? 'Procesando…' : source === 'room' ? 'Registrar para la sala' : 'Usar plataforma'}</Button>}
      <Button variant="secondary" type="button" className="leader-exit-modal__cancel-btn" disabled={busy} onClick={() => void test()}>Probar búsqueda actual</Button>
    </div>
    {message && <p role="status" className="room-settings__box-desc">{message}</p>}
  </section>;
}
