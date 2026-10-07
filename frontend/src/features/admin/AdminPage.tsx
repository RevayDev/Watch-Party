import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BadgeDollarSign,
  Gift,
  LayoutDashboard,
  LogOut,
  Receipt,
  ScrollText,
  Server,
  Ticket,
  Users,
} from 'lucide-react';
import {
  adminErrorMessage,
  createGiftCode,
  deleteGiftCode,
  disableGiftCode,
  fetchAudit,
  fetchGiftCodes,
  fetchMetrics,
  fetchPayments,
  fetchRoomDetail,
  fetchRooms,
  fetchSummary,
  refundPayment,
} from './adminApi';
import {
  bucketizeRevenue,
  formatDateTime,
  formatMoney,
  REVENUE_RANGE_LABELS,
  summarizeRevenue,
  type RevenueRange,
} from './adminUtils';
import { AdminBarChart, AdminLineChart } from './AdminCharts';
import type {
  AdminMetrics,
  AdminSummary,
  AuditRecord,
  GiftCodeRecord,
  PaymentRecord,
  SanitizedRoom,
} from './types';

interface AdminPageProps {
  onBack: () => void;
}

type AdminTab = 'overview' | 'users' | 'rooms' | 'payments' | 'gifts' | 'system' | 'logs';

const TABS: Array<{ id: AdminTab; label: string; icon: React.ComponentType<{ size?: number | string }> }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'rooms', label: 'Rooms', icon: Server },
  { id: 'payments', label: 'Payments', icon: Receipt },
  { id: 'gifts', label: 'GiftCodes', icon: Ticket },
  { id: 'system', label: 'System', icon: Server },
  { id: 'logs', label: 'Logs', icon: ScrollText },
];

/**
 * Ruta privada `/admin`. El token se guarda solo en `sessionStorage`: sobrevive
 * recargas dentro de la misma pestaña pero se pierde al cerrarla (nunca
 * `localStorage`, para no dejar la llave en el disco de forma permanente).
 */
const ADMIN_TOKEN_SESSION_KEY = 'wp_admin_token';

function readStoredToken(): string | null {
  try {
    const value = sessionStorage.getItem(ADMIN_TOKEN_SESSION_KEY);
    return value && value.trim() !== '' ? value : null;
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_SESSION_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_SESSION_KEY);
  } catch {
    // sessionStorage no disponible (modo privado estricto): sigue en memoria.
  }
}

export const AdminPage: React.FC<AdminPageProps> = ({ onBack }) => {
  // Token en memoria + sessionStorage (misma pestaña). "Salir" lo borra todo.
  const [token, setToken] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState<AdminTab>('overview');

  // Restaura la sesión de la pestaña validándola contra el backend.
  useEffect(() => {
    let cancelled = false;
    const stored = readStoredToken();
    if (!stored) {
      setRestoring(false);
      return;
    }
    fetchSummary(stored)
      .then(() => {
        if (!cancelled) setToken(stored);
      })
      .catch(() => {
        storeToken(null);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = draft.trim();
    if (!candidate) {
      setLoginError('Ingresa el token de administrador.');
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    try {
      // Valida el token contra el backend (401/503 con mensaje claro).
      await fetchSummary(candidate);
      setToken(candidate);
      storeToken(candidate);
      setDraft('');
    } catch (err) {
      setLoginError(adminErrorMessage(err));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    storeToken(null);
    setDraft('');
    setLoginError(null);
    setTab('overview');
  };

  return (
    <div className="admin-page" data-testid="admin-page">
      <nav className="home-nav" aria-label="Navegación de administración">
        <div className="home-nav__inner">
          <span className="home-nav__brand">
            <span className="home-nav__logo" aria-hidden="true">
              <LayoutDashboard size={17} />
            </span>
            Administración
          </span>
          <div className="home-nav__actions">
            {token && (
              <button type="button" className="home-nav__btn home-nav__btn--ghost" onClick={handleLogout}>
                <LogOut size={15} aria-hidden="true" /> Salir
              </button>
            )}
            <button type="button" className="home-nav__btn home-nav__btn--ghost" onClick={onBack}>
              <ArrowLeft size={15} aria-hidden="true" /> Inicio
            </button>
          </div>
        </div>
      </nav>

      <div className="admin-page__inner">
        {restoring ? (
          <section className="admin-login" aria-label="Restaurando sesión">
            <h1 className="admin-login__title">Verificando sesión…</h1>
          </section>
        ) : !token ? (
          <section className="admin-login" aria-label="Acceso de administración">
            <h1 className="admin-login__title">Acceso restringido</h1>
            <p className="admin-login__desc">
              Ingresa el <code>ADMIN_TOKEN</code> del servidor. La sesión se
              mantiene solo en esta pestaña (se olvida al cerrarla o al salir).
            </p>
            <form className="admin-login__form" onSubmit={handleLogin}>
              <label className="form-group__label" htmlFor="admin-token">
                Token de administrador
              </label>
              <input
                id="admin-token"
                data-testid="admin-token-input"
                className="form-group__input"
                type="password"
                autoComplete="off"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="p. ej. supersecreto…"
              />
              {loginError && (
                <p className="admin-login__error" role="alert" data-testid="admin-login-error">
                  {loginError}
                </p>
              )}
              <button type="submit" className="btn btn--primary btn--full" disabled={loginLoading}>
                {loginLoading ? 'Verificando…' : 'Entrar'}
              </button>
            </form>
          </section>
        ) : (
          <>
            <div className="admin-tabs" role="tablist" aria-label="Secciones de administración">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    className={`admin-tabs__btn ${tab === t.id ? 'admin-tabs__btn--active' : ''}`}
                    onClick={() => setTab(t.id)}
                  >
                    <Icon size={15} />
                    {t.label}
                  </button>
                );
              })}
            </div>
            {tab === 'overview' && <OverviewSection token={token} />}
            {tab === 'users' && <UsersSection token={token} />}
            {tab === 'rooms' && <RoomsSection token={token} />}
            {tab === 'payments' && <PaymentsSection token={token} />}
            {tab === 'gifts' && <GiftCodesSection token={token} />}
            {tab === 'system' && <SystemSection token={token} />}
            {tab === 'logs' && <LogsSection token={token} />}
          </>
        )}
      </div>
    </div>
  );
};

/* ── Overview: conteos + ingresos (solo admin) + gráfica por rango ── */
const OverviewSection: React.FC<{ token: string }> = ({ token }) => {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [range, setRange] = useState<RevenueRange>('30d');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchSummary(token), fetchPayments(token, { limit: 200 })])
      .then(([s, p]) => {
        setSummary(s);
        setPayments(p.payments);
      })
      .catch((err) => setError(adminErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    reload();
  }, [reload]);

  const revenue = summarizeRevenue(payments);
  const buckets = bucketizeRevenue(payments, range);

  return (
    <section aria-label="Resumen">
      {loading && <p className="admin-muted">Cargando resumen…</p>}
      {error && (
        <p className="admin-login__error" role="alert">
          {error} <button type="button" className="btn btn--secondary" onClick={reload}>Reintentar</button>
        </p>
      )}
      {summary && (
        <div className="status-grid">
          <article className="status-card">
            <header className="status-card__head"><Server size={16} aria-hidden="true" /><h2>Salas en vivo</h2></header>
            <p className="status-card__value">{summary.rooms.live}</p>
          </article>
          <article className="status-card">
            <header className="status-card__head"><Receipt size={16} aria-hidden="true" /><h2>Pagos</h2></header>
            <p className="status-card__value">{summary.payments.total}</p>
            <p className="status-card__sub">
              {Object.entries(summary.payments.byStatus).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'sin pagos'}
            </p>
          </article>
          <article className="status-card">
            <header className="status-card__head"><Gift size={16} aria-hidden="true" /><h2>Códigos</h2></header>
            <p className="status-card__value">{summary.giftCodes.total}</p>
            <p className="status-card__sub">{summary.giftCodes.active} activos</p>
          </article>
          <article className="status-card">
            <header className="status-card__head"><Users size={16} aria-hidden="true" /><h2>Accesos activos</h2></header>
            <p className="status-card__value">{summary.entitlements.active}</p>
          </article>
        </div>
      )}
      <h2 className="admin-section__title">
        <BadgeDollarSign size={17} aria-hidden="true" /> Ingresos (solo admin)
      </h2>
      <div className="status-grid">
        <article className="status-card"><header className="status-card__head"><h2>Hoy</h2></header><p className="status-card__value">{formatMoney(revenue.today, revenue.currency)}</p></article>
        <article className="status-card"><header className="status-card__head"><h2>Semana (7d)</h2></header><p className="status-card__value">{formatMoney(revenue.week, revenue.currency)}</p></article>
        <article className="status-card"><header className="status-card__head"><h2>Mes (30d)</h2></header><p className="status-card__value">{formatMoney(revenue.month, revenue.currency)}</p></article>
        <article className="status-card"><header className="status-card__head"><h2>Total</h2></header><p className="status-card__value">{formatMoney(revenue.total, revenue.currency)}</p></article>
      </div>
      <div className="admin-chart-card">
        <div className="admin-chart-card__head">
          <h3>Ingresos por día/mes</h3>
          <div className="admin-range" role="group" aria-label="Rango de la gráfica">
            {(Object.keys(REVENUE_RANGE_LABELS) as RevenueRange[]).map((r) => (
              <button
                key={r}
                type="button"
                className={`admin-range__btn ${range === r ? 'admin-range__btn--active' : ''}`}
                onClick={() => setRange(r)}
              >
                {REVENUE_RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
        <AdminBarChart
          data={buckets.map((b) => ({ label: b.label, value: b.revenue }))}
          label={`Ingresos ${REVENUE_RANGE_LABELS[range]}`}
          formatValue={(v) => formatMoney(v, revenue.currency)}
        />
      </div>
    </section>
  );
};

/* ── Users: sin endpoint de listado (privacidad); agregados + lookup ── */
const UsersSection: React.FC<{ token: string }> = ({ token }) => {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [roomId, setRoomId] = useState('');
  const [room, setRoom] = useState<SanitizedRoom | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([fetchSummary(token), fetchMetrics(token)])
      .then(([s, m]) => {
        if (cancelled) return;
        setSummary(s);
        setMetrics(m);
      })
      .catch((err) => {
        if (!cancelled) setError(adminErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId.trim()) return;
    setError(null);
    setRoom(null);
    try {
      const res = await fetchRoomDetail(token, roomId);
      setRoom(res.room);
    } catch (err) {
      setError(adminErrorMessage(err));
    }
  };

  return (
    <section aria-label="Usuarios">
      <p className="admin-muted">
        No hay listado de usuarios (privacidad, igual que en lo público): solo agregados y
        participantes sanitizados (nombre/rol, sin IDs) de una sala puntual.
      </p>
      {error && <p className="admin-login__error" role="alert">{error}</p>}
      <div className="status-grid">
        <article className="status-card"><header className="status-card__head"><h2>Conectados ahora</h2></header><p className="status-card__value">{metrics?.sockets.online ?? '—'}</p></article>
        <article className="status-card"><header className="status-card__head"><h2>Pico WS</h2></header><p className="status-card__value">{metrics?.traffic.ws.peakConnections ?? '—'}</p></article>
        <article className="status-card"><header className="status-card__head"><h2>Accesos premium activos</h2></header><p className="status-card__value">{summary?.entitlements.active ?? '—'}</p></article>
        <article className="status-card"><header className="status-card__head"><h2>Usos de códigos canjeados</h2></header><p className="status-card__value">{metrics?.giftCodes.redeemedUses ?? '—'}</p></article>
      </div>
      <form className="admin-form-row" onSubmit={lookup}>
        <input className="form-group__input" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} placeholder="Código de sala (p. ej. AB12CD)" aria-label="Código de sala" />
        <button type="submit" className="btn btn--secondary">Ver participantes</button>
      </form>
      {room && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Nombre</th><th>Rol</th><th>Anfitrión</th></tr></thead>
            <tbody>
              {room.participants.map((p, i) => (
                <tr key={`${p.name}-${i}`}>
                  <td>{p.name}</td>
                  <td>{p.role}</td>
                  <td>{p.isHost ? 'Sí' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

/* ── Rooms: conteo + detalle sanitizado puntual ── */
const RoomsSection: React.FC<{ token: string }> = ({ token }) => {
  const [liveRooms, setLiveRooms] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [roomId, setRoomId] = useState('');
  const [room, setRoom] = useState<SanitizedRoom | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRooms(token)
      .then((res) => {
        if (cancelled || !('liveRooms' in res)) return;
        setLiveRooms(res.liveRooms);
        setNote(res.note);
      })
      .catch((err) => {
        if (!cancelled) setError(adminErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId.trim()) return;
    setError(null);
    setRoom(null);
    try {
      const res = await fetchRoomDetail(token, roomId);
      setRoom(res.room);
    } catch (err) {
      setError(adminErrorMessage(err));
    }
  };

  return (
    <section aria-label="Salas">
      <div className="status-grid">
        <article className="status-card"><header className="status-card__head"><h2>Salas en vivo</h2></header><p className="status-card__value">{liveRooms ?? '—'}</p><p className="status-card__sub">{note}</p></article>
      </div>
      {error && <p className="admin-login__error" role="alert">{error}</p>}
      <form className="admin-form-row" onSubmit={lookup}>
        <input className="form-group__input" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} placeholder="Código de sala (p. ej. AB12CD)" aria-label="Código de sala" />
        <button type="submit" className="btn btn--secondary">Buscar sala</button>
      </form>
      {room && (
        <article className="status-card">
          <header className="status-card__head"><h2>Sala {room.roomId}</h2></header>
          <p className="status-card__sub">Anfitrión: {room.hostName} · Estado: {room.status} · Participantes: {room.participantCount} · Solicitudes pendientes: {room.pendingRequests}</p>
          <p className="status-card__sub">Temporal: {room.isTemporary ? 'sí' : 'no'} · Video: {room.video ? `${room.video.sourceType ?? ''} ${room.video.title ?? ''}`.trim() || 'sí' : 'sin video'}</p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Nombre</th><th>Rol</th><th>Anfitrión</th></tr></thead>
              <tbody>
                {room.participants.map((p, i) => (
                  <tr key={`${p.name}-${i}`}><td>{p.name}</td><td>{p.role}</td><td>{p.isHost ? 'Sí' : 'No'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </section>
  );
};

/* ── Payments: tabla con filtros + reembolso ── */
const PaymentsSection: React.FC<{ token: string }> = ({ token }) => {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refunding, setRefunding] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchPayments(token, { status: status || undefined, provider: provider || undefined, search: search || undefined, limit: 100 })
      .then((res) => setPayments(res.payments))
      .catch((err) => setError(adminErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [token, status, provider, search]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleRefund = async (paymentId: string) => {
    if (!window.confirm(`¿Reembolsar el pago ${paymentId}? (marca local, no mueve dinero real)`)) return;
    setRefunding(paymentId);
    try {
      await refundPayment(token, paymentId);
      await reload();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setRefunding(null);
    }
  };

  return (
    <section aria-label="Pagos">
      <form className="admin-filters" onSubmit={(e) => { e.preventDefault(); reload(); }}>
        <select className="form-group__input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>
          <option value="pending">pending</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
          <option value="refunded">refunded</option>
        </select>
        <input className="form-group__input" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Proveedor (paypal)" aria-label="Proveedor" />
        <input className="form-group__input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar (id, sala, plan…)" aria-label="Búsqueda" />
        <button type="submit" className="btn btn--secondary">Filtrar</button>
      </form>
      {loading && <p className="admin-muted">Cargando pagos…</p>}
      {error && <p className="admin-login__error" role="alert">{error}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>ID</th><th>Plan</th><th>Monto</th><th>Estado</th><th>Proveedor</th><th>Creado</th><th>Acción</th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td title={p.id}>{p.id.slice(0, 12)}…</td>
                <td>{p.planId}</td>
                <td>{formatMoney(p.amount, p.currency)}</td>
                <td><span className={`admin-pill admin-pill--${p.status}`}>{p.status}</span></td>
                <td>{p.provider}</td>
                <td>{formatDateTime(p.createdAt)}</td>
                <td>
                  {p.status === 'completed' && (
                    <button type="button" className="btn btn--danger" disabled={refunding === p.id} onClick={() => handleRefund(p.id)}>
                      {refunding === p.id ? '…' : 'Reembolsar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments.length === 0 && !loading && <p className="admin-muted">Sin pagos para estos filtros.</p>}
      </div>
    </section>
  );
};

/* ── GiftCodes: CRUD + usos/expiración/historial ── */
const GiftCodesSection: React.FC<{ token: string }> = ({ token }) => {
  const [codes, setCodes] = useState<GiftCodeRecord[]>([]);
  const [history, setHistory] = useState<AuditRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState('PREMIUM_ROOM');
  const [maxUses, setMaxUses] = useState('10');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    Promise.all([fetchGiftCodes(token), fetchAudit(token, { limit: 200 })])
      .then(([c, a]) => {
        setCodes(c.codes);
        setHistory(a.entries);
      })
      .catch((err) => setError(adminErrorMessage(err)));
  }, [token]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create');
    setError(null);
    try {
      await createGiftCode(token, {
        type,
        maxUses: Number(maxUses) || 1,
        expiresInDays: expiresInDays.trim() === '' ? undefined : Number(expiresInDays),
      });
      await reload();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDisable = async (code: string) => {
    setBusy(code);
    try {
      await disableGiftCode(token, code);
      await reload();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (code: string) => {
    if (!window.confirm(`¿Borrar el código ${code}? Solo se puede si no tiene usos.`)) return;
    setBusy(code);
    try {
      await deleteGiftCode(token, code);
      await reload();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const historyFor = (code: string) => history.filter((h) => (h.detail ?? '').includes(code));

  return (
    <section aria-label="Códigos de regalo">
      <form className="admin-form-row" onSubmit={handleCreate}>
        <select className="form-group__input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
          <option value="PREMIUM_ROOM">PREMIUM_ROOM</option>
          <option value="FREE_ROOM">FREE_ROOM</option>
        </select>
        <input className="form-group__input" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="maxUses" aria-label="Usos máximos" inputMode="numeric" />
        <input className="form-group__input" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} placeholder="expira en días (vacío = sin expiración)" aria-label="Expira en días" inputMode="numeric" />
        <button type="submit" className="btn btn--primary" disabled={busy === 'create'}>Crear código</button>
      </form>
      {error && <p className="admin-login__error" role="alert">{error}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Código</th><th>Tipo</th><th>Usos</th><th>Estado</th><th>Expira</th><th>Historial</th><th>Acciones</th></tr></thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.code}>
                <td><code>{c.code}</code></td>
                <td>{c.type}</td>
                <td>{c.uses}/{c.maxUses}</td>
                <td><span className={`admin-pill admin-pill--${c.status}`}>{c.status}</span></td>
                <td>{formatDateTime(c.expiresAt)}</td>
                <td>{historyFor(c.code).length > 0 ? historyFor(c.code).map((h) => `${h.action} (${formatDateTime(h.createdAt)})`).join(' · ') : '—'}</td>
                <td>
                  <div className="admin-row-actions">
                    {c.status === 'active' && (
                      <button type="button" className="btn btn--secondary" disabled={busy === c.code} onClick={() => handleDisable(c.code)}>Desactivar</button>
                    )}
                    <button type="button" className="btn btn--danger" disabled={busy === c.code} onClick={() => handleDelete(c.code)}>Borrar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {codes.length === 0 && <p className="admin-muted">Sin códigos todavía.</p>}
      </div>
    </section>
  );
};

/* ── System: métricas del backend (CPU/RAM/tráfico/WS) ── */
const SystemSection: React.FC<{ token: string }> = ({ token }) => {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMetrics(token)
      .then((m) => {
        if (!cancelled) setMetrics(m);
      })
      .catch((err) => {
        if (!cancelled) setError(adminErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) return <p className="admin-login__error" role="alert">{error}</p>;
  if (!metrics) return <p className="admin-muted">Cargando métricas…</p>;
  const sys = metrics.system;
  const memUsed = sys.totalMemMb !== null && sys.freeMemMb !== null ? sys.totalMemMb - sys.freeMemMb : null;

  return (
    <section aria-label="Sistema">
      <div className="status-grid">
        <article className="status-card"><header className="status-card__head"><h2>Uptime</h2></header><p className="status-card__value">{Math.floor(metrics.uptimeSeconds / 3600)} h</p><p className="status-card__sub">{metrics.uptimeSeconds} s</p></article>
        <article className="status-card"><header className="status-card__head"><h2>CPU (1m)</h2></header><p className="status-card__value">{sys.cpuLoad1m ?? '—'}</p></article>
        <article className="status-card"><header className="status-card__head"><h2>RAM usada</h2></header><p className="status-card__value">{memUsed === null ? '—' : `${memUsed} MB`}</p><p className="status-card__sub">{sys.totalMemMb === null ? '' : `de ${sys.totalMemMb} MB`}</p></article>
        <article className="status-card"><header className="status-card__head"><h2>Heap</h2></header><p className="status-card__value">{sys.heapUsedMb === null ? '—' : `${sys.heapUsedMb} MB`}</p></article>
        <article className="status-card"><header className="status-card__head"><h2>HTTP req</h2></header><p className="status-card__value">{metrics.traffic.http.totalRequests}</p><p className="status-card__sub">{metrics.traffic.http.totalErrors} errores</p></article>
        <article className="status-card"><header className="status-card__head"><h2>WS</h2></header><p className="status-card__value">{metrics.sockets.online}</p><p className="status-card__sub">pico {metrics.traffic.ws.peakConnections} · +{metrics.traffic.ws.connects}/-{metrics.traffic.ws.disconnects}</p></article>
      </div>
      <div className="admin-chart-card">
        <div className="admin-chart-card__head"><h3>Peticiones por minuto (última hora)</h3></div>
        <AdminLineChart data={metrics.traffic.perMinute.map((b) => ({ label: b.minuteStart ?? '', value: b.requests }))} label="Peticiones por minuto" />
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Ruta</th><th>Peticiones</th><th>Errores</th><th>Latencia media</th><th>p95</th></tr></thead>
          <tbody>
            {metrics.traffic.http.routes.map((r) => (
              <tr key={r.route}><td><code>{r.route}</code></td><td>{r.count}</td><td>{r.errors}</td><td>{r.avgMs} ms</td><td>{r.p95Ms} ms</td></tr>
            ))}
          </tbody>
        </table>
        {metrics.traffic.http.routes.length === 0 && <p className="admin-muted">Sin tráfico registrado todavía.</p>}
      </div>
    </section>
  );
};

/* ── Logs: auditoría con filtros ── */
const LogsSection: React.FC<{ token: string }> = ({ token }) => {
  const [entries, setEntries] = useState<AuditRecord[]>([]);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [since, setSince] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchAudit(token, { action: action || undefined, actor: actor || undefined, since: since || undefined, limit: 100 })
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(adminErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [token, action, actor, since]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <section aria-label="Auditoría">
      <form className="admin-filters" onSubmit={(e) => { e.preventDefault(); reload(); }}>
        <input className="form-group__input" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Acción (payments.refunded…)" aria-label="Acción" />
        <input className="form-group__input" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Actor" aria-label="Actor" />
        <input className="form-group__input" type="date" value={since} onChange={(e) => setSince(e.target.value)} aria-label="Desde" />
        <button type="submit" className="btn btn--secondary">Filtrar</button>
      </form>
      {loading && <p className="admin-muted">Cargando auditoría…</p>}
      {error && <p className="admin-login__error" role="alert">{error}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Detalle</th></tr></thead>
          <tbody>
            {entries.map((a) => (
              <tr key={a.id}><td>{formatDateTime(a.createdAt)}</td><td>{a.actor}</td><td><code>{a.action}</code></td><td>{a.detail ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && !loading && <p className="admin-muted">Sin entradas para estos filtros.</p>}
      </div>
    </section>
  );
};

export default AdminPage;
