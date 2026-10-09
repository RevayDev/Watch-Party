import { Server, Socket } from 'socket.io';
import { checkSocketRateLimit } from '../socket-limits.js';
import { activeUsers } from '../socket-state.js';

// Anti-spam por socket (el excedente se ignora en silencio): ~8 mensajes,
// ~20 reacciones y ~10 typing por ventana de 10s. Sin librerías nuevas.
const MESSAGE_LIMIT = { max: 8, windowMs: 10_000 };
const REACTION_LIMIT = { max: 20, windowMs: 10_000 };
const TYPING_LIMIT = { max: 10, windowMs: 10_000 };
const MAX_MESSAGE_CHARS = 500;
const MAX_EMOJI_CHARS = 20;

/**
 * Anti-raid: solo un miembro real de la sala (ni fantasma, ni en espera)
 * puede hablar. Devuelve el nombre DEL SERVIDOR (anti-suplantación: el
 * `userName` que envía el cliente se ignora a propósito) o null.
 */
function memberNameOf(socketId: string, cleanRoomId: string): string | null {
  const member = activeUsers.get(socketId);
  if (!member || member.roomId !== cleanRoomId || member.pending) return null;
  return member.userName;
}

/** Handler de chat y reacciones. Nombres de eventos y payloads idénticos al original. */
export function registerChatReactionsHandlers(io: Server, socket: Socket): void {
  // 7. Chat Message
  socket.on('send-message', (data: { roomId: string; text: string; userName?: string } | undefined) => {
    if (!data) return;
    const { roomId, text } = data;
    if (typeof roomId !== 'string' || !roomId.trim()) return;
    if (typeof text !== 'string' || !text.trim()) return;
    if (!checkSocketRateLimit(socket.id, 'send-message', MESSAGE_LIMIT.max, MESSAGE_LIMIT.windowMs)) return;
    const cleanRoomId = roomId.toUpperCase().trim();
    const serverName = memberNameOf(socket.id, cleanRoomId);
    if (!serverName) return;
    const cleanText = text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!cleanText) return;

    const messagePayload = {
      id: Math.random().toString(36).substring(2, 9),
      user: serverName,
      text: cleanText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    io.to(cleanRoomId).emit('chat-message', messagePayload);
  });

  // 8. Reaction (Emoji float animation)
  socket.on('send-reaction', (data: { roomId: string; emoji: string; userName?: string } | undefined) => {
    if (!data) return;
    const { roomId, emoji } = data;
    if (typeof roomId !== 'string' || !roomId.trim()) return;
    if (typeof emoji !== 'string' || !emoji.trim()) return;
    if (!checkSocketRateLimit(socket.id, 'send-reaction', REACTION_LIMIT.max, REACTION_LIMIT.windowMs)) return;
    const cleanRoomId = roomId.toUpperCase().trim();
    const serverName = memberNameOf(socket.id, cleanRoomId);
    if (!serverName) return;
    // Emojis con ZWJ/variantes pueden ocupar varios code units: se mide por code points.
    const cleanEmoji = [...emoji.trim()].slice(0, MAX_EMOJI_CHARS).join('');
    if (!cleanEmoji) return;

    const reactionPayload = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      emoji: cleanEmoji,
      user: serverName,
      xOffset: Math.random() * 40 - 20,
    };

    io.to(cleanRoomId).emit('reaction', reactionPayload);
  });

  // 8b. Typing ("está escribiendo"): efímero, sin persistencia. Mismo patrón
  // que send-message/reaction (validación + rate-limit + reenvío a la sala).
  socket.on('typing', (data: { roomId: string; userName?: string } | undefined) => {
    if (!data) return;
    const { roomId } = data;
    if (typeof roomId !== 'string' || !roomId.trim()) return;
    if (!checkSocketRateLimit(socket.id, 'typing', TYPING_LIMIT.max, TYPING_LIMIT.windowMs)) return;
    const cleanRoomId = roomId.toUpperCase().trim();
    const serverName = memberNameOf(socket.id, cleanRoomId);
    if (!serverName) return;

    io.to(cleanRoomId).emit('typing', { user: serverName, timestamp: Date.now() });
  });
}
