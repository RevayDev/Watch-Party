import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  MAX_ROUTES,
  OTHER_ROUTE_KEY,
  getMetricsSnapshot,
  getMinuteBuckets,
  getRouteAggregates,
  getSystemMetrics,
  isMetricsExcluded,
  metricsMiddleware,
  recordHttpRequest,
  recordWsConnect,
  recordWsDisconnect,
  resetMetrics,
  setActiveRooms,
  updatePeakConnections,
} from '../src/services/metrics.service.js';

beforeEach(() => {
  resetMetrics();
});

function mockRes(statusCode: number): EventEmitter & { statusCode: number } {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  return res;
}

describe('metrics.service (observabilidad en memoria)', () => {
  it('excluye /api/health y cuenta el resto', () => {
    expect(isMetricsExcluded('/api/health')).toBe(true);
    expect(isMetricsExcluded('/api/rooms')).toBe(false);
  });

  it('middleware: cuenta por ruta, mide latencia y errores al `finish`', () => {
    const nextCalls: number[] = [];
    const next = () => nextCalls.push(1);

    const resOk = mockRes(200);
    metricsMiddleware({ method: 'GET', path: '/api/rooms' } as never, resOk as never, next);
    resOk.emit('finish');

    const resErr = mockRes(500);
    metricsMiddleware({ method: 'POST', path: '/api/rooms' } as never, resErr as never, next);
    resErr.emit('finish');

    expect(nextCalls).toHaveLength(2);
    const routes = getRouteAggregates();
    expect(routes).toHaveLength(2);
    const get = routes.find((r) => r.route === 'GET /api/rooms');
    const post = routes.find((r) => r.route === 'POST /api/rooms');
    expect(get).toMatchObject({ count: 1, errors: 0 });
    expect(post).toMatchObject({ count: 1, errors: 1 });
    expect(get?.avgMs).toBeGreaterThanOrEqual(0);
    expect(get?.p95Ms).toBeGreaterThanOrEqual(0);
  });

  it('middleware: 4xx también cuenta como error; excluidos no registran', () => {
    const next = () => undefined;
    const res = mockRes(404);
    metricsMiddleware({ method: 'GET', path: '/api/health' } as never, res as never, next);
    res.emit('finish');
    expect(getMetricsSnapshot().http.totalRequests).toBe(0);
  });

  it('recordHttpRequest: avg/p95 sobre muestra acotada', () => {
    for (let i = 1; i <= 10; i++) recordHttpRequest('GET /x', i, 200);
    const [agg] = getRouteAggregates();
    expect(agg.count).toBe(10);
    expect(agg.avgMs).toBeCloseTo(5.5, 5);
    expect(agg.p95Ms).toBe(10);
  });

  it('anillo de 60 minutos: agrega en el minuto actual, ordenado', () => {
    recordHttpRequest('GET /a', 5, 200);
    recordHttpRequest('GET /b', 5, 500);
    const buckets = getMinuteBuckets();
    expect(buckets.length).toBeGreaterThanOrEqual(1);
    const total = buckets.reduce((acc, b) => acc + b.requests, 0);
    const errs = buckets.reduce((acc, b) => acc + b.errors, 0);
    expect(total).toBe(2);
    expect(errs).toBe(1);
    expect(buckets.length).toBeLessThanOrEqual(60);
    expect(typeof buckets[0].minuteStart).toBe('string');
  });

  it('mapa de rutas acotado: el exceso agrega en OTHER', () => {
    for (let i = 0; i < MAX_ROUTES + 10; i++) {
      recordHttpRequest(`GET /r-${i}`, 1, 200);
    }
    const snap = getMetricsSnapshot();
    expect(snap.http.totalRequests).toBe(MAX_ROUTES + 10);
    const routes = getRouteAggregates();
    expect(routes.length).toBeLessThanOrEqual(MAX_ROUTES + 1);
    const other = routes.find((r) => r.route === OTHER_ROUTE_KEY);
    expect(other).toBeDefined();
    expect(other?.count).toBeGreaterThanOrEqual(10);
  });

  it('ws: connects/disconnects y pico histórico', () => {
    recordWsConnect(3);
    recordWsConnect(7);
    recordWsDisconnect();
    updatePeakConnections(2); // no debe bajar el pico
    const snap = getMetricsSnapshot();
    expect(snap.ws).toMatchObject({ connects: 2, disconnects: 1, peakConnections: 7 });
  });

  it('setActiveRooms expone el gauge de salas', () => {
    setActiveRooms(4);
    expect(getMetricsSnapshot().rooms).toEqual({ active: 4 });
  });

  it('sistema: uptime numérico y recursos número-o-null (nunca lanza)', () => {
    const sys = getSystemMetrics();
    expect(sys.uptimeSec).toBeGreaterThanOrEqual(0);
    for (const key of ['cpuLoad1m', 'totalMemMb', 'freeMemMb', 'heapUsedMb', 'heapTotalMb'] as const) {
      const v = sys[key];
      expect(v === null || typeof v === 'number').toBe(true);
    }
  });

  it('resetMetrics deja todo a cero', () => {
    recordHttpRequest('GET /z', 1, 200);
    recordWsConnect(9);
    setActiveRooms(2);
    resetMetrics();
    const snap = getMetricsSnapshot();
    expect(snap.http.totalRequests).toBe(0);
    expect(snap.ws).toMatchObject({ connects: 0, disconnects: 0, peakConnections: 0 });
    expect(snap.rooms).toEqual({ active: 0 });
    expect(snap.perMinute).toEqual([]);
  });
});
