// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyHostCommand, newHostRoom, readHostInvite, hostInvite, type HostSnapshot } from '../src/features/host-room/protocol';
import { HostSession } from '../src/features/host-room/HostSession';
import { webcrypto } from 'node:crypto';
import { setTimeout as realDelay } from 'node:timers/promises';

vi.mock('peerjs', async () => {
  const { EventEmitter } = await import('node:events');
  const peers = new Map<string, FakePeer>();
  let nextId = 0;
  class FakeConnection extends EventEmitter {
    open = false;
    dataChannel = { bufferedAmount: 0 };
    other?: FakeConnection;
    constructor(public peer: string) { super(); }
    send(data: unknown) {
      Promise.resolve().then(() => { if (this.other?.open) this.other.emit('data', structuredClone(data)); });
    }
    close() {
      if (!this.open) return;
      this.open = false;
      this.emit('close');
      this.other?.close();
    }
  }
  class FakePeer extends EventEmitter {
    id: string;
    open = false;
    disconnected = false;
    destroyed = false;
    edges: FakeConnection[] = [];
    constructor(input: unknown) {
      super();
      this.id = typeof input === 'string' ? input : `peer-${++nextId}`;
      Promise.resolve().then(() => {
        if (this.destroyed) return;
        if (peers.has(this.id)) { this.emit('error', { type: 'unavailable-id' }); return; }
        peers.set(this.id, this);
        this.open = true;
        this.emit('open', this.id);
      });
    }
    connect(targetId: string) {
      const local = new FakeConnection(targetId);
      this.edges.push(local);
      Promise.resolve().then(() => {
        const remotePeer = peers.get(targetId);
        if (!remotePeer) { this.emit('error', { type: 'peer-unavailable' }); return; }
        const remote = new FakeConnection(this.id);
        remotePeer.edges.push(remote);
        local.other = remote;
        remote.other = local;
        remotePeer.emit('connection', remote);
        local.open = true;
        remote.open = true;
        local.emit('open');
        remote.emit('open');
      });
      return local;
    }
    reconnect() {}
    destroy() {
      this.destroyed = true;
      this.open = false;
      if (peers.get(this.id) === this) peers.delete(this.id);
      this.edges.forEach((edge) => edge.close());
    }
  }
  return { default: FakePeer };
});

const sessions: HostSession[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  sessions.splice(0).forEach((session) => session.stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function start(name: string, create = false, key = 'secret') {
  const session = new HostSession({ roomId: 'room', key, name, create }, () => {}).start();
  sessions.push(session);
  return session;
}

async function settleUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await realDelay(2);
    await vi.advanceTimersByTimeAsync(25);
    if (predicate()) return;
  }
  expect(predicate()).toBe(true);
}

it('keeps chat and playback after a host leaves and admits another guest through the same room', async () => {
  const host = start('Ana', true);
  await vi.advanceTimersByTimeAsync(1);
  const guest = start('Beto');
  await settleUntil(() => guest.snapshot?.members.length === 2);
  host.command({ type: 'room-settings', settings: { name: 'Noche de cine', duckingLevel: 20, youtubeProvider: 'a'.repeat(64) } });
  guest.command({ type: 'chat', id: 'first', text: 'Antes del relevo' });
  host.command({ type: 'playback', action: 'pause', currentTime: 42 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(guest.snapshot?.messages[0].text).toBe('Antes del relevo');
  const signaling = vi.fn();
  host.on('webrtc-offer', signaling);
  await vi.advanceTimersByTimeAsync(10000);
  guest.emit('webrtc-offer', {
    targetSocketId: host.id,
    offer: { toJSON: () => ({ type: 'offer', sdp: 'test' }) },
    callerName: 'Spoofed',
  });
  await vi.advanceTimersByTimeAsync(100);
  await vi.waitFor(() => expect(signaling).toHaveBeenCalledWith(expect.objectContaining({
    senderSocketId: guest.id, callerName: 'Beto', offer: { type: 'offer', sdp: 'test' },
  })));
  host.stop();
  guest.command({ type: 'chat', id: 'in-flight', text: 'Mensaje durante la caída' });
  await vi.advanceTimersByTimeAsync(16_000);
  expect(guest.isHost).toBe(true);
  expect(guest.snapshot?.playback?.currentTime).toBe(42);
  expect(guest.snapshot?.messages[0].text).toBe('Antes del relevo');
  expect(guest.snapshot?.messages.filter((message) => message.id === 'in-flight')).toHaveLength(1);
  const newcomer = start('Carla');
  await settleUntil(() => newcomer.snapshot?.hostId === guest.id);
  expect(newcomer.snapshot?.messages[0].text).toBe('Antes del relevo');
  expect(newcomer.snapshot?.roomSettings).toEqual({ name: 'Noche de cine', duckingLevel: 20, youtubeProvider: 'a'.repeat(64) });
});

it('does not promote an uninvited browser or a guest when automatic migration is disabled', async () => {
  const host = start('Ana', true);
  await vi.advanceTimersByTimeAsync(1);
  const stranger = start('Intruso', false, 'wrong-key');
  const guest = start('Beto');
  await settleUntil(() => guest.snapshot?.members.length === 2);
  expect(stranger.snapshot).toBeNull();
  await vi.advanceTimersByTimeAsync(3000);
  host.command({ type: 'settings', automaticMigration: false, replicateVideo: true });
  await vi.waitFor(() => expect(guest.snapshot?.automaticMigration).toBe(false));
  host.stop();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(guest.isHost).toBe(false);
});

it('round trips a private invitation and rejects invalid room credentials', () => {
  const options = newHostRoom('Ana');
  expect(readHostInvite(hostInvite(options.roomId, options.key))).toEqual({ roomId: options.roomId, key: options.key });
  expect(readHostInvite('https://example.com/?hostRoom=bad#key=bad')).toBeNull();
});

it('reports a connection timeout instead of leaving an absent room loading forever', async () => {
  const update = vi.fn();
  const session = new HostSession({ roomId: 'missing-room', key: 'secret', name: 'Ana' }, update).start();
  sessions.push(session);
  await vi.advanceTimersByTimeAsync(22_000);
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
    state: null, status: 'No se pudo conectar con la sala', error: expect.stringContaining('tardando demasiado'),
  }));
});

it('allows members to chat while restricting video and server settings to the current host', () => {
  const state: HostSnapshot = {
    revision: 0, hostId: 'host', members: [{ id: 'host', name: 'Ana', joinedAt: 1 }, { id: 'guest', name: 'Beto', joinedAt: 2 }],
    messages: [], video: null, playback: null, automaticMigration: true, replicateVideo: true,
    musicQueue: [], musicNowPlaying: null,
  };
  expect(applyHostCommand(state, 'guest', { type: 'settings', automaticMigration: false, replicateVideo: false })).toBe(state);
  expect(applyHostCommand(state, 'outsider', { type: 'chat', id: 'x', text: 'Bad' })).toBe(state);
  const next = applyHostCommand(state, 'guest', { type: 'chat', id: 'x', text: 'Hola' });
  expect(next.messages[0].user).toBe('Beto');
  expect(applyHostCommand(next, 'guest', { type: 'chat', id: 'x', text: 'Hola' })).toBe(next);
  expect(applyHostCommand(next, 'host', { type: 'edit-chat', id: 'x', text: 'Impersonation' })).toBe(next);
  const edited = applyHostCommand(next, 'guest', { type: 'edit-chat', id: 'x', text: 'Hola de nuevo' });
  expect(edited.messages[0]).toMatchObject({ edited: true, text: 'Hola de nuevo' });
  const replied = applyHostCommand(edited, 'host', { type: 'chat', id: 'reply', text: 'Bienvenido', replyTo: 'x' });
  expect(replied.messages[1].replyTo).toEqual({ id: 'x', user: 'Beto', text: 'Hola de nuevo' });
});

it('replicates music queue changes and restricts playback to the current host', () => {
  const state = {
    revision: 0, hostId: 'host', members: [{ id: 'host', name: 'Ana', joinedAt: 1 }, { id: 'guest', name: 'Beto', joinedAt: 2 }],
    messages: [], video: null, playback: null, automaticMigration: true, replicateVideo: true,
    musicQueue: [], musicNowPlaying: null,
  } satisfies HostSnapshot;
  const queued = applyHostCommand(state, 'guest', { type: 'music-add', track: { id: 'PW6ZSzdjrlo', name: 'Video', artists: 'YouTube' } });
  expect(queued.musicQueue[0].proposedBy).toBe('Beto');
  expect(applyHostCommand(queued, 'guest', { type: 'music-next' })).toBe(queued);
  const playing = applyHostCommand(queued, 'host', { type: 'music-next' });
  expect(playing.musicNowPlaying?.trackId).toBe('PW6ZSzdjrlo');
  expect(playing.musicQueue).toHaveLength(0);
  const transferred = applyHostCommand(playing, 'host', { type: 'video', transferMusic: true, video: {
    id: 'main-video', name: 'Song', source: 'youtube', url: 'https://youtu.be/PW6ZSzdjrlo', size: 0, mime: 'video/youtube', startTime: 42,
  } });
  expect(transferred.musicNowPlaying).toBeNull();
  expect(transferred.video?.startTime).toBe(42);
  expect(applyHostCommand(transferred, 'guest', { type: 'clear-video' })).toBe(transferred);
  expect(applyHostCommand(transferred, 'host', { type: 'clear-video' }).video).toBeNull();
});

it('confirms voluntary server and ownership handoff before the current owner leaves, then passes it on again', async () => {
 const host = start('Ana', true);
 await vi.advanceTimersByTimeAsync(1);
 const guest = start('Beto');
 await settleUntil(() => guest.snapshot?.members.length === 2);
 const third = start('Caro');
 await settleUntil(() => third.snapshot?.members.length === 3 && guest.snapshot?.members.length === 3);
 host.command({ type: 'chat', id: 'preserved', text: 'Seguimos aquí' });
 await settleUntil(() => guest.snapshot?.messages.length === 1);
 let finished = false;
 const leaving = host.leaveGracefully().then(() => { finished = true; });
 expect(finished).toBe(false);
 await settleUntil(() => guest.isHost && finished);
 await leaving;
 expect(host.snapshot?.hostId).toBe(guest.id);
 expect(guest.snapshot?.messages[0].text).toBe('Seguimos aquí');
 host.stop();
 let nextFinished = false;
 const next = guest.leaveGracefully().then(() => { nextFinished = true; });
 await settleUntil(() => third.isHost && nextFinished);
 await next;
 expect(third.snapshot?.hostId).toBe(third.id);
 expect(third.snapshot?.messages[0].text).toBe('Seguimos aquí');
});
it('notifies guests when the host explicitly closes the room', async () => {
 const host = start('Ana', true); await vi.advanceTimersByTimeAsync(1);
 const guest = start('Beto'); await settleUntil(() => guest.snapshot?.members.length === 2);
 const closed = vi.fn(); guest.on('room-closed', closed);
 const closing = host.closeRoom();
 await settleUntil(() => closed.mock.calls.length === 1);
 await vi.advanceTimersByTimeAsync(400); await closing;
 expect(guest.connected).toBe(false);
});
