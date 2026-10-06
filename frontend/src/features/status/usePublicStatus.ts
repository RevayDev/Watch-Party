import { useEffect, useRef, useState } from 'react';
import { ApiService } from '../../services/api';
import { isStatusPayload, type HealthPayload, type StatusPayload } from './types';

/** Nº de muestras retenidas por sparkline (ventana en memoria, sin persistir). */
const HISTORY_LIMIT = 40;
/** Fallback polling de `/api/status` (nada agresivo: 12 s). */
const POLL_INTERVAL_MS = 12_000;
/** Refresco de `/api/health` (menos volátil: 30 s). */
const HEALTH_INTERVAL_MS = 30_000;

export type StatusSource = 'sse' | 'polling';

export interface PublicStatusState {
  health: HealthPayload | null;
  status: StatusPayload | null;
  usersHistory: number[];
  roomsHistory: number[];
  connectionsHistory: number[];
  lastUpdated: Date | null;
  source: StatusSource | null;
  error: string | null;
}

function pushCapped(prev: number[], value: number): number[] {
  const next = [...prev, value];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

/**
 * Estado público en vivo: SSE primero (`/api/status/stream`, push cada 5 s),
 * fallback a polling `/api/status` cada 12 s si el SSE falla o no existe.
 * Solo GET públicos, SIN token (cero PII: el payload ya viene agregado).
 */
export function usePublicStatus(): PublicStatusState {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [usersHistory, setUsersHistory] = useState<number[]>([]);
  const [roomsHistory, setRoomsHistory] = useState<number[]>([]);
  const [connectionsHistory, setConnectionsHistory] = useState<number[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [source, setSource] = useState<StatusSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sseFailed = useRef(false);

  // `/api/health` en paralelo (no bloquea el estado principal).
  useEffect(() => {
    let cancelled = false;
    const loadHealth = () => {
      ApiService.getHealth()
        .then((h) => {
          if (cancelled) return;
          setHealth(h);
          setConnectionsHistory((prev) => pushCapped(prev, h.connections));
        })
        .catch(() => {
          if (!cancelled) setHealth(null);
        });
    };
    loadHealth();
    const timer = setInterval(loadHealth, HEALTH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // SSE primero; si falla → polling cada 12 s.
  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let es: EventSource | null = null;

    const applyStatus = (payload: StatusPayload, via: StatusSource) => {
      if (cancelled) return;
      setStatus(payload);
      setUsersHistory((prev) => pushCapped(prev, payload.connectedUsers));
      setRoomsHistory((prev) => pushCapped(prev, payload.activeRooms));
      setLastUpdated(new Date());
      setSource(via);
      setError(null);
    };

    const startPolling = () => {
      if (pollTimer !== null) return;
      const poll = () => {
        ApiService.getStatus()
          .then((payload) => applyStatus(payload, 'polling'))
          .catch(() => {
            if (!cancelled) setError('No se pudo actualizar el estado. Reintentando…');
          });
      };
      poll();
      pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    };

    if (typeof EventSource !== 'undefined' && !sseFailed.current) {
      try {
        es = new EventSource('/api/status/stream');
        es.onmessage = (event) => {
          try {
            const parsed: unknown = JSON.parse((event as MessageEvent).data);
            if (isStatusPayload(parsed)) applyStatus(parsed, 'sse');
          } catch {
            // Mensaje malformado: se ignora, el siguiente tick lo reintenta.
          }
        };
        es.onerror = () => {
          sseFailed.current = true;
          es?.close();
          es = null;
          if (!cancelled) startPolling();
        };
      } catch {
        sseFailed.current = true;
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      cancelled = true;
      es?.close();
      if (pollTimer !== null) clearInterval(pollTimer);
    };
  }, []);

  return { health, status, usersHistory, roomsHistory, connectionsHistory, lastUpdated, source, error };
}

export default usePublicStatus;
