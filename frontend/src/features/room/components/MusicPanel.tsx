import { Button, Field, Surface, Popover, AccordionTrigger } from '../../../shared/components/ui';
import React, { useState, useRef } from 'react';
import { Youtube, Plus, Trash2, ArrowUp, ArrowDown, Check, Disc, Play, Pause, SkipForward, Maximize2, ListMusic, MoreVertical, ExternalLink, Square, ChevronDown } from 'lucide-react';
import type { IMusicNowPlaying, IMusicQueueEntry, IMusicTrack, IRoomSettings, MusicSearchState } from '../../../types/room';
import { parseYouTubeUrl } from '../../../shared/youtube';
import { formatPlayerTime, NowPlayingPlayer } from './NowPlayingPlayer';
import { YouTubeSearch } from './YouTubeSearch';

export interface MusicPanelProps {
  sharedSearch?: MusicSearchState;
  onShareSearch?: (search: MusicSearchState) => void;
  onPlayback?: (entryId: string, currentTime: number, playing: boolean) => void;
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
  sharedSearch, onShareSearch,
  onPlayback,
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
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [queueCollapsed, setQueueCollapsed] = useState(false);

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
        await onAddUrl(raw);
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
      setInputError('');
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
  const matchedPlaying = nowPlaying
    ? active.find((e) => e.trackId && e.trackId === nowPlaying.trackId)
    : undefined;

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
      <Popover anchor={menuAnchor.current} className="music-queue__menu" onDismiss={() => setOpenMenuId(null)} aria-label="Opciones de la canción">
        {isModerator && (
          <>
            {url && <Button variant="unstyled"
              type="button"
              onClick={() => {
                if (url) onExpandToMain(url, menuTitle);
                setOpenMenuId(null);
              }}
              style={menuItemStyle}
            >
              <Maximize2 size={13} /> Ampliar a la sala
            </Button>}
            {isCurrentlyPlaying && (
              <>
                <Button variant="unstyled"
                  type="button"
                  onClick={() => {
                    onNext();
                    setOpenMenuId(null);
                  }}
                  style={menuItemStyle}
                >
                  <SkipForward size={13} /> Siguiente
                </Button>
                <Button variant="unstyled"
                  type="button"
                  onClick={() => {
                    onStop();
                    setOpenMenuId(null);
                  }}
                  style={{ ...menuItemStyle, color: '#f87171' }}
                >
                  <Square size={13} /> Detener
                </Button>
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
          <Button variant="unstyled"
            type="button"
            onClick={() => {
              onRemove(entryId);
              setOpenMenuId(null);
            }}
            style={{ ...menuItemStyle, color: '#f87171' }}
          >
            <Trash2 size={13} /> Eliminar
          </Button>
        )}
      </Popover>
    );
  };

  return (
    <div className="music-panel" aria-label="Música y Karaoke de YouTube">
      <div className="music-panel__content">
      {allowAdd && <YouTubeSearch sharedSearch={sharedSearch} onShareSearch={onShareSearch} onAdd={onAdd} onPlay={isModerator ? onExpandToMain : undefined} />}
      {/* Formulario para agregar canciones/karaokes de YouTube */}
      {allowAdd ? (
        <form onSubmit={handlePasteSubmit} className="room-settings__box" style={{ padding: '0.85rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.45rem' }}>
            <Field
              type="text"
              className="room-settings__input"
              placeholder="Pega enlace de YouTube (ej: https://youtu.be/...)"
              value={ytInput}
              onChange={(e) => {
                setYtInput(e.target.value);
                setInputError('');
              }}
              style={{ flex: 1, fontSize: '0.84rem', padding: '0.55rem 0.75rem' }}
            />
            <Button variant="primary"
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
            </Button>
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
                <Button variant="primary"
                  type="button"
                  className="btn btn--primary"
                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.74rem' }}
                  onClick={() => onApprove(e.id)}
                >
                  <Check size={14} /> Aprobar
                </Button>
                <Button variant="unstyled"
                  type="button"
                  className="music-row-options"
                  aria-label={`Opciones de ${e.name}`}
                  aria-expanded={openMenuId === e.id}
                  onClick={(event) => { menuAnchor.current = event.currentTarget; setOpenMenuId((v) => (v === e.id ? null : e.id)); }}
                >
                  <MoreVertical size={15} />
                </Button>
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

      {/* Tarjeta de la cola musical (desplegable) */}
      <Surface className="room-settings__box music-queue">
        <AccordionTrigger expanded={!queueCollapsed} controls="music-queue-entries" className="music-queue__toggle" onClick={() => setQueueCollapsed(v => !v)}>
          <ListMusic size={18} /><span>Cola de reproducción</span><span className="music-queue__count">{active.length} vídeo{active.length === 1 ? '' : 's'}</span><ChevronDown size={16} style={{ transform: queueCollapsed ? undefined : 'rotate(180deg)' }} />
        </AccordionTrigger>
        {!queueCollapsed && (
          <div id="music-queue-entries" style={{ display: active.length === 0 ? 'flex' : 'block' }}>
            {active.length === 0 ? (
              <div className="drawer-chat__empty" style={{ padding: '1.5rem 1rem' }}>
                <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.84rem' }}>
                  La cola está vacía. ¡Pega el primer enlace de YouTube arriba!
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {/* Tema sonando fuera de la cola: fila compacta estilo mockup */}
                {nowPlaying && !matchedPlaying && nowVideoId ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      padding: '0.6rem 0.75rem 0.6rem 0.9rem',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(139, 92, 246, 0.45)',
                      borderRadius: '10px',
                      position: 'relative',
                    }}
                  >
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
                    <span role="img" aria-label="Sonando ahora" style={{ color: '#60a5fa', display: 'flex', flexShrink: 0 }}>
                      <Pause size={13} />
                    </span>
                    <img
                      src={nowPlaying.albumArt || `https://img.youtube.com/vi/${nowVideoId}/hqdefault.jpg`}
                      alt=""
                      style={{ width: '42px', height: '32px', objectFit: 'cover', borderRadius: '5px', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: '0.84rem', fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {nowPlaying.name}
                      </p>
                      <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {nowPlaying.artists || 'YouTube Music'} · propuesto por {nowPlaying.proposedBy}
                      </p>
                    </div>
                    <Button variant="unstyled"
                      type="button"
                      aria-label={`Opciones de ${nowPlaying.name}`}
                      title="Opciones"
                      onClick={(event) => { menuAnchor.current = event.currentTarget; setOpenMenuId((v) => (v === `now-${nowPlaying.entryId}` ? null : `now-${nowPlaying.entryId}`)); }}
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
                    </Button>
                    {openMenuId === `now-${nowPlaying.entryId}` && (
                      <PlayingMenu
                        rowId={`now-${nowPlaying.entryId}`}
                        url={nowPlaying.openUrl || nowPlaying.uri || `https://www.youtube.com/watch?v=${nowVideoId}`}
                        title={nowPlaying.name}
                        openUrl={nowPlaying.openUrl}
                        entryId={nowPlaying.entryId}
                        canDelete={isModerator || (settings.musicCanRemove !== 'moderator' && nowPlaying.proposedBy === myName)}
                        isCurrentlyPlaying
                      />
                    )}
                  </div>
                ) : null}
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
                      <Button variant="unstyled"
                        type="button"
                        aria-label={`Opciones de ${e.name}`}
                        title="Opciones"
                        onClick={(event) => { menuAnchor.current = event.currentTarget; setOpenMenuId((v) => (v === e.id ? null : e.id)); }}
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
                      </Button>
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
                          <Button variant="unstyled"
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
                          </Button>
                          <Button variant="unstyled"
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
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Surface>

      </div>
      <Surface className="room-settings__box music-panel__footer">
        {nowPlaying && nowVideoId ? <NowPlayingPlayer
          playback={nowPlaying.playback} startedAt={nowPlaying.startedAt}
          onPlayback={(currentTime, playing) => onPlayback?.(nowPlaying.entryId, currentTime, playing)}
          trackKey={`${nowPlaying.entryId || nowVideoId}-${nowVideoId}`}
          videoId={nowVideoId} title={nowPlaying.name}
          subtitle={`${nowPlaying.artists || 'YouTube Music'} · propuesto por ${nowPlaying.proposedBy}`}
          thumb={nowPlaying.albumArt || `https://img.youtube.com/vi/${nowVideoId}/hqdefault.jpg`}
          onEnded={onAutoNext} onNext={onNext} onStop={onStop}
          onExpand={(currentTime) => onExpandToMain(nowPlaying.openUrl || nowPlaying.uri || `https://www.youtube.com/watch?v=${nowVideoId}`, nowPlaying.name, currentTime)}
          showModerator={isModerator}
        /> : <div className="music-player-empty">
          <div className="music-player-empty__art" aria-hidden="true"><Disc size={28} /></div>
          <div className="music-player-empty__info"><strong>Sin reproducción</strong><span>Añade una canción para empezar</span></div>
          <Button variant="unstyled" type="button" className="music-player-empty__play" aria-label="Reproducir cola" disabled={!isModerator || active.length === 0} onClick={onNext}><Play size={20} /></Button>
        </div>}
      </Surface>
    </div>
  );
};

export default MusicPanel;
