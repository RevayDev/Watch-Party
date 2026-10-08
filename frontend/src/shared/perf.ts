/**
 * Helpers puros del rol B (overlays de rendimiento).
 *
 * Sin dependencias de React: fáciles de probar y reutilizables desde
 * VideoPlayer / useRoomSocket sin tocar la lógica de sync ni de WebRTC.
 */

/** Límites del deslizador de ducking (%), default 30 %. */
export const DUCK_MIN_PCT = 10;
export const DUCK_MAX_PCT = 60;
export const DUCK_DEFAULT_PCT = 30;

/** Sanea el nivel de ducking a un entero entre 10 y 60 (default 30). */
export function clampDuckPct(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DUCK_DEFAULT_PCT;
  const rounded = Math.round(value);
  if (rounded < DUCK_MIN_PCT) return DUCK_MIN_PCT;
  if (rounded > DUCK_MAX_PCT) return DUCK_MAX_PCT;
  return rounded;
}

/** Segundos a partir de los cuales se muestra el badge "Atrasado". */
export const BEHIND_THRESHOLD_SECS = 3;

export interface LiveEdgeAnchor {
  /** Posición consensuada (s) en el momento del ancla. */
  timeSecs: number;
  /** Date.now() (ms) cuando se conoció el consenso (remoteAction sentAt/timestamp). */
  atMs: number;
  /** true si el grupo estaba reproduciendo (el borde avanza con el reloj). */
  playing: boolean;
}

/**
 * Reconstruye el ancla del consenso grupal desde el `remoteAction` que ya
 * recibe el cliente (sync-video / room-state). `sentAt` compensa la latencia
 * de red; sin él se usa `timestamp` (recepción local).
 */
export function anchorFromRemoteAction(
  remoteAction: { currentTime: number; sentAt?: number; timestamp: number; action: 'play' | 'pause' | 'seek' } | null
): LiveEdgeAnchor | null {
  if (!remoteAction || !Number.isFinite(remoteAction.currentTime)) return null;
  const at = typeof remoteAction.sentAt === 'number' && Number.isFinite(remoteAction.sentAt)
    ? remoteAction.sentAt
    : remoteAction.timestamp;
  return {
    timeSecs: remoteAction.currentTime,
    atMs: at,
    playing: remoteAction.action === 'play',
  };
}

/** Borde en vivo estimado = consenso + tiempo transcurrido (si reproduce). */
export function resolveLiveEdge(anchor: LiveEdgeAnchor | null, nowMs: number): number | null {
  if (!anchor) return null;
  const elapsed = Math.max(0, (nowMs - anchor.atMs) / 1000);
  return anchor.timeSecs + (anchor.playing ? elapsed : 0);
}

/**
 * Segundos de retraso respecto al borde en vivo. Devuelve 0 cuando no hay
 * retraso relevante (<= umbral), cuando el local está pausado o sin datos.
 * Nunca negativo.
 */
export function behindSeconds(
  liveEdgeSecs: number | null,
  localTimeSecs: number,
  localPlaying: boolean
): number {
  if (liveEdgeSecs === null || !localPlaying) return 0;
  if (!Number.isFinite(localTimeSecs) || !Number.isFinite(liveEdgeSecs)) return 0;
  const behind = liveEdgeSecs - localTimeSecs;
  if (!(behind > BEHIND_THRESHOLD_SECS)) return 0;
  return behind;
}

/** Intervalo del heartbeat de posición: 15 s en ahorro, 5 s normal. */
export function heartbeatIntervalMs(dataSaver: boolean): number {
  return dataSaver ? 15000 : 5000;
}
