import React, { useEffect, useRef, useState } from 'react';
import type { IMusicNowPlaying, IMusicQueueEntry, IMusicTrack, IRoomSettings } from '../../../types/room';

export interface MusicPanelProps {
  roomId: string;
  queue: IMusicQueueEntry[];
  nowPlaying: IMusicNowPlaying | null;
  settings: IRoomSettings;
  isModerator: boolean;
  myName: string;
  userId?: string;
  spotifyConnected: boolean;
  onSearch: (q: string) => Promise<IMusicTrack[] | null>;
  onAdd: (t: IMusicTrack) => void;
  onVote: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onApprove: (id: string) => void;
  onNext: () => void;
  onStop: () => void;
  onConnect: () => void;
}

function formatDuration(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function hasVoted(entry: { votes: string[] }, myName: string, userId?: string): boolean {
  if (userId && entry.votes.includes(userId)) return true;
  return entry.votes.includes(myName);
}

function openUrlFor(entry: { trackId: string }): string {
  return `https://open.spotify.com/track/${entry.trackId}`;
}

/**
 * Pestaña Música del drawer: buscador Spotify + cola colaborativa.
 * Reutiliza clases BEM del drawer/chat (`drawer-chat__*`) y de ajustes
 * (`room-settings__box-desc`); sin CSS nuevo ni dependencias nuevas.
 */
export const MusicPanel: React.FC<MusicPanelProps> = ({
  roomId,
  queue,
  nowPlaying,
  settings,
  isModerator,
  myName,
  userId,
  spotifyConnected,
  onSearch,
  onAdd,
  onVote,
  onRemove,
  onReorder,
  onApprove,
  onNext,
  onStop,
  onConnect,
}) => {
  void roomId;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IMusicTrack[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [retrySeq, setRetrySeq] = useState(0);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  const musicEnabled = settings.musicEnabled === true;
  const allowSearch = settings.musicAllowSearch !== false;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearchError('');
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError('');
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const tracks = await onSearchRef.current(q);
          if (tracks === null) {
            setResults(null);
            setSearchError('No se pudo buscar. Comprueba tu conexión.');
          } else {
            setResults(tracks);
            setSearchError('');
          }
        } catch {
          setResults(null);
          setSearchError('No se pudo buscar. Comprueba tu conexión.');
        } finally {
          setSearching(false);
        }
      })();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query, retrySeq]);

  if (!musicEnabled) {
    return (
      <div className="drawer-chat__empty">
        <p>La música está desactivada en esta sala.</p>
        <p className="room-settings__box-desc">El anfitrión puede activarla en Configuración → Música y Spotify.</p>
      </div>
    );
  }

  const canRemove = (entry: IMusicQueueEntry): boolean => {
    if (isModerator) return true;
    if (settings.musicCanRemove === 'moderator') return false;
    return entry.proposedBy === myName;
  };

  const moveEntry = (index: number, delta: -1 | 1) => {
    const next = [...queue];
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(j, 0, item);
    onReorder(next.map((e) => e.id));
  };

  const pending = queue.filter((e) => e.status === 'pending');
  const active = queue.filter((e) => e.status !== 'pending');

  return (
    <div className="drawer-chat__messages" aria-label="Música">
      <div className="drawer-chat__system-row">
        <span className="drawer-chat__system-pill">
          {spotifyConnected ? 'Spotify conectado' : 'Spotify desconectado'}
        </span>
      </div>

      {!spotifyConnected && (
        <div className="room-settings__box">
          <div className="room-settings__box-head">
            <span className="room-settings__box-title">Conecta Spotify para proponer</span>
          </div>
          <p className="room-settings__box-desc">Vincula tu cuenta para buscar y añadir canciones a la cola.</p>
          <button type="button" className="btn btn--primary" onClick={onConnect}>
            Conectar
          </button>
        </div>
      )}

      {nowPlaying && (
        <div className="room-settings__box" aria-label="Sonando ahora">
          <div className="room-settings__box-head">
            <span className="room-settings__box-title">Sonando ahora</span>
          </div>
          <p>
            <strong>{nowPlaying.name}</strong> — {nowPlaying.artists}
          </p>
          <a href={openUrlFor(nowPlaying)} target="_blank" rel="noreferrer">
            Abrir en Spotify
          </a>
          {isModerator && (
            <div className="room-settings__actions">
              <button type="button" className="leader-exit-modal__cancel-btn" onClick={onNext}>
                Siguiente
              </button>
              <button type="button" className="leader-exit-modal__cancel-btn" onClick={onStop}>
                Detener
              </button>
            </div>
          )}
        </div>
      )}

      {allowSearch ? (
        <div className="drawer-chat__input-bar">
          <input
            type="text"
            className="drawer-chat__input"
            placeholder="Buscar canciones en Spotify"
            aria-label="Buscar canciones en Spotify"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : (
        <p className="room-settings__box-desc">La búsqueda está desactivada en esta sala.</p>
      )}

      {searching && <p className="room-settings__box-desc">Buscando…</p>}
      {searchError && (
        <div className="room-settings__box">
          <p className="room-settings__box-desc">{searchError}</p>
          <button type="button" className="btn btn--primary" onClick={() => setRetrySeq((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      )}
      {results !== null && !searchError && (
        <div aria-label="Resultados">
          {results.length === 0 ? (
            <p className="room-settings__box-desc">Sin resultados para esa búsqueda.</p>
          ) : (
            results.map((t) => (
              <div key={t.id} className="drawer-chat__msg">
                {t.albumArt && <img src={t.albumArt} alt="" width={40} height={40} />}
                <div>
                  <p className="drawer-chat__author">{t.name}</p>
                  <p className="drawer-chat__text">
                    {t.artists}
                    {formatDuration(t.durationMs) && ` · ${formatDuration(t.durationMs)}`}
                  </p>
                </div>
                <button type="button" className="btn btn--primary" onClick={() => onAdd(t)}>
                  Añadir
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {isModerator && pending.length > 0 && (
        <div aria-label="Pendientes de aprobación">
          <div className="room-settings__box-head room-settings__box-head--title">
            <span className="room-settings__box-title">Pendientes ({pending.length})</span>
          </div>
          {pending.map((e) => (
            <div key={e.id} className="drawer-chat__msg">
              <div>
                <p className="drawer-chat__author">
                  {e.name} <span className="drawer-chat__time">pendiente</span>
                </p>
                <p className="drawer-chat__text">
                  {e.artists} · <span>por {e.proposedBy}</span>
                </p>
              </div>
              <button type="button" className="btn btn--primary" onClick={() => onApprove(e.id)}>
                Aprobar
              </button>
              {canRemove(e) && (
                <button
                  type="button"
                  className="leader-exit-modal__cancel-btn"
                  aria-label={`Eliminar ${e.name}`}
                  onClick={() => onRemove(e.id)}
                >
                  Eliminar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div aria-label="Cola">
        <div className="room-settings__box-head room-settings__box-head--title">
          <span className="room-settings__box-title">Cola ({active.length})</span>
        </div>
        {active.length === 0 ? (
          <div className="drawer-chat__empty">
            <p>La cola está vacía. ¡Propón la primera canción!</p>
          </div>
        ) : (
          active.map((e, i) => {
            const voted = hasVoted(e, myName, userId);
            return (
              <div key={e.id} className="drawer-chat__msg">
                {e.albumArt && <img src={e.albumArt} alt="" width={40} height={40} />}
                <div>
                  <p className="drawer-chat__author">{e.name}</p>
                  <p className="drawer-chat__text">
                    {e.artists} · <span>por {e.proposedBy}</span>
                    {` · ${e.votes.length} voto${e.votes.length === 1 ? '' : 's'}`}
                  </p>
                </div>
                <button type="button" className="btn btn--primary" onClick={() => onVote(e.id)}>
                  {voted ? 'Votado' : 'Votar'}
                </button>
                {canRemove(e) && (
                  <button
                    type="button"
                    className="leader-exit-modal__cancel-btn"
                    aria-label={`Eliminar ${e.name}`}
                    onClick={() => onRemove(e.id)}
                  >
                    Eliminar
                  </button>
                )}
                {isModerator && settings.musicAllowReorder === true && (
                  <span>
                    <button
                      type="button"
                      aria-label={`Subir ${e.name}`}
                      disabled={i === 0}
                      onClick={() => moveEntry(queue.indexOf(e), -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Bajar ${e.name}`}
                      disabled={i === active.length - 1}
                      onClick={() => moveEntry(queue.indexOf(e), 1)}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="room-settings__box-desc">
        Nota: la reproducción completa requiere Spotify Premium; sin Premium se usa el reproductor integrado (embed).
      </p>
    </div>
  );
};

export default MusicPanel;
