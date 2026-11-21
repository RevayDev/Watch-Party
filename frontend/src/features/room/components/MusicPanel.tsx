import React, { useState } from 'react';
import { Youtube, Plus, Trash2, ArrowUp, ArrowDown, Check, Disc, Play, Pause, SkipForward, Maximize2, ListMusic, MoreVertical, ExternalLink, Square } from 'lucide-react';
import type { IMusicNowPlaying, IMusicQueueEntry, IMusicTrack, IRoomSettings } from '../../../types/room';
import { parseYouTubeUrl } from '../../../shared/youtube';
import { formatPlayerTime, NowPlayingPlayer } from './NowPlayingPlayer';
import { YouTubeSearch } from './YouTubeSearch';

export interface MusicPanelProps {
  roomId: string;
  queue: IMusicQueueEntry[];
  nowPlaying: IMusicNowPlaying | null;
  settings: IRoomSettings;
  isModerator: boolean;
  myName: string;
  userId?: string;
  onAddUrl?: (url: string) => Promise<boolean>;
  onAdd: (t: IMusicTrack) => void;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onApprove: (id: string) => void;
  onNext: () => void;
  onAutoNext: () => void;
  onStop: () => void;
  /** Muestra el tema actual en la pantalla principal de la sala (moderador). */
  onExpandToMain?: (url: string, title: string, currentTime?: number) => void;
}

/**
 * ID de video para lo que suena: prueba trackId/uri/openUrl (URL completa o
 * ID suelto de 11 caracteres, que es como lo guarda la cola).
 */
export function resolveNowPlayingVideoId(
  np: { trackId?: string; uri?: string; openUrl?: string } | null | undefined
): string {
  if (!np) return '';
  for (const raw of [np.trackId, np.uri, np.openUrl]) {
    if (!raw) continue;
    const ref = parseYouTubeUrl(raw);
    if (ref) return ref.videoId;
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw.trim())) return raw.trim();
  }
  return '';
}

export const MusicPanel: React.FC<MusicPanelProps> = ({
  queue,
  nowPlaying,
  settings,
  isModerator,
  myName,
  onAddUrl,
  onAdd,
  onRemove,
  onReorder,
  onApprove,
  onNext,
  onAutoNext,
  onStop,
  onExpandToMain = () => undefined,
}) => {
  const [ytInput, setYtInput] = useState('');
  const [addingYt, setAddingYt] = useState(false);
  const [inputError, setInputError] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const musicEnabled = settings.musicEnabled !== false;
  const allowAdd = isModerator || settings.musicCanAdd !== 'moderator';

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInputError('');
    const raw = ytInput.trim();
    if (!raw) return;

    const ytRef = parseYouTubeUrl(raw);
    if (!ytRef) {
      setInputError('El enlace no es de YouTube válido (ej: https://youtu.be/... o youtube.com/watch?v=...)');
      return;
    }

    setAddingYt(true);
    try {
      if (onAddUrl) {
        if (!await onAddUrl(raw)) return;
      } else {
        const title = `YouTube Music (${ytRef.videoId})`;
        onAdd({
          id: ytRef.videoId,
          name: title,
          artists: 'YouTube Music / Karaoke',
          albumArt: `https://img.youtube.com/vi/${ytRef.videoId}/hqdefault.jpg`,
          uri: ytRef.cleanUrl,
          openUrl: ytRef.cleanUrl,
        });
      }
      setYtInput('');
    } catch (err: any) {
      setInputError(err?.message || 'Error al agregar a la cola');
    } finally {
      setAddingYt(false);
    }
  };

  if (!musicEnabled) {
    return (
      <div className="drawer-chat__empty">
        <Disc size={36} style={{ color: '#ef4444', marginBottom: '0.5rem', opacity: 0.8 }} />
        <p style={{ fontWeight: 600, color: '#f1f5f9' }}>La música está desactivada en esta sala.</p>
        <p className="room-settings__box-desc">El anfitrión puede activarla en Configuración → Música.</p>
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
  const nowVideoId = resolveNowPlayingVideoId(nowPlaying);
  const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderRadius: '7px',
    padding: '0.45rem 0.6rem',
    fontSize: '0.78rem',
    fontWeight: 600,
    color: '#e2e8f0',
    cursor: 'pointer',
    textAlign: 'left',
  };

  /** Menú ⋮ de las filas de la cola (diseño mockup). */
  const PlayingMenu: React.FC<{
    rowId: string;
    url: string;
    title: string;
    openUrl?: string;
    entryId?: string;
    canDelete: boolean;
    /** Solo la fila en reproducción ofrece Siguiente/Detener. */
    isCurrentlyPlaying: boolean;
  }> = ({ rowId, url, title: menuTitle, openUrl, entryId, canDelete, isCurrentlyPlaying }) => {
    void rowId;
    return (
      <div
        style={{
          position: 'absolute',
          right: '0.4rem',
          top: '2.7rem',
          zIndex: 30,
          minWidth: 190,
          background: '#1d2438',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 10,
          padding: '0.3rem',
          boxShadow: '0 10px 28px rgba(0, 0, 0, 0.55)',
        }}
      >
        {isModerator && (
          <>
            {url && <button
              type="button"
              onClick={() => {
                if (url) onExpandToMain(url, menuTitle);
                setOpenMenuId(null);
              }}
              style={menuItemStyle}
            >
              <Maximize2 size={13} /> Ampliar a la sala
            </button>}
            {isCurrentlyPlaying && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onNext();
                    setOpenMenuId(null);
                  }}
                  style={menuItemStyle}
                >
                  <SkipForward size={13} /> Siguiente
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onStop();
                    setOpenMenuId(null);
                  }}
                  style={{ ...menuItemStyle, color: '#f87171' }}
                >
                  <Square size={13} /> Detener
                </button>
              </>
            )}
          </>
        )}
        {openUrl && (
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpenMenuId(null)}
            style={{ ...menuItemStyle, textDecoration: 'none' }}
          >
            <ExternalLink size={13} /> Abrir en YouTube
          </a>
        )}
        {canDelete && entryId && (
          <button
            type="button"
            onClick={() => {
              onRemove(entryId);
              setOpenMenuId(null);
            }}
            style={{ ...menuItemStyle, color: '#f87171' }}
          >
            <Trash2 size={13} /> Eliminar
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="music-panel" aria-label="Música y Karaoke de YouTube"><div className="music-panel__content">
      {allowAdd && <YouTubeSearch provider={settings.youtubeProvider} onAdd={onAdd} onPlay={isModerator ? onExpandToMain : undefined} />}
      {/* Formulario para agregar canciones/karaokes de YouTube */}
      {allowAdd ? (
        <form onSubmit={handlePasteSubmit} className="room-settings__box music-panel__link-form" style={{ padding: '0.85rem', marginBottom: '1rem' }}>
          <div className="room-settings__box-head" style={{ marginBottom: '0.55rem' }}>
            <span className="room-settings__box-title" style={{ fontSize: '0.85rem' }}>
              <Plus size={15} style={{ color: '#ef4444' }} />
              Agregar video/música a la cola
            </span>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <input
              type="text"
              className="room-settings__input"
              placeholder="Pega enlace de YouTube (ej: https://youtu.be/...)"
              value={ytInput}
              onChange={(e) => {
                setYtInput(e.target.value);
                setInputError('');
              }}
              style={{ fontSize: '0.84rem', padding: '0.55rem 0.75rem' }}
            />
            
            <div style={{ display: 'flex', gap: '0.45rem' }}>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={!ytInput.trim() || addingYt}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.82rem',
                  padding: '0.5rem 0.9rem',
                  whiteSpace: 'nowrap',
                }}
              >
                <Plus size={15} />
                {addingYt ? 'Añadiendo...' : 'Añadir'}
              </button>
            </div>
          </div>

          {inputError && (
            <p style={{ color: '#f87171', fontSize: '0.76rem', marginTop: '0.45rem', marginBottom: 0 }}>
              ⚠️ {inputError}
            </p>
          )}
        </form>
      ) : (
        <p className="room-settings__box-desc" style={{ marginBottom: '0.75rem' }}>
          🔒 Solo los moderadores pueden proponer canciones a la cola.
        </p>
      )}

      {/* El reproductor "Sonando ahora" va debajo de la tarjeta de cola (diseño mockup). */}

      {/* Cola con temas pero nada sonando: cualquiera puede arrancar */}
      {!nowPlaying && active.length > 0 && (
        <button
          type="button"
          className="btn btn--primary music-panel__start"
          onClick={onNext}
          title="Empezar a reproducir la cola"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.45rem',
            width: 'auto',
            marginBottom: '0.5rem',
            padding: '0.35rem 0.7rem',
          }}
        >
          <Play size={16} />
          Reproducir ({active.length})
        </button>
      )}

      {/* Pendientes de aprobación (moderador) */}
      {isModerator && pending.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div className="room-settings__box-head" style={{ marginBottom: '0.45rem' }}>
            <span className="room-settings__box-title" style={{ fontSize: '0.82rem', color: '#fbbf24' }}>
              Pendientes de aprobación ({pending.length})
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {pending.map((e) => (
              <div
                key={e.id}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.55rem 0.75rem',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(251, 191, 36, 0.2)',
                  borderRadius: '10px',
                }}
              >
                {e.albumArt && (
                  <img src={e.albumArt} alt="" style={{ width: '40px', height: '30px', objectFit: 'cover', borderRadius: '4px' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.name}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8' }}>
                    por {e.proposedBy}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.74rem' }}
                  onClick={() => onApprove(e.id)}
                >
                  <Check size={14} /> Aprobar
                </button>
                <button
                  type="button"
                  className="music-row-options"
                  aria-label={`Opciones de ${e.name}`}
                  aria-expanded={openMenuId === e.id}
                  onClick={() => setOpenMenuId((v) => (v === e.id ? null : e.id))}
                >
                  <MoreVertical size={15} />
                </button>
                {openMenuId === e.id && (
                  <PlayingMenu
                    rowId={e.id}
                    url=""
                    title={e.name}
                    openUrl={e.openUrl}
                    entryId={e.id}
                    canDelete={canRemove(e)}
                    isCurrentlyPlaying={false}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tarjeta de la cola musical (diseño mockup) */}
      <details className="room-settings__box music-panel__queue" style={{ padding: '0.85rem', marginBottom: '1rem' }}>
        <summary style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', cursor: 'pointer' }}>
          <span style={{ fontSize: '0.86rem', fontWeight: 600, color: '#f1f5f9' }}>
            Cola de reproducción
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.74rem', color: '#64748b' }}>
            {active.length} vídeo{active.length === 1 ? '' : 's'}
            <ListMusic size={14} />
          </span>
        </summary>

        {active.length === 0 ? (
          <div className="drawer-chat__empty" style={{ padding: '1.5rem 1rem' }}>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.84rem' }}>
              La cola está vacía. ¡Pega el primer enlace de YouTube arriba!
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {/* Tema sonando fuera de la cola: fila compacta estilo mockup */}
            {active.map((e, i) => {
              const ytRef = parseYouTubeUrl(e.trackId || e.uri || e.openUrl);
              const thumb = e.albumArt || (ytRef ? `https://img.youtube.com/vi/${ytRef.videoId}/hqdefault.jpg` : undefined);
              const isPlayingNow = !!nowPlaying && nowPlaying.trackId === e.trackId;
              const rowDuration = typeof e.durationMs === 'number' && e.durationMs > 0
                ? formatPlayerTime(e.durationMs / 1000)
                : null;

              return (
                <div
                  key={e.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.6rem 0.75rem 0.6rem 0.9rem',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    borderRadius: '10px',
                    transition: 'border-color 0.15s ease',
                    position: 'relative',
                    borderColor: isPlayingNow ? 'rgba(139, 92, 246, 0.45)' : 'rgba(255, 255, 255, 0.07)',
                  }}
                >
                  {isPlayingNow && (
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 8,
                        bottom: 8,
                        width: 3,
                        borderRadius: 999,
                        background: '#8b5cf6',
                      }}
                    />
                  )}
                  {isPlayingNow && (
                    <span
                      role="img"
                      aria-label="Sonando ahora"
                      style={{ color: '#60a5fa', display: 'flex', flexShrink: 0 }}
                    >
                      <Pause size={13} />
                    </span>
                  )}
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      style={{ width: '42px', height: '32px', objectFit: 'cover', borderRadius: '5px', flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '42px',
                        height: '32px',
                        borderRadius: '5px',
                        background: 'rgba(239, 68, 68, 0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ef4444',
                        flexShrink: 0,
                      }}
                    >
                      <Youtube size={18} />
                    </div>
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '0.84rem', fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.name}
                    </p>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.artists || 'YouTube Music'} · propuesto por {e.proposedBy}
                    </p>
                  </div>

                  {rowDuration && (
                    <span style={{ fontSize: '0.74rem', color: '#94a3b8', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {rowDuration}
                    </span>
                  )}

                  {!isPlayingNow && canRemove(e) && (
                    <button
                      type="button"
                      className="leader-exit-modal__cancel-btn"
                      style={{ width: 'auto', margin: 0, padding: '0.28rem 0.5rem', color: '#f87171' }}
                      aria-label={`Eliminar ${e.name}`}
                      onClick={() => onRemove(e.id)}
                      title="Eliminar de la cola"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Opciones de ${e.name}`}
                    title="Opciones"
                    onClick={() => setOpenMenuId((v) => (v === e.id ? null : e.id))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'transparent',
                      color: '#94a3b8',
                      border: 'none',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <MoreVertical size={15} />
                  </button>
                  {openMenuId === e.id && (
                    <PlayingMenu
                      rowId={e.id}
                      url={e.openUrl || e.uri || (ytRef ? `https://www.youtube.com/watch?v=${ytRef.videoId}` : '')}
                      title={e.name}
                      openUrl={e.openUrl}
                      entryId={e.id}
                      canDelete={canRemove(e)}
                      isCurrentlyPlaying={isPlayingNow}
                    />
                  )}

                  {!isPlayingNow && isModerator && settings.musicAllowReorder === true && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <button
                        type="button"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: i === 0 ? '#475569' : '#94a3b8',
                          cursor: i === 0 ? 'default' : 'pointer',
                          padding: '1px',
                          display: 'flex',
                        }}
                        disabled={i === 0}
                        onClick={() => moveEntry(queue.indexOf(e), -1)}
                        title="Subir posición"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: i === active.length - 1 ? '#475569' : '#94a3b8',
                          cursor: i === active.length - 1 ? 'default' : 'pointer',
                          padding: '1px',
                          display: 'flex',
                        }}
                        disabled={i === active.length - 1}
                        onClick={() => moveEntry(queue.indexOf(e), 1)}
                        title="Bajar posición"
                      >
                        <ArrowDown size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </details>
      </div>

      {/* Reproductor "Sonando ahora" debajo de la tarjeta (diseño mockup) */}
      {nowPlaying && nowVideoId ? (
        <div
          className="room-settings__box music-panel__footer"
          style={{
            marginBottom: '1rem',
            padding: '0.85rem',
            border: '1px solid rgba(139, 92, 246, 0.22)',
            background: 'rgba(15, 20, 35, 0.55)',
          }}
        >
          <NowPlayingPlayer
            trackKey={`${nowPlaying.entryId || nowVideoId}-${nowVideoId}`}
            videoId={nowVideoId}
            title={nowPlaying.name}
            subtitle={`${nowPlaying.artists || 'YouTube Music'} · propuesto por ${nowPlaying.proposedBy}`}
            thumb={nowPlaying.albumArt || `https://img.youtube.com/vi/${nowVideoId}/hqdefault.jpg`}
            onEnded={onAutoNext}
            onNext={onNext}
            onStop={onStop}
            onExpand={(currentTime) => {
              const url = nowPlaying.openUrl || nowPlaying.uri || `https://www.youtube.com/watch?v=${nowVideoId}`;
              if (url) onExpandToMain(url, nowPlaying.name, currentTime);
            }}
            showModerator={isModerator}
          />
        </div>
      ) : null}

    </div>
  );
};

export default MusicPanel;
