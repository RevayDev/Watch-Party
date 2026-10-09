import React from 'react';
import { History, Crown, User } from 'lucide-react';
import { RecentRoom } from '../../services/recentRooms';
import { formatRelativeTime } from '../../shared/utils';

export interface RecentRoomsProps {
  recentRooms: RecentRoom[];
  onEnter: (room: RecentRoom) => void;
  onRemove: (roomId: string) => void;
}

/** Tarjeta de salas recientes (JSX movido verbatim desde Home.tsx). */
export const RecentRooms: React.FC<RecentRoomsProps> = ({
  recentRooms,
  onEnter,
  onRemove,
}) => {
  return (
    <div className="home-recent-card">
      <div className="home-recent-card__header">
        <span className="home-recent-card__title">
          <History size={15} strokeWidth={2.2} />
          Salas recientes
        </span>
        <span className="home-recent-card__hint">
          {recentRooms.length > 0
            ? 'Entra de nuevo con un clic'
            : 'Todavía sin historial'}
        </span>
      </div>

      {recentRooms.length === 0 ? (
        <div className="home-recent-empty">
          <span className="home-recent-empty__icon" aria-hidden="true">
            <History size={20} strokeWidth={1.8} />
          </span>
          <p className="home-recent-empty__title">No hay salas recientes</p>
          <p className="home-recent-empty__desc">
            Crea una sala o únete con un código: aparecerá aquí para entrar
            con un clic.
          </p>
        </div>
      ) : (
        <ul className="home-recent-list">
          {recentRooms.map((room) => (
            <li key={room.roomId} className="home-recent-item">
              <span
                className={`home-recent-item__avatar home-recent-item__avatar--${room.role}`}
                aria-hidden="true"
              >
                {(room.leaderName || '?').trim().charAt(0).toUpperCase()}
              </span>
              <div className="home-recent-item__info">
                <div className="home-recent-item__top">
                  <span className="home-recent-item__code">
                    {room.roomId}
                  </span>
                  <span
                    className={`home-recent-item__role home-recent-item__role--${room.role}`}
                  >
                    {room.role === 'leader' ? (
                      <Crown size={11} strokeWidth={2.4} />
                    ) : (
                      <User size={11} strokeWidth={2.4} />
                    )}
                    {room.role === 'leader' ? 'Anfitrión' : 'Invitado'}
                  </span>
                </div>
                {room.roomName?.trim() && (
                  <span
                    className="home-recent-item__room"
                    title={
                      room.roomDescription?.trim()
                        ? `${room.roomName.trim()} — ${room.roomDescription.trim()}`
                        : room.roomName.trim()
                    }
                  >
                    {room.roomName.trim()}
                    {room.roomDescription?.trim()
                      ? ` — ${room.roomDescription.trim()}`
                      : ''}
                  </span>
                )}
                <span className="home-recent-item__meta">
                  {room.leaderName} · {formatRelativeTime(room.lastJoined)}
                </span>
              </div>
              <div className="home-recent-item__actions">
                <button
                  type="button"
                  className="home-recent-item__enter-btn"
                  onClick={() => onEnter(room)}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  className="home-recent-item__remove-btn"
                  title="Quitar de la lista"
                  aria-label={`Quitar la sala ${room.roomId} de la lista`}
                  onClick={() => onRemove(room.roomId)}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
