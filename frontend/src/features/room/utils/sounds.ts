/** Audio helpers (Web Audio API) — movidos verbatim desde pages/Room.tsx. */
export function playJoinSound() {
  try {
    const ctx = new AudioContext();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    g.connect(ctx.destination);
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(880, ctx.currentTime);
    o1.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.18);
    o1.connect(g);
    o1.start();
    o1.stop(ctx.currentTime + 0.55);
    setTimeout(() => ctx.close(), 700);
  } catch (_) {}
}

export function playLeaveSound() {
  try {
    const ctx = new AudioContext();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    g.connect(ctx.destination);
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(660, ctx.currentTime);
    o1.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.35);
    o1.connect(g);
    o1.start();
    o1.stop(ctx.currentTime + 0.55);
    setTimeout(() => ctx.close(), 700);
  } catch (_) {}
}

export function playChatSound() {
  try {
    const ctx = new AudioContext();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    g.connect(ctx.destination);
    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    o1.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08); // E5
    o1.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16); // G5
    o1.connect(g);
    o1.start();
    o1.stop(ctx.currentTime + 0.35);
    setTimeout(() => ctx.close(), 500);
  } catch (_) {}
}
