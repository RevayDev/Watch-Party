import { z } from 'zod';

export const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
export const MAX_HOST_MEMBERS = 8;
export const CHUNK_BYTES = 8 * 1024;
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(50);
const roomSettingsSchema = z.object({
  youtubeProvider: z.string().regex(/^(?:[a-f0-9]{64})?$/).optional(),
  name: z.string().max(60).optional(), description: z.string().max(240).optional(),
  dataSaver: z.boolean().optional(), fullscreenToasts: z.boolean().optional(), reactionsEnabled: z.boolean().optional(),
  visualEffects: z.boolean().optional(), duckingEnabled: z.boolean().optional(), duckingLevel: z.number().min(10).max(60).optional(),
});
export const memberSchema = z.object({ id, name, joinedAt: z.number().finite() });
export const videoSchema = z.object({
  startTime: z.number().finite().nonnegative().optional(),
  id, name: z.string().min(1).max(200), source: z.enum(['file', 'youtube', 'url']),
  url: z.string().max(2048).optional(), size: z.number().int().min(0).max(MAX_VIDEO_BYTES), mime: z.string().max(100),
});
const musicTrackSchema = z.object({
  id, name: z.string().min(1).max(200), artists: z.string().max(200),
  albumArt: z.string().max(2048).optional(), durationMs: z.number().finite().nonnegative().optional(),
  uri: z.string().max(2048).optional(), openUrl: z.string().max(2048).optional(),
});
const musicEntrySchema = musicTrackSchema.omit({ id: true }).extend({
  id, trackId: id, proposedBy: name, proposedByUserId: id.optional(),
  status: z.enum(['queued', 'pending']), votes: z.array(id).max(MAX_HOST_MEMBERS), createdAt: z.string(),
});
const musicSearchSchema = z.object({ id, query: z.string().max(100), tracks: z.array(musicTrackSchema).max(12).nullable() });
const musicPlayingSchema = musicTrackSchema.omit({ id: true, durationMs: true }).extend({
  playback: z.object({ currentTime: z.number().finite().nonnegative(), playing: z.boolean(), sentAt: z.number().finite(), awaitingReady: z.boolean().optional() }).optional(),
  readyMembers: z.array(id).optional(),
  entryId: id, trackId: id, proposedBy: name.optional(), proposedByUserId: id.optional(),
  startedAt: z.string(), startedBy: name,
});
export const snapshotSchema = z.object({
  videoReady: z.array(id).optional(),
  cinematic: z.object({ id, quotes: z.tuple([z.string(), z.string(), z.string()]), skipped: z.boolean().optional() }).optional(),
  musicSearch: musicSearchSchema.optional(),
  revision: z.number().int().nonnegative(), hostId: id,
  members: z.array(memberSchema).max(MAX_HOST_MEMBERS),
  readReceipts: z.record(z.string(), z.object({ readerId: id, userName: name, messageId: id })).optional(),
  messages: z.array(z.object({
    deleted: z.boolean().optional(), reactions: z.array(z.object({ userId: id, userName: name, emoji: z.string().max(20) })).max(100).optional(),
    id, authorId: id, user: name, text: z.string().max(2000), timestamp: z.string().max(30), edited: z.boolean().optional(),
    replyTo: z.object({ id, user: name, text: z.string().max(200) }).optional(),
  })).max(300),
  video: videoSchema.nullable(),
  playback: z.object({
    awaitingReady: z.boolean().optional(),
    isPlaying: z.boolean().optional(),
    action: z.enum(['play', 'pause', 'seek']), currentTime: z.number().finite().nonnegative(),
    sentAt: z.number().finite(), timestamp: z.number().finite(),
  }).nullable(),
  automaticMigration: z.boolean(), replicateVideo: z.boolean(),
  roomSettings: roomSettingsSchema.optional(),
  musicQueue: z.array(musicEntrySchema).max(40).default([]),
  musicNowPlaying: musicPlayingSchema.nullable().default(null),
});
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('video-ready'), videoId: id }),
  z.object({ type: z.literal('music-ready'), entryId: id }),
  z.object({ type: z.literal('cinematic'), id, quotes: z.tuple([z.string().max(200), z.string().max(200), z.string().max(200)]) }),
  z.object({ type: z.literal('cinematic-skip'), id }),
  z.object({ type: z.literal('music-search'), search: musicSearchSchema }),
  z.object({ type: z.literal('music-playback'), entryId: id, currentTime: z.number().finite().nonnegative(), playing: z.boolean() }),
  z.object({ type: z.literal('room-settings'), settings: roomSettingsSchema }),
  z.object({ type: z.literal('chat-delete'), id }),
  z.object({ type: z.literal('chat-react'), id, emoji: z.enum(['❤️','😂','😮','👏','😢','🔥']) }),
  z.object({ type: z.literal('chat-read'), messageId: id }),
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(2000), id, replyTo: id.optional() }),
  z.object({ type: z.literal('edit-chat'), text: z.string().trim().min(1).max(2000), id }),
  z.object({ type: z.literal('video'), video: videoSchema, transferMusic: z.boolean().optional() }),
  z.object({ type: z.literal('clear-video') }),
  z.object({ type: z.literal('playback'), action: z.enum(['play', 'pause', 'seek']), currentTime: z.number().finite().nonnegative() }),
  z.object({ type: z.literal('settings'), automaticMigration: z.boolean(), replicateVideo: z.boolean() }),
  z.object({ type: z.literal('music-add'), track: musicTrackSchema }),
  z.object({ type: z.literal('music-remove'), id }),
  z.object({ type: z.literal('music-reorder'), ids: z.array(id).max(40) }),
  z.object({ type: z.literal('music-next') }),
  z.object({ type: z.literal('music-stop') }),
]);
export const envelopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('clock-ping'), sent: z.number().finite() }),
  z.object({ type: z.literal('clock-pong'), sent: z.number().finite(), server: z.number().finite() }),
  z.object({ type: z.literal('handoff'), targetId: id }),
  z.object({ type: z.literal('room-closed') }),
  z.object({ type: z.literal('hello'), proof: z.string().regex(/^[a-f0-9]{64}$/), member: memberSchema }),
  z.object({ type: z.literal('snapshot'), state: snapshotSchema }),
  z.object({ type: z.literal('command'), command: commandSchema }),
  z.object({ type: z.literal('signal'), event: z.enum(['webrtc-offer', 'webrtc-answer', 'webrtc-ice-candidate', 'peer-media-state', 'reaction']), payload: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('file-request'), videoId: id }),
  z.object({ type: z.literal('file-start'), video: videoSchema }),
  z.object({ type: z.literal('file-chunk'), videoId: id, index: z.number().int().nonnegative(), data: z.instanceof(ArrayBuffer) }),
  z.object({ type: z.literal('file-end'), videoId: id, digest: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({ type: z.literal('file-ready'), videoId: id }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('error'), message: z.string().max(300) }),
]);
export type HostMember = z.infer<typeof memberSchema>;
export type HostVideo = z.infer<typeof videoSchema>;
export type HostSnapshot = z.infer<typeof snapshotSchema>;
export type HostCommand = z.infer<typeof commandSchema>;
export type HostEnvelope = z.infer<typeof envelopeSchema>;
export interface HostRoomOptions { roomId: string; key: string; name: string; create?: boolean }

export function hostInvite(roomId: string, key: string): string {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('hostRoom', roomId);
  url.hash = new URLSearchParams({ key }).toString();
  return url.href;
}

export function readHostInvite(url: string): { roomId: string; key: string } | null {
  try {
    const parsed = new URL(url);
    const roomId = parsed.searchParams.get('hostRoom');
    const key = new URLSearchParams(parsed.hash.slice(1)).get('key');
    return roomId && /^[a-f0-9]{8}$/.test(roomId) && key && /^[a-f0-9]{64}$/.test(key) ? { roomId, key } : null;
  } catch { return null; }
}

export function newHostRoom(name: string): HostRoomOptions {
  const random = (length: number) => [...crypto.getRandomValues(new Uint8Array(length))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { roomId: random(4), key: random(32), name, create: true };
}

export function applyHostCommand(state: HostSnapshot, senderId: string, command: HostCommand): HostSnapshot {
  const member = state.members.find((candidate) => candidate.id === senderId);
  const memberAction = ['video-ready', 'music-ready', 'cinematic', 'cinematic-skip'].includes(command.type) || command.type === 'music-search' || command.type === 'playback' || command.type === 'music-playback' || command.type === 'chat-delete' || command.type === 'chat-react' || command.type === 'chat-read' || command.type === 'chat' || command.type === 'edit-chat' || command.type === 'music-add' || command.type === 'music-remove';
  if (!member || (!memberAction && senderId !== state.hostId)) return state;
  switch (command.type) {
    case 'cinematic':
      if (state.cinematic && !state.cinematic.skipped) return state;
      return { ...state, revision: state.revision + 1, cinematic: { id: command.id, quotes: command.quotes } };
    case 'cinematic-skip':
      if (state.cinematic?.id !== command.id) return state;
      return { ...state, revision: state.revision + 1, cinematic: { ...state.cinematic, skipped: true } };
    case 'video-ready': {
      if (state.video?.id !== command.videoId || !state.playback?.awaitingReady) return state;
      const ready = [...new Set([...(state.videoReady ?? []), senderId])];
      const all = state.members.every(member => ready.includes(member.id));
      return { ...state, revision: state.revision + 1, videoReady: ready, playback: all
        ? { action: 'play', isPlaying: true, currentTime: state.video.startTime ?? 0, sentAt: Date.now() + 1200, timestamp: Math.max(Date.now(), state.playback.timestamp + 1) }
        : state.playback };
    }
    case 'music-ready': {
      const music = state.musicNowPlaying;
      if (music?.entryId !== command.entryId || !music.playback?.awaitingReady) return state;
      const ready = [...new Set([...(music.readyMembers ?? []), senderId])];
      const all = state.members.every(member => ready.includes(member.id));
      return { ...state, revision: state.revision + 1, musicNowPlaying: { ...music, readyMembers: ready,
        playback: all ? { currentTime: 0, playing: true, sentAt: Date.now() + 1200 } : music.playback } };
    }
    case 'music-search':
      return { ...state, revision: state.revision + 1, musicSearch: command.search };
    case 'music-playback':
      if (state.musicNowPlaying?.entryId !== command.entryId) return state;
      if (state.musicNowPlaying.playback?.awaitingReady) return state;
      return { ...state, revision: state.revision + 1, musicNowPlaying: { ...state.musicNowPlaying, playback: { currentTime: command.currentTime, playing: command.playing, sentAt: Date.now() } } };
    case 'room-settings':
      return { ...state, revision: state.revision + 1, roomSettings: { ...state.roomSettings, ...command.settings } };
    case 'chat-read': {
      const index = state.messages.findIndex(message => message.id === command.messageId);
      const previous = state.messages.findIndex(message => message.id === state.readReceipts?.[senderId]?.messageId);
      if (index < 0 || index <= previous) return state;
      const readReceipts = { ...state.readReceipts, [senderId]: { readerId: senderId, userName: member.name, messageId: command.messageId } };
      const readers = Object.keys(readReceipts); if (readers.length > 100) delete readReceipts[readers[0]];
      return { ...state, revision: state.revision + 1, readReceipts };
    }
    case 'chat': {
      if (state.messages.some((message) => message.id === command.id)) return state;
      const reply = state.messages.find((message) => message.id === command.replyTo);
      return { ...state, revision: state.revision + 1, messages: [...state.messages, {
        id: command.id, authorId: member.id, user: member.name, text: command.text,
        timestamp: new Date().toISOString(),
        ...(reply ? { replyTo: { id: reply.id, user: reply.user, text: reply.deleted ? 'Mensaje eliminado' : reply.text.slice(0, 200) } } : {}),
      }].slice(-300) };
    }
    case 'chat-delete': {
      if (!state.messages.some(message => message.id === command.id && message.authorId === senderId && !message.deleted)) return state;
      return { ...state, revision: state.revision + 1, messages: state.messages.map(message => message.id === command.id ? { ...message, deleted: true, text: '', reactions: [] } : message.replyTo?.id === command.id ? { ...message, replyTo: { ...message.replyTo, text: 'Mensaje eliminado' } } : message) };
    }
    case 'chat-react': {
      const target = state.messages.find(message => message.id === command.id && !message.deleted);
      if (!target) return state;
      const previous = target.reactions?.find(reaction => reaction.userId === senderId);
      const reactions = (target.reactions ?? []).filter(reaction => reaction.userId !== senderId);
      if (previous?.emoji !== command.emoji) reactions.push({ userId: senderId, userName: member.name, emoji: command.emoji });
      return { ...state, revision: state.revision + 1, messages: state.messages.map(message => message.id === target.id ? { ...message, reactions: reactions.slice(-100) } : message) };
    }
    case 'edit-chat':
      if (!state.messages.some((message) => message.id === command.id && message.authorId === senderId && !message.deleted)) return state;
      return { ...state, revision: state.revision + 1, messages: state.messages.map((message) =>
        message.id === command.id ? { ...message, text: command.text, edited: true } : message) };
    case 'clear-video':
      return { ...state, revision: state.revision + 1, video: null, playback: null };
    case 'video':
      return { ...state, revision: state.revision + 1, video: command.video, videoReady: [], playback: { action: 'pause', isPlaying: false, awaitingReady: true, currentTime: command.video.startTime ?? 0, sentAt: Date.now(), timestamp: Date.now() }, ...(command.transferMusic ? { musicNowPlaying: null } : {}) };
    case 'settings':
      return { ...state, revision: state.revision + 1, automaticMigration: command.automaticMigration, replicateVideo: command.replicateVideo };
    case 'playback':
      if (state.playback?.awaitingReady) return state;
      return { ...state, revision: state.revision + 1, playback: { action: command.action, isPlaying: command.action === 'seek' ? (state.playback?.isPlaying ?? state.playback?.action === 'play') : command.action === 'play', currentTime: command.currentTime, sentAt: Date.now(), timestamp: Math.max(Date.now(), (state.playback?.timestamp ?? 0) + 1) } };
    case 'music-add': {
      if (state.musicQueue.length >= 40 || state.musicQueue.some((entry) => entry.trackId === command.track.id)) return state;
      const entry = {
        ...command.track, id: crypto.randomUUID(), trackId: command.track.id,
        proposedBy: member.name, proposedByUserId: member.id, status: 'queued' as const,
        votes: [], createdAt: new Date().toISOString(),
      };
      return { ...state, revision: state.revision + 1, musicQueue: [...state.musicQueue, entry] };
    }
    case 'music-remove':
      return { ...state, revision: state.revision + 1, musicQueue: state.musicQueue.filter((entry) =>
        entry.id !== command.id || (senderId !== state.hostId && entry.proposedByUserId !== senderId)) };
    case 'music-reorder': {
      if (command.ids.length !== state.musicQueue.length || new Set(command.ids).size !== command.ids.length ||
        command.ids.some((entryId) => !state.musicQueue.some((entry) => entry.id === entryId))) return state;
      const indices = new Map(command.ids.map((entryId, index) => [entryId, index]));
      return { ...state, revision: state.revision + 1, musicQueue: [...state.musicQueue].sort((a, b) => indices.get(a.id)! - indices.get(b.id)!) };
    }
    case 'music-next': {
      const [next, ...queue] = state.musicQueue;
      return { ...state, revision: state.revision + 1, musicQueue: queue, musicNowPlaying: next ? {
        ...next, entryId: next.id, startedAt: new Date().toISOString(), startedBy: member.name,
        playback: { currentTime: 0, playing: false, sentAt: Date.now(), awaitingReady: true }, readyMembers: [],
      } : null };
    }
    case 'music-stop':
      return { ...state, revision: state.revision + 1, musicNowPlaying: null };
  }
}

