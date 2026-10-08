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
