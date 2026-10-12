import React, { useState } from 'react';
import { Youtube, Plus, Trash2, ArrowUp, ArrowDown, Check, Disc, Volume2, Sparkles } from 'lucide-react';
import type { IMusicNowPlaying, IMusicQueueEntry, IMusicTrack, IRoomSettings } from '../../../types/room';
import { parseYouTubeUrl } from '../../../shared/youtube';

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
  onVote: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onApprove: (id: string) => void;
  onNext: () => void;
  onStop: () => void;
}

function hasVoted(entry: { votes: string[] }, myName: string, userId?: string): boolean {
  if (userId && entry.votes.includes(userId)) return true;
  return entry.votes.includes(myName);
}

export const MusicPanel: React.FC<MusicPanelProps> = ({
  queue,
  nowPlaying,
  settings,
  isModerator,
  myName,
  userId,
  onAddUrl,
  onAdd,
  onVote,
  onRemove,
  onReorder,
  onApprove,
  onNext,
  onStop,
}) => {
  const [ytInput, setYtInput] = useState('');
  const [addingYt, setAddingYt] = useState(false);
  const [inputError, setInputError] = useState('');
  const [customTitle, setCustomTitle] = useState('');

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
        const title = customTitle.trim() || `YouTube Music (${ytRef.videoId})`;
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
      setCustomTitle('');
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

  return (
    <div className="drawer-chat__messages" aria-label="Música y Karaoke de YouTube" style={{ padding: '0.85rem' }}>
      {/* Banner Principal de YouTube Karaoke */}
      <div className="room-settings__hero-banner" style={{ marginBottom: '1rem', padding: '1rem' }}>
        <div className="room-settings__hero-icon" style={{ background: 'rgba(239, 68, 68, 0.25)', color: '#ef4444' }}>
          <Youtube size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <h4 className="room-settings__hero-title" style={{ fontSize: '0.92rem', marginBottom: '0.2rem' }}>
            <span>Cola Musical con YouTube</span>
            <span className="room-settings__hero-badge">Audio Compartido</span>
          </h4>
          <p className="room-settings__hero-desc" style={{ fontSize: '0.78rem' }}>
            Pega enlaces de canciones o karaokes de YouTube. Todos escuchan sincronizados sin necesidad de Spotify ni cuentas de pago.
          </p>
        </div>
      </div>

      {/* Formulario para agregar canciones/karaokes de YouTube */}
      {allowAdd ? (
        <form onSubmit={handlePasteSubmit} className="room-settings__box" style={{ padding: '0.85rem', marginBottom: '1rem' }}>
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
              <input
                type="text"
                className="room-settings__input"
                placeholder="Título opcional (ej: Bohemian Rhapsody)"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                style={{ flex: 1, fontSize: '0.82rem', padding: '0.5rem 0.7rem' }}
              />
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
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  border: 'none',
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

      {/* Lo que suena ahora */}
      {nowPlaying ? (
        <div
          className="room-settings__box"
          style={{
            marginBottom: '1rem',
            padding: '0.85rem',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(15, 23, 42, 0.6) 100%)',
          }}
        >
          <div className="room-settings__box-head" style={{ marginBottom: '0.45rem' }}>
            <span className="room-settings__box-title" style={{ color: '#ef4444', fontSize: '0.85rem' }}>
              <Volume2 size={16} />
              Sonando ahora
            </span>
            {isModerator && (
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                <button
                  type="button"
                  className="leader-exit-modal__cancel-btn"
                  style={{ width: 'auto', margin: 0, padding: '0.25rem 0.6rem', fontSize: '0.74rem' }}
                  onClick={onNext}
                  title="Pasar al siguiente tema"
                >
                  Siguiente
                </button>
                <button
                  type="button"
                  className="leader-exit-modal__cancel-btn"
                  style={{ width: 'auto', margin: 0, padding: '0.25rem 0.6rem', fontSize: '0.74rem', color: '#f87171' }}
                  onClick={onStop}
                  title="Detener música"
                >
                  Detener
                </button>
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {nowPlaying.albumArt ? (
              <img
                src={nowPlaying.albumArt}
                alt=""
                style={{ width: '48px', height: '36px', objectFit: 'cover', borderRadius: '6px' }}
              />
            ) : (
              <div
                style={{
                  width: '48px',
                  height: '36px',
                  borderRadius: '6px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ef4444',
                }}
              >
                <Youtube size={20} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '0.88rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nowPlaying.name}
              </p>
              <p style={{ margin: 0, fontSize: '0.76rem', color: '#94a3b8' }}>
                {nowPlaying.artists || 'YouTube'} · <span>propuesto por {nowPlaying.proposedBy}</span>
              </p>
            </div>
            {nowPlaying.openUrl && (
              <a
                href={nowPlaying.openUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#ef4444', fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none' }}
              >
                Abrir ↗
              </a>
            )}
          </div>
        </div>
      ) : null}

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
                {canRemove(e) && (
                  <button
                    type="button"
                    className="leader-exit-modal__cancel-btn"
                    style={{ width: 'auto', margin: 0, padding: '0.3rem 0.5rem', color: '#f87171' }}
                    onClick={() => onRemove(e.id)}
                    title="Rechazar"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista de la cola musical */}
      <div>
        <div className="room-settings__box-head" style={{ marginBottom: '0.55rem' }}>
          <span className="room-settings__box-title" style={{ fontSize: '0.84rem' }}>
            <Sparkles size={15} style={{ color: '#818cf8' }} />
            Cola de reproducción ({active.length})
          </span>
        </div>

        {active.length === 0 ? (
          <div className="drawer-chat__empty" style={{ padding: '1.5rem 1rem' }}>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.84rem' }}>
              La cola está vacía. ¡Pega el primer enlace de YouTube arriba!
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {active.map((e, i) => {
              const voted = hasVoted(e, myName, userId);
              const ytRef = parseYouTubeUrl(e.trackId || e.uri || e.openUrl);
              const thumb = e.albumArt || (ytRef ? `https://img.youtube.com/vi/${ytRef.videoId}/hqdefault.jpg` : undefined);

              return (
                <div
                  key={e.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    padding: '0.55rem 0.75rem',
                    background: 'rgba(255, 255, 255, 0.035)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    borderRadius: '10px',
                    transition: 'border-color 0.15s ease',
                  }}
                >
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
                    <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8' }}>
                      {e.artists || 'YouTube'} · por {e.proposedBy}
                      {e.votes.length > 0 && ` · ${e.votes.length} voto${e.votes.length === 1 ? '' : 's'}`}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="btn btn--primary"
                    style={{
                      padding: '0.28rem 0.65rem',
                      fontSize: '0.72rem',
                      background: voted ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                      borderColor: voted ? '#6366f1' : 'rgba(255, 255, 255, 0.15)',
                      color: voted ? '#fff' : '#cbd5e1',
                    }}
                    onClick={() => onVote(e.id)}
                    title={voted ? 'Retirar voto' : 'Votar canción'}
                  >
                    {voted ? '✓ Votado' : 'Votar'}
                  </button>

                  {canRemove(e) && (
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

                  {isModerator && settings.musicAllowReorder === true && (
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
      </div>

      <p className="room-settings__box-desc" style={{ marginTop: '1.25rem', textAlign: 'center', fontSize: '0.74rem' }}>
        🎵 La cola reproduce canciones de YouTube en grupo. Disfruta con letras sincronizadas y sin límites.
      </p>
    </div>
  );
};

export default MusicPanel;
