import React from 'react';
import { Activity, ArrowLeft, Cpu, Database, Radio, Users } from 'lucide-react';
import { Sparkline } from './Sparkline';
import { usePublicStatus } from './usePublicStatus';
import { formatUptime } from './types';

interface StatusPageProps {
  onBack: () => void;
}

/**
 * Ruta pública `/status`: agregados del backend en vivo (SSE + fallback),
 * SIN token y SIN PII. Métricas finas (CPU/RAM/tráfico) viven solo en /admin.
 */
export const StatusPage: React.FC<StatusPageProps> = ({ onBack }) => {
  const { health, status, usersHistory, roomsHistory, connectionsHistory, lastUpdated, source, error } =
    usePublicStatus();

  const loading = status === null && error === null;
  const liveRooms = health?.rooms ?? status?.activeRooms ?? null;

  return (
    <div className="status-page" data-testid="status-page">
      <nav className="home-nav" aria-label="Navegación de estado">
        <div className="home-nav__inner">
          <span className="home-nav__brand">
            <span className="home-nav__logo" aria-hidden="true">
              <Activity size={17} />
            </span>
            Estado del servicio
          </span>
          <div className="home-nav__actions">
            <button type="button" className="home-nav__btn home-nav__btn--ghost" onClick={onBack}>
              <ArrowLeft size={15} aria-hidden="true" /> Volver al inicio
            </button>
          </div>
        </div>
      </nav>

      <div className="status-page__inner">
        <div className="status-page__head">
          <p className="status-page__eyebrow">Tiempo real · datos agregados</p>
          <h1 className="status-page__title">Estado del servicio</h1>
          <div className="status-page__meta">
            <span
              className={`status-dot status-dot--${status ? status.status : 'unknown'}`}
              data-testid="status-source"
              role="status"
            >
              <span className="status-dot__pulse" aria-hidden="true" />
              {status ? (status.status === 'online' ? 'En línea' : 'Degradado') : 'Conectando…'}
            </span>
            {source && (
              <span className="status-page__source">
                {source === 'sse' ? 'En vivo (SSE)' : 'Actualizado cada 12 s'}
              </span>
            )}
            {lastUpdated && (
              <span className="status-page__updated">
                Última actualización: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
          {error && (
            <p className="status-page__error" role="alert">
              {error}
            </p>
          )}
          {loading && <p className="status-page__loading">Cargando estado…</p>}
        </div>

        {/* ── Estado general ── */}
        <section className="status-grid" aria-label="Estado general">
          <article className="status-card">
            <header className="status-card__head">
              <Radio size={18} aria-hidden="true" />
              <h2>Backend</h2>
            </header>
            <p className="status-card__value" data-testid="status-backend">
              {health ? (health.status === 'ok' ? 'Operativo' : 'Degradado') : '—'}
            </p>
            <p className="status-card__sub">{health?.service ?? 'watch-party-backend'}</p>
          </article>

          <article className="status-card">
            <header className="status-card__head">
              <Database size={18} aria-hidden="true" />
              <h2>Base de datos</h2>
            </header>
            <p className="status-card__value" data-testid="status-database">
              {health ? health.database : '—'}
            </p>
            <p className="status-card__sub">Fallback en memoria soportado</p>
          </article>

          <article className="status-card">
            <header className="status-card__head">
              <Activity size={18} aria-hidden="true" />
              <h2>WebSocket</h2>
            </header>
            <p className="status-card__value">{health ? health.websocket : '—'}</p>
            <p className="status-card__sub" data-testid="status-connections">
              {health ? `${health.connections} conexiones` : '—'}
            </p>
          </article>

          <article className="status-card">
            <header className="status-card__head">
              <Users size={18} aria-hidden="true" />
              <h2>Salas vivas</h2>
            </header>
            <p className="status-card__value" data-testid="status-rooms">
              {liveRooms === null || liveRooms === undefined ? '—' : liveRooms}
            </p>
            <p className="status-card__sub">
              Uptime: {status ? formatUptime(status.uptime) : '—'}
            </p>
          </article>
        </section>

        {/* ── Usuarios y salas ── */}
        <section className="status-grid status-grid--charts" aria-label="Usuarios y salas">
          <article className="status-card status-card--wide">
            <header className="status-card__head">
              <Users size={18} aria-hidden="true" />
              <h2>Usuarios</h2>
            </header>
            <div className="status-card__stats">
              <div>
                <span className="status-card__stat-value" data-testid="status-connected-users">
                  {status?.connectedUsers ?? '—'}
                </span>
                <span className="status-card__stat-label">conectados</span>
              </div>
              <div>
                <span className="status-card__stat-value">{status?.peakUsers ?? '—'}</span>
                <span className="status-card__stat-label">pico</span>
              </div>
              <div>
                <span className="status-card__stat-value">{status?.activeRooms ?? '—'}</span>
                <span className="status-card__stat-label">salas activas</span>
              </div>
            </div>
            <Sparkline data={usersHistory} label="Usuarios conectados" stroke="#818cf8" />
          </article>

          <article className="status-card status-card--wide">
            <header className="status-card__head">
              <Radio size={18} aria-hidden="true" />
              <h2>Salas</h2>
            </header>
            <div className="status-card__stats">
              <div>
                <span className="status-card__stat-value">{status?.avgUsersPerRoom ?? '—'}</span>
                <span className="status-card__stat-label">promedio/sala</span>
              </div>
              <div>
                <span className="status-card__stat-value">{status?.maxUsersPerRoom ?? '—'}</span>
                <span className="status-card__stat-label">máx/sala</span>
              </div>
              <div>
                <span className="status-card__stat-value">
                  {status ? `${status.freeRooms}/${status.premiumRooms}` : '—'}
                </span>
                <span className="status-card__stat-label">gratuitas/premium</span>
              </div>
            </div>
            <Sparkline data={roomsHistory} label="Salas activas" stroke="#34d399" />
          </article>

          <article className="status-card status-card--wide">
            <header className="status-card__head">
              <Activity size={18} aria-hidden="true" />
              <h2>Conexiones WS</h2>
            </header>
            <div className="status-card__stats">
              <div>
                <span className="status-card__stat-value">{health?.connections ?? '—'}</span>
                <span className="status-card__stat-label">activas</span>
              </div>
            </div>
            <Sparkline data={connectionsHistory} label="Conexiones WebSocket" stroke="#f472b6" />
          </article>
        </section>

        {/* ── Nota honesta: lo fino vive en /admin ── */}
        <aside className="status-note" aria-label="Métricas detalladas">
          <Cpu size={16} aria-hidden="true" />
          <p>
            CPU, RAM, peticiones/min, latencia y errores detallados solo se exponen en el panel de
            administración. Esta página pública muestra únicamente agregados sin datos personales.
          </p>
        </aside>
      </div>
    </div>
  );
};

export default StatusPage;
