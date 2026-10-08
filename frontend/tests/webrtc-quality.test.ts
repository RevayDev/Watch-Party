import { describe, it, expect } from 'vitest';
import {
  assessQuality,
  assessPeerSignal,
  collectPeerSample,
  collectPeerReception,
  nextRestartDelayMs,
  stepLevel,
  QUALITY_LADDER,
  MAX_QUALITY_LEVEL,
  POOR_RTT_MS,
  MAX_ICE_RESTARTS,
  REMOTE_FROZEN_AFTER_MS,
  type QualitySample,
} from '../src/shared/webrtc-quality';

const good = (rtt = 120): QualitySample => ({ rttMs: rtt, audioLossPct: 0, videoLossPct: 1 });
const poor = (rtt = POOR_RTT_MS + 100): QualitySample => ({ rttMs: rtt, audioLossPct: 2, videoLossPct: 3 });

describe('assessQuality: histéresis entrar/salir', () => {
  it('sin muestras conserva el veredicto actual', () => {
    expect(assessQuality([], 'good')).toBe('good');
    expect(assessQuality([], 'poor')).toBe('poor');
  });

  it('2 pobres seguidas entran en modo ahorro', () => {
    expect(assessQuality([good(), poor(), poor()], 'good')).toBe('poor');
  });

  it('1 sola pobre no alcanza (evita parpadeos)', () => {
    expect(assessQuality([good(), good(), poor()], 'good')).toBe('good');
  });

  it('pérdida alta de audio/video también dispara aunque el RTT esté bien', () => {
    const lossy: QualitySample = { rttMs: 100, audioLossPct: 25, videoLossPct: 0 };
    expect(assessQuality([good(), lossy, lossy], 'good')).toBe('poor');
  });

  it('salen 3 buenas seguidas', () => {
    expect(assessQuality([poor(), poor(), good(), good(), good()], 'poor')).toBe('good');
  });

  it('zona intermedia conserva el modo actual', () => {
    expect(assessQuality([poor(), poor(), good()], 'poor')).toBe('poor');
    expect(assessQuality([poor(), poor(), good()], 'good')).toBe('good');
  });
});

describe('nextRestartDelayMs: backoff con tope', () => {
  it('2s, 4s, 8s y tope en 15s', () => {
    expect(nextRestartDelayMs(0)).toBe(2000);
    expect(nextRestartDelayMs(1)).toBe(4000);
    expect(nextRestartDelayMs(2)).toBe(8000);
    expect(nextRestartDelayMs(3)).toBe(15000);
    expect(nextRestartDelayMs(99)).toBe(15000);
    expect(nextRestartDelayMs(-5)).toBe(2000);
  });

  it('el tope de reintentos es 3', () => {
    expect(MAX_ICE_RESTARTS).toBe(3);
  });
});

describe('stepLevel + QUALITY_LADDER: escalera gradual', () => {
  it('sube de a un escalón con mala señal y baja igual al recuperarse', () => {
    expect(stepLevel(0, 'poor')).toBe(1);
    expect(stepLevel(1, 'poor')).toBe(2);
    expect(stepLevel(2, 'poor')).toBe(3);
    expect(stepLevel(3, 'poor')).toBe(3);
    expect(stepLevel(3, 'good')).toBe(2);
    expect(stepLevel(1, 'good')).toBe(0);
    expect(stepLevel(0, 'good')).toBe(0);
  });

  it('la escalera degrada bitrate, resolución y al final solo audio', () => {
    expect(QUALITY_LADDER[0].maxBitrateBps).toBeGreaterThan(QUALITY_LADDER[1].maxBitrateBps!);
    expect(QUALITY_LADDER[1].maxBitrateBps).toBeGreaterThan(QUALITY_LADDER[2].maxBitrateBps!);
    expect(QUALITY_LADDER[2].captureWidth).toBeLessThan(QUALITY_LADDER[0].captureWidth!);
    expect(QUALITY_LADDER[MAX_QUALITY_LEVEL].videoEnabled).toBe(false);
    expect(QUALITY_LADDER[0].videoEnabled).toBe(true);
  });
});

describe('collectPeerSample: parseo de getStats', () => {
  function fakePc(reports: object[]) {
    return {
      getStats: async () => reports,
    };
  }

  it('lee RTT del par nominado y pérdidas por kind', async () => {
    const pc = fakePc([
      { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.25 },
      { type: 'candidate-pair', nominated: false, currentRoundTripTime: 9.99 },
      { type: 'inbound-rtp', kind: 'audio', packetsLost: 5, packetsReceived: 95 },
      { type: 'inbound-rtp', kind: 'video', packetsLost: 0, packetsReceived: 200 },
    ]);
    expect(await collectPeerSample(pc)).toEqual({
      rttMs: 250,
      audioLossPct: 5,
      videoLossPct: 0,
    });
  });

  it('null sin datos útiles o si getStats falla', async () => {
    expect(await collectPeerSample(fakePc([]))).toBeNull();
    expect(
      await collectPeerSample({
        getStats: async () => {
          throw new Error('nope');
        },
      })
    ).toBeNull();
  });

  it('acepta el Map real de getStats', async () => {
    const pc = {
      getStats: async () =>
        new Map<string, object>([
          ['a', { type: 'candidate-pair', nominated: true, currentRoundTripTime: 1.5 }],
        ]),
    };
    expect(await collectPeerSample(pc)).toMatchObject({ rttMs: 1500 });
  });
});

describe('assessPeerSignal: veredicto por peer remoto', () => {
  it('señal sana no marca débil ni crítica', () => {
    expect(
      assessPeerSignal({ videoLossPct: 0, jitterMs: 20, frozen: false })
    ).toEqual({ weak: false, critical: false, frozen: false });
  });

  it('pérdida moderada marca débil sin llegar a crítica', () => {
    const s = assessPeerSignal({ videoLossPct: 8, jitterMs: 20, frozen: false });
    expect(s.weak).toBe(true);
    expect(s.critical).toBe(false);
  });

  it('pérdida alta marca crítica (y débil)', () => {
    const s = assessPeerSignal({ videoLossPct: 25, jitterMs: 20, frozen: false });
    expect(s).toMatchObject({ weak: true, critical: true });
  });

  it('jitter alto marca débil y muy alto marca crítica', () => {
    expect(assessPeerSignal({ videoLossPct: 0, jitterMs: 400, frozen: false }).weak).toBe(true);
    expect(assessPeerSignal({ videoLossPct: 0, jitterMs: 900, frozen: false }).critical).toBe(true);
  });

  it('frame congelado siempre es crítico', () => {
    expect(assessPeerSignal({ videoLossPct: 0, jitterMs: 10, frozen: true })).toEqual({
      weak: true,
      critical: true,
      frozen: true,
    });
  });
});

describe('collectPeerReception: parseo de recepción de video', () => {
  it('lee pérdida, jitter (s→ms) y frames del inbound-rtp de video', async () => {
    const pc = {
      getStats: async () => [
        { type: 'inbound-rtp', kind: 'video', packetsLost: 10, packetsReceived: 90, jitter: 0.12, framesReceived: 1234 },
        { type: 'inbound-rtp', kind: 'audio', packetsLost: 99, packetsReceived: 1 },
      ],
    };
    expect(await collectPeerReception(pc)).toEqual({
      videoLossPct: 10,
      jitterMs: 120,
      framesReceived: 1234,
    });
  });

  it('null sin datos útiles de video o si getStats falla', async () => {
    expect(await collectPeerReception({ getStats: async () => [] })).toBeNull();
    expect(
      await collectPeerReception({
        getStats: async () => {
          throw new Error('nope');
        },
      })
    ).toBeNull();
  });

  it('acepta el Map real y expone el umbral de congelado', async () => {
    expect(REMOTE_FROZEN_AFTER_MS).toBeGreaterThan(0);
    const pc = {
      getStats: async () =>
        new Map<string, object>([
          ['v', { type: 'inbound-rtp', kind: 'video', packetsLost: 0, packetsReceived: 100, framesReceived: 7 }],
        ]),
    };
    expect(await collectPeerReception(pc)).toMatchObject({ framesReceived: 7 });
  });
});
