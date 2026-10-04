import { Server, Socket } from 'socket.io';
import { checkSocketRateLimit } from '../socket-limits.js';

// Anti-spam por socket (el excedente se ignora en silencio): ~8 mensajes y
// ~20 reacciones por ventana de 10s. Sin librerías nuevas.
const MESSAGE_LIMIT = { max: 8, windowMs: 10_000 };
const REACTION_LIMIT = { max: 20, windowMs: 10_000 };

/** Handler de chat y reacciones. Nombres de eventos y payloads idénticos al original. */
export function registerChatReactionsHandlers(io: Server, socket: Socket): void {
  // 7. Chat Message
  socket.on('send-message', (data: { roomId: string; text: string; userName: string } | undefined) => {
    if (!data) return;
    const { roomId, text, userName } = data;
    if (!roomId || typeof text !== 'string' || !text.trim()) return;
    if (!checkSocketRateLimit(socket.id, 'send-message', MESSAGE_LIMIT.max, MESSAGE_LIMIT.windowMs)) return;
    const cleanRoomId = roomId.toUpperCase().trim();

    const messagePayload = {
      id: Math.random().toString(36).substring(2, 9),
      user: userName || 'Anónimo',
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    io.to(cleanRoomId).emit('chat-message', messagePayload);
  });

  // 8. Reaction (Emoji float animation)
  socket.on('send-reaction', (data: { roomId: string; emoji: string; userName: string } | undefined) => {
    if (!data) return;
    const { roomId, emoji, userName } = data;
    if (!roomId || typeof emoji !== 'string' || !emoji) return;
    if (!checkSocketRateLimit(socket.id, 'send-reaction', REACTION_LIMIT.max, REACTION_LIMIT.windowMs)) return;
    const cleanRoomId = roomId.toUpperCase().trim();

    const reactionPayload = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      emoji,
      user: userName || 'Anónimo',
      xOffset: Math.random() * 40 - 20,
    };

    io.to(cleanRoomId).emit('reaction', reactionPayload);
  });
}
