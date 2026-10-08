import { describe, it, expect } from 'vitest';
import {
  BEHIND_THRESHOLD_SECS,
  DUCK_DEFAULT_PCT,
  DUCK_MAX_PCT,
  DUCK_MIN_PCT,
  anchorFromRemoteAction,
  behindSeconds,
  clampDuckPct,
  heartbeatIntervalMs,
  resolveLiveEdge,
} from '../src/shared/perf';

describe('perf helpers (rol B)', () => {
  it('clampDuckPct sanea a 10–60 con default 30', () => {
    expect(clampDuckPct(undefined)).toBe(DUCK_DEFAULT_PCT);
    expect(clampDuckPct(null)).toBe(DUCK_DEFAULT_PCT);
    expect(clampDuckPct(NaN)).toBe(DUCK_DEFAULT_PCT);
    expect(clampDuckPct(30)).toBe(30);
    expect(clampDuckPct(10)).toBe(DUCK_MIN_PCT);
    expect(clampDuckPct(60)).toBe(DUCK_MAX_PCT);
    expect(clampDuckPct(5)).toBe(DUCK_MIN_PCT);
    expect(clampDuckPct(99)).toBe(DUCK_MAX_PCT);
    expect(clampDuckPct(27.4)).toBe(27);
  });

  it('anchorFromRemoteAction prefiere sentAt y detecta play/pause y seek con playing previo', () => {
    expect(anchorFromRemoteAction(null)).toBeNull();
    const play = anchorFromRemoteAction({ action: 'play', currentTime: 100, sentAt: 1000, timestamp: 1500 });
    expect(play).toMatchObject({ timeSecs: 100, atMs: 1000, playing: true });
    const pause = anchorFromRemoteAction({ action: 'pause', currentTime: 42, timestamp: 2000 });
    expect(pause).toMatchObject({ timeSecs: 42, atMs: 2000, playing: false });
    const seekPlaying = anchorFromRemoteAction({ action: 'seek', currentTime: 80, timestamp: 2500 }, true);
    expect(seekPlaying).toMatchObject({ timeSecs: 80, atMs: 2500, playing: true });
    const seekPaused = anchorFromRemoteAction({ action: 'seek', currentTime: 80, timestamp: 2500 }, false);
    expect(seekPaused).toMatchObject({ timeSecs: 80, atMs: 2500, playing: false });
  });

  it('resolveLiveEdge avanza el borde solo si el grupo reproduce', () => {
    expect(resolveLiveEdge(null, 5000)).toBeNull();
    // play: 100 s + 10 s transcurridos
    expect(resolveLiveEdge({ timeSecs: 100, atMs: 1000, playing: true }, 11000)).toBeCloseTo(110);
    // pause: borde congelado
    expect(resolveLiveEdge({ timeSecs: 100, atMs: 1000, playing: false }, 11000)).toBe(100);
  });

  it('behindSeconds respeta el umbral de 3 s y el estado local', () => {
    expect(BEHIND_THRESHOLD_SECS).toBe(3);
    expect(behindSeconds(110, 100, true)).toBeCloseTo(10);
    expect(behindSeconds(102, 100, true)).toBe(0);
    expect(behindSeconds(103, 100, true)).toBe(0);
    expect(behindSeconds(110, 100, false)).toBe(0);
    expect(behindSeconds(null, 100, true)).toBe(0);
    expect(behindSeconds(90, 100, true)).toBe(0);
  });

  it('heartbeatIntervalMs: 15 s en ahorro, 5 s normal', () => {
    expect(heartbeatIntervalMs(true)).toBe(15000);
    expect(heartbeatIntervalMs(false)).toBe(5000);
  });
});
