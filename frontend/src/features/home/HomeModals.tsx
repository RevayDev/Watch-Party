import React from 'react';
import { Loader2 } from 'lucide-react';
import { BottomSheet } from '../../shared/components/BottomSheet';
import { TimelineEvent } from './homeData';

export interface CreateRoomModalProps {
  open: boolean;
  onClose: () => void;
  hostName: string;
  setHostName: (v: string) => void;
  isTemporary: boolean;
  setIsTemporary: (v: boolean) => void;
  loading: boolean;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
}

/** Modal crear sala (JSX movido verbatim desde Home.tsx). */
export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({
  open,
  onClose,
  hostName,
  setHostName,
  isTemporary,
  setIsTemporary,
  loading,
  error,
  onSubmit,
}) => {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label="Crear una nueva sala"
      className="host-exit-modal"
    >
      <div className="modal-card__header">
        <h3 className="host-exit-modal__title">Crear una nueva sala</h3>
      </div>

      <p className="host-exit-modal__desc">
        Tú serás el anfitrión (Host) y tendrás el control inicial de la
        sincronización del video y los controles de reproducción.
      </p>

      {error && (
        <div
          style={{
            color: '#f87171',
            fontSize: '0.85rem',
            marginBottom: '1rem',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            padding: '0.65rem 0.85rem',
            borderRadius: '10px',
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={onSubmit}>
        <div className="form-group" style={{ marginBottom: '1rem' }}>
          <label
            className="form-group__label"
            style={{ color: '#cbd5e1', fontWeight: 600 }}
          >
            Tu nombre como Anfitrión
          </label>
          <input
            type="text"
            className="form-group__input"
            placeholder="Ej. Roberto"
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
            disabled={loading}
            autoFocus
            required
          />
        </div>

        {/* Modo de sala: Temporal vs Guardar Video */}
        <div
          className="form-group"
          style={{
            marginBottom: '1.25rem',
            background: 'rgba(255, 255, 255, 0.04)',
            padding: '0.85rem',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.4rem',
            }}
          >
            <span
              style={{
                fontSize: '0.88rem',
                fontWeight: 600,
                color: '#f3f4f6',
              }}
            >
              {isTemporary ? '⚡ Sala Temporal' : '💾 Sala Persistente'}
            </span>
            <label className="part-switch" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={isTemporary}
                onChange={(e) => setIsTemporary(e.target.checked)}
              />
              <span className="part-slider" />
            </label>
          </div>
          <p
            style={{
              fontSize: '0.78rem',
              color: '#9ca3af',
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            {isTemporary
              ? 'Al cerrar la sala se borra el video y la sala automáticamente (ideal para videos pesados o funciones rápidas).'
              : 'El video se conserva subido en el servidor para futuras sesiones.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={onClose}
            className="host-exit-modal__cancel-btn"
            style={{ marginTop: 0, flex: 1 }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={loading}
            style={{
              flex: 1.4,
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
            }}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Creando...
              </>
            ) : (
              'Iniciar sala'
            )}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
};

export interface JoinRoomModalProps {
  open: boolean;
  onClose: () => void;
  roomCode: string;
  setRoomCode: (v: string) => void;
  userName: string;
  setUserName: (v: string) => void;
  error: string;
  isUrlInvite: boolean;
  setIsUrlInvite: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
}

/** Modal unirse a sala (JSX movido verbatim desde Home.tsx). */
export const JoinRoomModal: React.FC<JoinRoomModalProps> = ({
  open,
  onClose,
  roomCode,
  setRoomCode,
  userName,
  setUserName,
  error,
  isUrlInvite,
  setIsUrlInvite,
  onSubmit,
}) => {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label="Unirse a una sala"
      className="host-exit-modal"
    >
      <div className="modal-card__header">
        <h3 className="host-exit-modal__title">
          {isUrlInvite && roomCode
            ? `Unirse a la sala ${roomCode}`
            : 'Unirse a una sala'}
        </h3>
      </div>

      <p className="host-exit-modal__desc">
        {isUrlInvite && roomCode
          ? `Ingresa tu nombre de usuario para unirte de inmediato a la sala ${roomCode}.`
          : 'Ingresa tu nombre y el código de 6 u 8 caracteres que te compartió el anfitrión.'}
      </p>

      {error && (
        <div
          style={{
            color: '#f87171',
            fontSize: '0.85rem',
            marginBottom: '1rem',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            padding: '0.65rem 0.85rem',
            borderRadius: '10px',
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={onSubmit}>
        <div
          className="form-group"
          style={{
            marginBottom: isUrlInvite && roomCode ? '0.4rem' : '0.85rem',
          }}
        >
          <label
            className="form-group__label"
            style={{ color: '#cbd5e1', fontWeight: 600 }}
          >
            Tu nombre de usuario
          </label>
          <input
            type="text"
            className="form-group__input"
            placeholder="Ej. Roberto"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            autoFocus
            required
          />
        </div>

        {(!isUrlInvite || !roomCode) && (
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label
              className="form-group__label"
              style={{ color: '#cbd5e1', fontWeight: 600 }}
            >
              Código de sala
            </label>
            <input
              type="text"
              className="form-group__input"
              placeholder="Ej. 8FK29X"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              maxLength={8}
              style={{
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 700,
              }}
              required
            />
          </div>
        )}

        {isUrlInvite && roomCode && (
          <div style={{ marginBottom: '1rem', textAlign: 'right' }}>
            <button
              type="button"
              onClick={() => {
                setIsUrlInvite(false);
                setRoomCode('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-primary-light)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Usar otro código de sala
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={onClose}
            className="host-exit-modal__cancel-btn"
            style={{ marginTop: 0, flex: 1 }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            style={{
              flex: 1.4,
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
            }}
          >
            Entrar a la sala
          </button>
        </div>
      </form>
    </BottomSheet>
  );
};

export interface TimelineModalProps {
  open: boolean;
  event: TimelineEvent;
  onClose: () => void;
}

/** Modal detalle de hito (JSX movido verbatim desde Home.tsx). */
export const TimelineModal: React.FC<TimelineModalProps> = ({
  open,
  event,
  onClose,
}) => {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label={`Detalle: ${event.title}`}
      className="timeline-modal"
    >
      <div className="timeline-modal__meta">
        <span className="home-timeline__date">{event.date}</span>
        <span className={`home-status home-status--${event.tone}`}>
          {event.status}
        </span>
      </div>
      <h3 className="timeline-modal__title">{event.title}</h3>
      <p className="timeline-modal__desc">{event.desc}</p>
      <button
        type="button"
        className="btn btn--primary timeline-modal__action"
        onClick={onClose}
        autoFocus
      >
        Entendido
      </button>
    </BottomSheet>
  );
};
