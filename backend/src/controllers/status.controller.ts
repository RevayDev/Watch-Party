/**
 * STATUS — salud y estado público agregado (solo lectura, sin PII).
 *
 * - `GET /api/health`: liveness ampliado (retrocompatible: conserva
 *   `status/service/timestamp` y añade `uptime/database/websocket/
 *   connections/rooms`). `database` lee `mongoose.connection.readyState`
 *   en síncrono tras try/catch (sin timeout necesario: no hay I/O, nunca
 *   revienta). `disconnected` NO degrada: el fallback en memoria es un modo
 *   soportado. `rooms` cuenta con timeout corto (1500 ms) → `null` + `degraded`
 *   si falla (nunca 500 por observabilidad).
 * - `GET /api/status`: SOLO agregados públicos (nada de nombres, emails, IPs,
 *   códigos de sala ni pagos). `avg/maxUsersPerRoom` se calculan de la
 *   presencia socket en vivo (`activeUsers` agrupado por sala). Todas las
 *   salas actuales son gratuitas/demo → `freeRooms = activeRooms`,
 *   `premiumRooms = 0` hasta la fase de pagos (documentado, no inventado).
 * - `GET /api/status/stream`: mismo payload por SSE cada 5 s (polling sin
 *   pegarle al endpoint). El middleware de métricas excluye esta ruta.
 */

import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { RoomService } from '../services/room.service.js';
import { activeUsers } from '../sockets/socket-state.js';
import {
  getSystemMetrics,
  updatePeakConnections,
  setActiveRooms,
  getMetricsSnapshot,
} from '../services/metrics.service.js';

const ROOM_COUNT_TIMEOUT_MS = 1500;
const STATUS_STREAM_INTERVAL_MS = 5000;

export type DatabaseState = 'connected' | 'connecting' | 'disconnected' | 'disconnecting';

/** Lectura síncrona del estado de Mongoose; jamás lanza. */
export function checkDatabaseState(): DatabaseState {
  try {
    switch (mongoose.connection.readyState) {
      case 1:
        return 'connected';
      case 2:
        return 'connecting';
      case 3:
        return 'disconnecting';
      default:
        return 'disconnected';
    }
  } catch {
    return 'disconnected';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

/**
 * Nº de salas vivas con timeout corto. `null` si el store falla o tarda:
 * observar nunca debe tumbar el endpoint.
 */
export async function countLiveRoomsSafe(): Promise<number | null> {
  try {
    return await withTimeout(RoomService.countLiveRooms(), ROOM_COUNT_TIMEOUT_MS);
  } catch {
    return null;
  }
}

/** Salas distintas con presencia socket en vivo (fallback/estimación). */
export function countSocketRooms(): number {
  const rooms = new Set<string>();
  for (const user of activeUsers.values()) rooms.add(user.roomId);
  return rooms.size;
}

export interface PerRoomPresence {
  avgUsersPerRoom: number;
  maxUsersPerRoom: number;
}

/** Promedio (2 decimales) y máximo de usuarios por sala con presencia. */
export function perRoomPresence(): PerRoomPresence {
  const perRoom = new Map<string, number>();
  for (const user of activeUsers.values()) {
    perRoom.set(user.roomId, (perRoom.get(user.roomId) ?? 0) + 1);
  }
  if (perRoom.size === 0) return { avgUsersPerRoom: 0, maxUsersPerRoom: 0 };
  let max = 0;
  let total = 0;
  for (const n of perRoom.values()) {
    total += n;
    if (n > max) max = n;
  }
  return { avgUsersPerRoom: Math.round((total / perRoom.size) * 100) / 100, maxUsersPerRoom: max };
}

export interface HealthPayload {
  status: 'ok' | 'degraded';
  service: 'watch-party-backend';
  uptime: number;
  database: DatabaseState;
  websocket: 'up';
  connections: number;
  rooms: number | null;
  timestamp: string;
}

export async function buildHealthPayload(): Promise<HealthPayload> {
  const rooms = await countLiveRoomsSafe();
  try {
    setActiveRooms(rooms ?? countSocketRooms());
  } catch { /* gauge best-effort */ }
  return {
    status: rooms === null ? 'degraded' : 'ok',
    service: 'watch-party-backend',
    uptime: getSystemMetrics().uptimeSec,
    database: checkDatabaseState(),
    websocket: 'up',
    connections: activeUsers.size,
    rooms,
    timestamp: new Date().toISOString(),
  };
}

export interface StatusPayload {
  status: 'online' | 'degraded';
  connectedUsers: number;
  peakUsers: number;
  activeRooms: number;
  avgUsersPerRoom: number;
  maxUsersPerRoom: number;
  freeRooms: number;
  premiumRooms: number;
  uptime: number;
  timestamp: string;
}

export async function buildStatusPayload(): Promise<StatusPayload> {
  const rooms = await countLiveRoomsSafe();
  const degraded = rooms === null;
  const activeRooms = rooms ?? countSocketRooms();
  try {
    setActiveRooms(activeRooms);
  } catch { /* gauge best-effort */ }
  const connectedUsers = activeUsers.size;
  // El pico cubre usuarios con sala (join) y sockets crudos (hook en
  // room.socket.ts): se toma el máximo de ambas poblaciones.
  let peakUsers = connectedUsers;
  try {
    updatePeakConnections(connectedUsers);
    peakUsers = Math.max(connectedUsers, getMetricsSnapshot().ws.peakConnections);
  } catch { /* → connectedUsers */ }
  const presence = perRoomPresence();
  return {
    status: degraded ? 'degraded' : 'online',
    connectedUsers,
    peakUsers,
    activeRooms,
    avgUsersPerRoom: presence.avgUsersPerRoom,
    maxUsersPerRoom: presence.maxUsersPerRoom,
    // Fase demo: todo es gratuito; premium llegará con pagos (ver plans.ts).
    freeRooms: activeRooms,
    premiumRooms: 0,
    uptime: getSystemMetrics().uptimeSec,
    timestamp: new Date().toISOString(),
  };
}

/** GET /api/health — liveness ampliado (nunca 500 por observabilidad). */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await buildHealthPayload());
  } catch {
    res.json({
      status: 'degraded',
      service: 'watch-party-backend',
      uptime: getSystemMetrics().uptimeSec,
      database: checkDatabaseState(),
      websocket: 'up',
      connections: activeUsers.size,
      rooms: null,
      timestamp: new Date().toISOString(),
    } satisfies HealthPayload);
  }
}

/** GET /api/status — agregados públicos (sin PII). */
export async function getStatus(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await buildStatusPayload());
  } catch {
    res.status(500).json({ error: 'No se pudo construir el estado.' });
  }
}

/**
 * GET /api/status/stream — mismo payload por SSE cada 5 s.
 * Limpieza en `close`: sin intervalos huérfanos.
 */
export function streamStatus(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let closed = false;
  const send = async (): Promise<void> => {
    if (closed) return;
    try {
      const payload = await buildStatusPayload();
      if (closed) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // Siguiente tick lo reintenta; el stream no se corta por un fallo puntual.
    }
  };

  void send();
  const timer = setInterval(() => void send(), STATUS_STREAM_INTERVAL_MS);
  timer.unref();
  req.on('close', () => {
    closed = true;
    clearInterval(timer);
  });
}
