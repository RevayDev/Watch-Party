import React, { useCallback, useEffect, useState } from 'react';
import { ApiService } from '../../services/api';

/**
 * Panel Admin (docs/admin-panel-spotify.md §1).
 * Vista separada de Home y sala (`?admin` en App). El token lo escribe el
 * usuario y vive en sessionStorage (nunca en el código); viaja como
 * `x-admin-token`. Solo lectura por defecto; cerrar/banear piden confirmación.
 */

const TOKEN_KEY = 'wp_admin_token';

interface AdminRoomSummary {
  roomId: string;
  name?: string | null;
  status: string;
  participantCount: number;
  participants: Array<{ name: string; role: string; isLeader: boolean }>;
}

export const AdminPanel: React.FC<{ onLeave?: () => void }> = ({ onLeave }) => {
  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [rooms, setRooms] = useState<AdminRoomSummary[]>([]);
  const [detail, setDetail] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reactionsOn, setReactionsOn] = useState(true);
  const [effectsOn, setEffectsOn] = useState(true);
  const [renameDraft, setRenameDraft] = useState<Record<string, string>>({});

  const loadList = useCallback(async (t: string) => {
    const data = await ApiService.adminListRooms(t);
    setRooms(data.rooms ?? []);
  }, []);

  const openDetail = useCallback(
    async (t: string, roomId: string) => {
      const data = await ApiService.adminGetRoom(roomId, t);
      setDetail(data);
      setReactionsOn(data.settings?.reactionsEnabled !== false);
      setEffectsOn(data.settings?.visualEffects !== false);
    },
    []
  );

  // Reentra con el token guardado (recargar no pide el secreto otra vez).
  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (!saved) return;
    setTokenInput(saved);
    setToken(saved);
    loadList(saved).catch((err: any) => {
      setError(err?.message || 'No se pudo cargar el panel');
    });
  }, [loadList]);

  const handleLogin = async () => {
    setError('');
    const t = tokenInput.trim();
    if (!t) {
      setError('Escribe el token de administrador.');
      return;
    }
    setBusy(true);
    try {
      await loadList(t);
      sessionStorage.setItem(TOKEN_KEY, t);
      setToken(t);
    } catch (err: any) {
      setError(err?.message || 'Token inválido.');
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (fn: () => Promise<unknown>, roomId?: string) => {
    if (!token) return;
    setError('');
    setBusy(true);
    try {
      await fn();
      await loadList(token);
      if (roomId ?? detail) {
        await openDetail(token, roomId ?? detail.roomId);
      }
    } catch (err: any) {
      setError(err?.message || 'La acción falló.');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="admin-gate">
        <h1>Panel Admin</h1>
        <p>Gestión de salas y usuarios. Requiere el ADMIN_TOKEN del servidor.</p>
        <input
          type="password"
          placeholder="Token de administrador"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleLogin();
          }}
        />
        <button type="button" className="btn btn--primary" onClick={() => void handleLogin()} disabled={busy}>
          Entrar
        </button>
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="admin-panel">
      <h1>Panel Admin</h1>
      {onLeave && (
        <button type="button" className="btn btn--secondary" onClick={onLeave}>
          ← Volver
        </button>
      )}
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      <section>
        <h2>Salas activas ({rooms.length})</h2>
        {rooms.length === 0 && <p>No hay salas activas.</p>}
        <ul className="admin-rooms">
          {rooms.map((r) => (
            <li key={r.roomId} className="admin-room-row">
              <strong>{r.roomId}</strong>
              {r.name && <span> · {r.name}</span>}
              <span> · {r.participantCount} participantes</span>
              <span> · {r.status}</span>
              <button type="button" onClick={() => void runAction(() => openDetail(token, r.roomId))}>
                Ver
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`¿Cerrar la sala ${r.roomId}? Expulsa a todos.`)) return;
                  void runAction(() => ApiService.adminDeleteRoom(r.roomId, token).then(() => {
                    if (detail?.roomId === r.roomId) setDetail(null);
                  }));
                }}
              >
                Cerrar
              </button>
            </li>
          ))}
        </ul>
      </section>

      {detail && (
        <section>
          <h2>Detalle {detail.roomId}</h2>
          <h3>Participantes</h3>
          <ul className="admin-users">
            {(detail.participants ?? []).map((p: any) => (
              <li key={p.name}>
                <strong>{p.name}</strong>
                <span> · {p.role}</span>
                {!p.isLeader && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          () => ApiService.adminKick(detail.roomId, token, { targetUserName: p.name }),
                          detail.roomId
                        )
                      }
                    >
                      Expulsar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(`¿Banear a ${p.name}? No podrá volver a entrar.`)) return;
                        void runAction(
                          () =>
                            ApiService.adminKick(detail.roomId, token, {
                              targetUserName: p.name,
                              ban: true,
                            }),
                          detail.roomId
                        );
                      }}
                    >
                      Banear
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          () =>
                            ApiService.adminSetRole(detail.roomId, token, {
                              targetUserName: p.name,
                              role: p.role === 'coleader' ? 'member' : 'coleader',
                            }),
                          detail.roomId
                        )
                      }
                    >
                      {p.role === 'coleader' ? 'Quitar rol' : 'Hacer coleader'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          () =>
                            ApiService.adminMute(detail.roomId, token, {
                              kind: 'mic',
                              targetUserName: p.name,
                            }),
                          detail.roomId
                        )
                      }
                    >
                      Silenciar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(`¿Transferir el liderazgo a ${p.name}?`)) return;
                        void runAction(
                          () =>
                            ApiService.adminTransferLeader(detail.roomId, token, {
                              targetUserName: p.name,
                            }),
                          detail.roomId
                        );
                      }}
                    >
                      Transferir liderazgo
                    </button>
                    <input
                      type="text"
                      placeholder="Nuevo nombre"
                      aria-label={`Nuevo nombre para ${p.name}`}
                      value={renameDraft[p.name] ?? ''}
                      onChange={(e) => setRenameDraft((d) => ({ ...d, [p.name]: e.target.value }))}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          () =>
                            ApiService.adminRename(detail.roomId, token, {
                              oldName: p.name,
                              newName: renameDraft[p.name] ?? '',
                            }),
                          detail.roomId
                        )
                      }
                    >
                      Renombrar
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          {(detail.kickedUsers ?? []).length > 0 && (
            <>
              <h3>Expulsados</h3>
              <ul className="admin-kicked">
                {(detail.kickedUsers ?? []).map((k: any) => (
                  <li key={k.name}>
                    <span>{k.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          () => ApiService.adminUnban(detail.roomId, token, { targetUserName: k.name }),
                          detail.roomId
                        )
                      }
                    >
                      Desbanear
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>Ajustes</h3>
          <label>
            <input
              type="checkbox"
              checked={reactionsOn}
              onChange={(e) => setReactionsOn(e.target.checked)}
            />
            Reacciones
          </label>
          <label>
            <input
              type="checkbox"
              checked={effectsOn}
              onChange={(e) => setEffectsOn(e.target.checked)}
            />
            Efectos visuales
          </label>
          <button
            type="button"
            onClick={() =>
              void runAction(
                () =>
                  ApiService.adminUpdateSettings(detail.roomId, token, {
                    reactionsEnabled: reactionsOn,
                    visualEffects: effectsOn,
                  }),
                detail.roomId
              )
            }
          >
            Guardar ajustes
          </button>
        </section>
      )}
    </div>
  );
};

export default AdminPanel;
