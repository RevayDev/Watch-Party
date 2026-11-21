import { z } from 'zod';

export const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
export const MAX_HOST_MEMBERS = 8;
export const CHUNK_BYTES = 8 * 1024;
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(50);
export const memberSchema = z.object({ id, name, joinedAt: z.number().finite() });
export const videoSchema = z.object({
  id, name: z.string().min(1).max(200), source: z.enum(['file', 'youtube', 'url']),
  url: z.string().max(2048).optional(), size: z.number().int().min(0).max(MAX_VIDEO_BYTES), mime: z.string().max(100),
});
export const snapshotSchema = z.object({
  revision: z.number().int().nonnegative(), hostId: id,
  members: z.array(memberSchema).max(MAX_HOST_MEMBERS),
  messages: z.array(z.object({
    id, authorId: id, user: name, text: z.string().max(2000), timestamp: z.string().max(30), edited: z.boolean().optional(),
    replyTo: z.object({ id, user: name, text: z.string().max(200) }).optional(),
  })).max(300),
  video: videoSchema.nullable(),
  playback: z.object({
    action: z.enum(['play', 'pause', 'seek']), currentTime: z.number().finite().nonnegative(),
    sentAt: z.number().finite(), timestamp: z.number().finite(),
  }).nullable(),
  automaticMigration: z.boolean(), replicateVideo: z.boolean(),
});
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(2000), id, replyTo: id.optional() }),
  z.object({ type: z.literal('edit-chat'), text: z.string().trim().min(1).max(2000), id }),
  z.object({ type: z.literal('video'), video: videoSchema }),
  z.object({ type: z.literal('playback'), action: z.enum(['play', 'pause', 'seek']), currentTime: z.number().finite().nonnegative() }),
  z.object({ type: z.literal('settings'), automaticMigration: z.boolean(), replicateVideo: z.boolean() }),
]);
export const envelopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), proof: z.string().regex(/^[a-f0-9]{64}$/), member: memberSchema }),
  z.object({ type: z.literal('snapshot'), state: snapshotSchema }),
  z.object({ type: z.literal('command'), command: commandSchema }),
  z.object({ type: z.literal('signal'), event: z.enum(['webrtc-offer', 'webrtc-answer', 'webrtc-ice-candidate', 'peer-media-state']), payload: z.record(z.string(), z.unknown()) }),
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
    return roomId && /^[a-f0-9]{24}$/.test(roomId) && key && /^[a-f0-9]{64}$/.test(key) ? { roomId, key } : null;
  } catch { return null; }
}

export function newHostRoom(name: string): HostRoomOptions {
  const random = (length: number) => [...crypto.getRandomValues(new Uint8Array(length))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { roomId: random(12), key: random(32), name, create: true };
}

export function applyHostCommand(state: HostSnapshot, senderId: string, command: HostCommand): HostSnapshot {
  const member = state.members.find((candidate) => candidate.id === senderId);
  if (!member || (command.type !== 'chat' && command.type !== 'edit-chat' && senderId !== state.hostId)) return state;
  switch (command.type) {
    case 'chat': {
      if (state.messages.some((message) => message.id === command.id)) return state;
      const reply = state.messages.find((message) => message.id === command.replyTo);
      return { ...state, revision: state.revision + 1, messages: [...state.messages, {
        id: command.id, authorId: member.id, user: member.name, text: command.text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        ...(reply ? { replyTo: { id: reply.id, user: reply.user, text: reply.text.slice(0, 200) } } : {}),
      }].slice(-300) };
    }
    case 'edit-chat':
      if (!state.messages.some((message) => message.id === command.id && message.authorId === senderId)) return state;
      return { ...state, revision: state.revision + 1, messages: state.messages.map((message) =>
        message.id === command.id ? { ...message, text: command.text, edited: true } : message) };
    case 'video':
      return { ...state, revision: state.revision + 1, video: command.video, playback: null };
    case 'settings':
      return { ...state, revision: state.revision + 1, automaticMigration: command.automaticMigration, replicateVideo: command.replicateVideo };
    case 'playback':
      return { ...state, revision: state.revision + 1, playback: { action: command.action, currentTime: command.currentTime, sentAt: Date.now(), timestamp: Date.now() } };
  }
}
