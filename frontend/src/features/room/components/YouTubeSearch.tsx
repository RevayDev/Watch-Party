import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { ApiService } from '../../../services/api';
import type { IMusicTrack } from '../../../types/room';
import './YouTubeSearch.css';

interface Props {
  onAdd: (track: IMusicTrack) => void;
  onPlay?: (url: string, title: string) => void;
}

export function YouTubeSearch({ onAdd, onPlay }: Props) {
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<IMusicTrack[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2 || request.current) return;

    const controller = new AbortController();
    request.current = controller;
    setTracks(null);
    setError('');
    setLoading(true);
    try {
      setTracks(await ApiService.youtubeSearch(term, controller.signal));
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'No se pudo buscar en YouTube.');
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <section className="room-settings__box youtube-search" aria-label="Buscar videos en YouTube">
      <form className="youtube-search__form" onSubmit={search}>
        <input
          type="search"
          className="room-settings__input"
          aria-label="Buscar en YouTube"
          placeholder="Busca una canción, video o karaoke"
          maxLength={100}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={loading || query.trim().length < 2}>
          <Search size={16} aria-hidden="true" /> Buscar
        </button>
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
                  <button type="button" className="btn btn--primary" onClick={() => onAdd(track)} aria-label={`Añadir ${track.name} a la cola`}>
                    <Plus size={15} aria-hidden="true" /> A la cola
                  </button>
                  {onPlay && url && (
                    <button type="button" className="leader-exit-modal__cancel-btn" onClick={() => onPlay(url, track.name)}>
                      Ver en sala
                    </button>
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
