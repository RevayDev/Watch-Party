import { useEffect, useState } from 'react';
import { ApiService, BACKEND_BASE } from '../services/api';

export function YouTubeSettingsSection({ provider = '', onChange, canEdit }: {
  provider?: string; onChange?: (provider: string) => void; canEdit: boolean;
}) {
  const [source, setSource] = useState(provider ? 'room' : 'platform');
  const [kind, setKind] = useState<'google' | 'endpoint'>('google');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('Comprobando servicio…');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const base = BACKEND_BASE.replace(/\/$/, '');
  const editable = canEdit && !!onChange;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}/api/youtube/${provider ? `providers/${provider}` : 'status'}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Servicio no disponible');
        if (provider && !controller.signal.aborted) {
          setKind(data.kind);
          setEndpoint(data.endpoint || '');
        }
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
      const response = await fetch(`${base}/api/youtube/providers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'google' ? { kind, apiKey } : { kind, endpoint, token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo registrar el proveedor');
      try { sessionStorage.setItem(`youtube-provider-owner:${data.id}`, data.owner); } catch { /* Registration remains usable until its expiration. */ }
      onChange?.(data.id);
      setApiKey(''); setToken('');
      setMessage('Proveedor registrado para esta sala. Prueba la búsqueda para comprobar las credenciales.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar'); }
    finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMessage('');
    try {
      const tracks = await ApiService.youtubeSearch('música', AbortSignal.timeout(8000), provider || undefined);
      setMessage(`Conexión correcta · ${tracks.length} resultados`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo buscar'); }
    finally { setBusy(false); }
  }

  return <section className="youtube-settings">
    <div className="settings-section-heading"><h4>Búsqueda de YouTube</h4><p>Los enlaces se reproducen sin una clave. La API key se necesita para buscar canciones y videos.</p></div>
    <div className="settings-source-options">
      <label><input type="radio" name="youtube-source" checked={source === 'platform'} disabled={!editable} onChange={() => setSource('platform')} /><span><strong>Servicio de la plataforma</strong><small>Usa el endpoint y la cuota configurados por el administrador</small></span></label>
      <label><input type="radio" name="youtube-source" checked={source === 'room'} disabled={!editable} onChange={() => setSource('room')} /><span><strong>Proveedor de esta sala</strong><small>Registra tu API key o un endpoint de búsqueda propio</small></span></label>
    </div>
    <p className="settings-connection-status" role="status">{status}</p>
    {source === 'platform' ? <label className="room-settings__group">Endpoint de la plataforma<input className="room-settings__input" readOnly value={`${base || window.location.origin}/api/youtube/search`} /></label> : <div className="room-settings__box">
      <label className="room-settings__group">Tipo de proveedor<select className="room-settings__input" value={kind} disabled={!editable} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="google">YouTube Data API · API key</option><option value="endpoint">Endpoint propio · token opcional</option></select></label>
      {kind === 'google' ? <label className="room-settings__group">API key<input type="password" autoComplete="off" className="room-settings__input" value={apiKey} disabled={!editable} maxLength={200} onChange={(event) => setApiKey(event.target.value)} placeholder="Pega tu API key de YouTube Data API v3" /></label> : <>
        <label className="room-settings__group">Endpoint HTTPS<input type="url" className="room-settings__input" value={endpoint} disabled={!editable} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://tu-servidor.com/search" /></label>
        <label className="room-settings__group">Token del endpoint (opcional)<input type="password" autoComplete="off" className="room-settings__input" value={token} disabled={!editable} onChange={(event) => setToken(event.target.value)} /></label>
        <p className="room-settings__box-desc">El administrador debe autorizar el dominio del endpoint en el backend. Recibirá la consulta en «q» y debe devolver una lista «tracks» con id de YouTube, name y artists.</p>
      </>}
      <p className="room-settings__box-desc">La credencial se guarda solo en la memoria del backend durante 6 horas. No se envía a los participantes y debe registrarse de nuevo si el backend se reinicia.</p>
      <a className="settings-help-link" href="https://developers.google.com/youtube/data/guides/authentication" target="_blank" rel="noreferrer">Cómo obtener una API key</a>
    </div>}
    <div className="youtube-settings__actions">
      {editable && <button type="button" className="btn btn--primary" disabled={busy || (source === 'room' && (kind === 'google' ? apiKey.trim().length < 20 : !endpoint.trim()))} onClick={() => void save()}>{busy ? 'Procesando…' : source === 'room' ? 'Registrar para la sala' : 'Usar plataforma'}</button>}
      <button type="button" className="leader-exit-modal__cancel-btn" disabled={busy} onClick={() => void test()}>Probar búsqueda actual</button>
    </div>
    {message && <p role="status" className="room-settings__box-desc">{message}</p>}
  </section>;
}
