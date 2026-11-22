import { Field, Button } from '../../../shared/components/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { ApiService, BACKEND_BASE } from '../../../services/api';
import type { IMusicTrack } from '../../../types/room';
import './YouTubeSearch.css';

interface Props {
  provider?: string;
  onAdd: (track: IMusicTrack) => void;
  onPlay?: (url: string, title: string) => void;
}

export function YouTubeSearch({ onAdd, onPlay, provider }: Props) {
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<IMusicTrack[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [backendAvailable, setBackendAvailable] = useState(Boolean(BACKEND_BASE));
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!BACKEND_BASE) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2000);
    fetch(`${BACKEND_BASE.replace(/\/$/, '')}/api/health`, { signal: controller.signal, cache: 'no-store' })
      .then(response => response.ok)
      .catch(() => false)
      .then(available => { if (!controller.signal.aborted) setBackendAvailable(available); })
      .finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, []);

  useEffect(() => () => request.current?.abort(), []);

  function resetSearch() {
    request.current?.abort();
    request.current = null;
    setQuery('');
    setTracks(null);
    setError('');
    setLoading(false);
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2 || request.current || !backendAvailable) return;

    const controller = new AbortController();
    request.current = controller;
    setTracks(null);
    setError('');
    setLoading(true);
    try {
      const results = await (provider ? ApiService.youtubeSearch(term, controller.signal, provider) : ApiService.youtubeSearch(term, controller.signal));
      if (!controller.signal.aborted && request.current === controller) setTracks(results);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'No se pudo buscar en YouTube.');
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <section className="room-settings__box youtube-search" aria-label="Buscar videos en YouTube">
      {!backendAvailable && <p role="status" className="youtube-search__offline">La búsqueda no está disponible porque el servidor externo está apagado. Puedes pegar directamente un enlace de YouTube.</p>}
      <form className="youtube-search__form" onSubmit={search} aria-disabled={!backendAvailable}>
        <Field
          type="search"
          className="room-settings__input"
          aria-label="Buscar en YouTube"
          placeholder="Busca una canción, video o karaoke"
          maxLength={100}
          value={query}
          onChange={(event) => event.target.value ? setQuery(event.target.value) : resetSearch()}
        />
        <Button variant="primary" type="submit" className="btn btn--primary" disabled={!backendAvailable || loading || query.trim().length < 2}>
          <Search size={16} aria-hidden="true" /> Buscar
        </Button>
      </form>
      {loading && <p role="status">Buscando en YouTube…</p>}
      {error && <p role="alert" className="youtube-search__error">{error}</p>}
      {tracks?.length === 0 && <p role="status">No se encontraron videos.</p>}
      {!!tracks?.length && (
        <ul className="youtube-search__results" aria-label="Resultados de YouTube">
          {tracks.map((track) => {
            const url = track.openUrl;
            return (
              <li key={track.id} className="youtube-search__result">
                <img src={track.albumArt} alt="" loading="lazy" />
                <div className="youtube-search__info">
                  <strong>{track.name}</strong>
                  <span>{track.artists}</span>
                </div>
                <div className="youtube-search__actions">
                  <Button variant="primary" type="button" className="btn btn--primary" onClick={() => { onAdd(track); resetSearch(); }} aria-label={`Añadir ${track.name} a la cola`}>
                    <Plus size={15} aria-hidden="true" /> A la cola
                  </Button>
                  {onPlay && url && (
                    <Button variant="secondary" type="button" className="leader-exit-modal__cancel-btn" onClick={() => { onPlay(url, track.name); resetSearch(); }}>
                      Ver en sala
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
