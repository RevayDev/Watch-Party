/**
 * Calidad de conexión WebRTC (puro/testeable): con mala señal se prefiere
 * degradar a solo-audio antes que dejar caer la llamada (estilo WhatsApp).
 */

/** Umbrales: a partir de aquí la red se considera pobre. */
export const POOR_RTT_MS = 800;
export const POOR_LOSS_PCT = 10;
/** Muestras pobres seguidas para entrar en modo ahorro; buenas para salir. */
export const POOR_STREAK_TO_ENTER = 2;
export const GOOD_STREAK_TO_EXIT = 3;
/** Reintentos de ICE restart antes de soltar al peer. */
export const MAX_ICE_RESTARTS = 3;

export interface QualitySample {
  rttMs: number | null;
  audioLossPct: number | null;
  videoLossPct: number | null;
}

function isPoorSample(s: QualitySample): boolean {
  if (s.rttMs !== null && s.rttMs > POOR_RTT_MS) return true;
  if (s.audioLossPct !== null && s.audioLossPct > POOR_LOSS_PCT) return true;
  if (s.videoLossPct !== null && s.videoLossPct > POOR_LOSS_PCT) return true;
  return false;
}

/**
 * Decide el modo con histéresis sobre las últimas muestras (las más
 * recientes al final). Evita parpadeos entrando/saliendo del modo ahorro.
 */
export function assessQuality(
  samples: QualitySample[],
  current: 'good' | 'poor' = 'good'
): 'good' | 'poor' {
  const tail = samples.slice(-Math.max(GOOD_STREAK_TO_EXIT, POOR_STREAK_TO_ENTER));
  if (tail.length === 0) return current;
  const poorTail = tail.slice(-POOR_STREAK_TO_ENTER);
  if (poorTail.length === POOR_STREAK_TO_ENTER && poorTail.every(isPoorSample)) {
    return 'poor';
  }
  const goodTail = tail.slice(-GOOD_STREAK_TO_EXIT);
  if (goodTail.length === GOOD_STREAK_TO_EXIT && goodTail.every((s) => !isPoorSample(s))) {
    return 'good';
  }
  return current;
}

/** Backoff con tope para reintentos de ICE restart (ms). */
export function nextRestartDelayMs(attempt: number): number {
  const capped = Math.min(Math.max(0, attempt), 4);
  return Math.min(2000 * 2 ** capped, 15000);
}

/**
 * Escalera de calidad (WhatsApp-style): ante mala señal se baja de a un
 * escalón por evaluación (bitrate → resolución → solo audio) y se sube
 * igual de gradual al recuperarse. Nunca se corta de golpe.
 *
 * 0 = normal · 1 = bitrate cap 300kbps · 2 = 320x240@15fps + 120kbps ·
 * 3 = solo audio (video pausado, la llamada sigue).
 */
export type QualityLevel = 0 | 1 | 2 | 3;

export const MAX_QUALITY_LEVEL: QualityLevel = 3;

export interface LevelConfig {
  maxBitrateBps: number | null;
  captureWidth: number | null;
  captureHeight: number | null;
  captureFrameRate: number | null;
  videoEnabled: boolean;
}

export const QUALITY_LADDER: Record<QualityLevel, LevelConfig> = {
  0: { maxBitrateBps: 800_000, captureWidth: 640, captureHeight: 480, captureFrameRate: 30, videoEnabled: true },
  1: { maxBitrateBps: 300_000, captureWidth: 640, captureHeight: 480, captureFrameRate: 30, videoEnabled: true },
  2: { maxBitrateBps: 120_000, captureWidth: 320, captureHeight: 240, captureFrameRate: 15, videoEnabled: true },
  3: { maxBitrateBps: null, captureWidth: null, captureHeight: null, captureFrameRate: null, videoEnabled: false },
};

/** Un escalón por vez según el veredicto (la histéresis ya la da assessQuality). */
export function stepLevel(current: QualityLevel, verdict: 'good' | 'poor'): QualityLevel {
  if (verdict === 'poor') return Math.min(MAX_QUALITY_LEVEL, current + 1) as QualityLevel;
  return Math.max(0, current - 1) as QualityLevel;
}

interface FakeStatsReport {
  type: string;
  kind?: string;
  nominated?: boolean;
  currentRoundTripTime?: number;
  packetsLost?: number;
  packetsReceived?: number;
}

interface StatsCapable {
  getStats(): Promise<unknown>;
}

/**
 * Lee una muestra desde `RTCPeerConnection.getStats()`. Acepta el
 * RTCStatsReport real (forEach), un Map o un array (testeable con fakes).
 * `null` si no hay datos útiles.
 */
export async function collectPeerSample(pc: StatsCapable): Promise<QualitySample | null> {
  let report: Iterable<FakeStatsReport>;
  try {
    const raw: unknown = await pc.getStats();
    if (Array.isArray(raw)) {
      report = raw as FakeStatsReport[];
    } else if (raw instanceof Map) {
      report = (raw as Map<string, FakeStatsReport>).values();
    } else if (
      raw &&
      typeof (raw as { forEach?: unknown }).forEach === 'function'
    ) {
      const items: FakeStatsReport[] = [];
      (raw as { forEach(cb: (value: FakeStatsReport) => void): void }).forEach((v) => {
        items.push(v);
      });
      report = items;
    } else {
      return null;
    }
  } catch {
    return null;
  }
  let rttMs: number | null = null;
  let audioLossPct: number | null = null;
  let videoLossPct: number | null = null;
  for (const s of report) {
    if (s.type === 'candidate-pair' && (s.nominated ?? false) && typeof s.currentRoundTripTime === 'number') {
      rttMs = s.currentRoundTripTime * 1000;
    }
    if (s.type === 'inbound-rtp' && typeof s.packetsLost === 'number' && typeof s.packetsReceived === 'number') {
      const total = s.packetsLost + s.packetsReceived;
      const pct = total > 0 ? (s.packetsLost / total) * 100 : null;
      if (s.kind === 'audio') audioLossPct = pct;
      else if (s.kind === 'video') videoLossPct = pct;
    }
  }
  if (rttMs === null && audioLossPct === null && videoLossPct === null) return null;
  return { rttMs, audioLossPct, videoLossPct };
}

/* ── Señal por peer remoto (Rol A) ──────────────────────────────────────
 * El monitor propio (assessQuality/stepLevel) degrada la cámara LOCAL.
 * Este segundo veredicto es por PEER REMOTO y solo afecta a su tile en
 * CameraGrid: `weak` → avatar + "señal débil"; `critical` → además se
 * oculta su <video> (audio-only en recepción; su <audio> nunca se toca).
 * La película principal jamás se ve afectada por ninguno de los dos.
 */

/** Sin frames entrantes durante este tiempo el remoto cuenta como congelado. */
export const REMOTE_FROZEN_AFTER_MS = 6000;
/** Pérdida de video (%) para marcar débil / crítica en recepción. */
export const WEAK_VIDEO_LOSS_PCT = 5;
export const CRITICAL_VIDEO_LOSS_PCT = 15;
/** Jitter de video (ms) para marcar débil / crítica en recepción. */
export const WEAK_JITTER_MS = 300;
export const CRITICAL_JITTER_MS = 600;

export interface PeerSignalState {
  weak: boolean;
  critical: boolean;
  frozen: boolean;
}

export interface PeerSignalInput {
  videoLossPct: number | null;
  jitterMs: number | null;
  frozen: boolean;
}

/**
 * Veredicto puro por peer remoto. `frozen` (frames que no avanzan) siempre
 * es crítico; si no, mandan los umbrales de pérdida/jitter de video.
 */
export function assessPeerSignal(input: PeerSignalInput): PeerSignalState {
  const { videoLossPct, jitterMs, frozen } = input;
  const critical =
    frozen === true ||
    (videoLossPct !== null && videoLossPct > CRITICAL_VIDEO_LOSS_PCT) ||
    (jitterMs !== null && jitterMs > CRITICAL_JITTER_MS);
  const weak =
    critical ||
    (videoLossPct !== null && videoLossPct > WEAK_VIDEO_LOSS_PCT) ||
    (jitterMs !== null && jitterMs > WEAK_JITTER_MS);
  return { weak, critical, frozen };
}

export interface PeerReception {
  videoLossPct: number | null;
  jitterMs: number | null;
  framesReceived: number | null;
}

interface ReceptionStatsReport {
  type: string;
  kind?: string;
  packetsLost?: number;
  packetsReceived?: number;
  jitter?: number;
  framesReceived?: number;
}

/**
 * Lee la recepción de video desde `RTCPeerConnection.getStats()`. Acepta el
 * RTCStatsReport real (forEach), un Map o un array (testeable con fakes).
 * `null` si no hay datos útiles de video.
 */
export async function collectPeerReception(pc: StatsCapable): Promise<PeerReception | null> {
  let report: Iterable<ReceptionStatsReport>;
  try {
    const raw: unknown = await pc.getStats();
    if (Array.isArray(raw)) {
      report = raw as ReceptionStatsReport[];
    } else if (raw instanceof Map) {
      report = (raw as Map<string, ReceptionStatsReport>).values();
    } else if (
      raw &&
      typeof (raw as { forEach?: unknown }).forEach === 'function'
    ) {
      const items: ReceptionStatsReport[] = [];
      (raw as { forEach(cb: (value: ReceptionStatsReport) => void): void }).forEach((v) => {
        items.push(v);
      });
      report = items;
    } else {
      return null;
    }
  } catch {
    return null;
  }
  let videoLossPct: number | null = null;
  let jitterMs: number | null = null;
  let framesReceived: number | null = null;
  for (const s of report) {
    if (s.type === 'inbound-rtp' && (s.kind === 'video' || s.kind === undefined)) {
      if (typeof s.packetsLost === 'number' && typeof s.packetsReceived === 'number') {
        const total = s.packetsLost + s.packetsReceived;
        if (total > 0) videoLossPct = (s.packetsLost / total) * 100;
      }
      // jitter de WebRTC viene en segundos → ms.
      if (typeof s.jitter === 'number') jitterMs = s.jitter * 1000;
      if (typeof s.framesReceived === 'number') framesReceived = s.framesReceived;
    }
  }
  if (videoLossPct === null && jitterMs === null && framesReceived === null) return null;
  return { videoLossPct, jitterMs, framesReceived };
}
