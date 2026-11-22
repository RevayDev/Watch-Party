import { Server, Socket } from 'socket.io';
import { checkSocketRateLimit } from '../socket-limits.js';
import {
  activeUsers,
  roomReadReceipts,
  roomMessageAuthors,
  lastCinematicTrigger,
  roomMessageAuthor,
  trackRoomMessage,
} from '../socket-state.js';

// Anti-spam por socket (el excedente se ignora en silencio): ~8 mensajes,
// ~20 reacciones y ~10 typing por ventana de 10s. Sin librerías nuevas.
const MESSAGE_LIMIT = { max: 8, windowMs: 10_000 };
const REACTION_LIMIT = { max: 20, windowMs: 10_000 };
const TYPING_LIMIT = { max: 10, windowMs: 10_000 };
const CINEMATIC_LIMIT = { max: 5, windowMs: 10_000 };
const MAX_MESSAGE_CHARS = 500;
const MAX_EMOJI_CHARS = 20;
const MAX_QUOTE_NAME_CHARS = 50;
const MAX_QUOTE_TEXT_CHARS = 200;
const MAX_COMBO_ID_CHARS = 64;
const MAX_QUOTE_CHARS = 200;
// Solo el primer trigger dentro de la ventana se reenvía a la sala.
const CINEMATIC_WINDOW_MS = 8000;

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
  socket.on('request-chat-reads', (data: { roomId?: unknown } | undefined) => {
    if (typeof data?.roomId !== 'string') return;
    const roomId = data.roomId.toUpperCase().trim();
    if (!memberNameOf(socket.id, roomId) || !checkSocketRateLimit(socket.id, 'chat-read', 100, 10000)) return;
    socket.emit('chat-read-state', roomReadReceipts.get(roomId) ?? {});
  });
  socket.on('chat-read', (data: { roomId?: unknown; messageId?: unknown } | undefined) => {
    if (typeof data?.roomId !== 'string' || typeof data.messageId !== 'string' || data.messageId.length > 100) return;
    const roomId = data.roomId.toUpperCase().trim();
    const userName = memberNameOf(socket.id, roomId);
    if (!userName || !roomMessageAuthor(roomId, data.messageId) || !checkSocketRateLimit(socket.id, 'chat-read', 100, 10000)) return;
    const readerId = activeUsers.get(socket.id)?.userId || socket.id;
    const receipts = roomReadReceipts.get(roomId) ?? {};
    const ids = [...(roomMessageAuthors.get(roomId)?.keys() ?? [])];
    if (ids.indexOf(data.messageId) <= ids.indexOf(receipts[readerId]?.messageId)) return;
    const receipt = { readerId, userName, messageId: data.messageId };
    receipts[readerId] = receipt;
    // Keep this ephemeral directory bounded even as visitors change.
    const keys = Object.keys(receipts); if (keys.length > 100) delete receipts[keys[0]];
    roomReadReceipts.set(roomId, receipts);
    io.to(roomId).emit('chat-read', receipt);
  });
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
    // Cita opcional (responder): solo texto libre validado, sin spread ciego.
    let replyTo: { id: string; user: string; text: string } | null = null;
    const rawReply = (data as { replyTo?: unknown }).replyTo;
    if (rawReply && typeof rawReply === 'object') {
      const rq = rawReply as Record<string, unknown>;
      const qUser = typeof rq.user === 'string' ? rq.user.trim().slice(0, MAX_QUOTE_NAME_CHARS) : '';
      const qText = typeof rq.text === 'string' ? rq.text.trim().slice(0, MAX_QUOTE_TEXT_CHARS) : '';
      const qId = typeof rq.id === 'string' ? rq.id.trim().slice(0, 32) : '';
      if (qUser && qText) replyTo = { id: qId, user: qUser, text: qText };
    }

    const messagePayload: {
      id: string;
      user: string;
      text: string;
      timestamp: string;
      replyTo: { id: string; user: string; text: string } | null;
    } = {
      id: Math.random().toString(36).substring(2, 9),
      user: serverName,
      text: cleanText,
      timestamp: new Date().toISOString(),
      replyTo,
    };
    trackRoomMessage(cleanRoomId, messagePayload.id, serverName);

    io.to(cleanRoomId).emit('chat-message', messagePayload);
  });

  // 7b. Edit Message (solo el autor, validado contra el registro efímero).
  socket.on(
    'edit-message',
    (data: { roomId: string; id: string; text: string } | undefined) => {
      if (!data) return;
      const { roomId, id, text } = data;
      if (typeof roomId !== 'string' || !roomId.trim()) return;
      if (typeof id !== 'string' || !id.trim()) return;
      if (typeof text !== 'string' || !text.trim()) return;
      if (!checkSocketRateLimit(socket.id, 'send-message', MESSAGE_LIMIT.max, MESSAGE_LIMIT.windowMs)) return;
      const cleanRoomId = roomId.toUpperCase().trim();
      const serverName = memberNameOf(socket.id, cleanRoomId);
      if (!serverName) return;
      const author = roomMessageAuthor(cleanRoomId, id.trim());
      if (!author || author.toLowerCase() !== serverName.toLowerCase()) return;
      const cleanText = text.trim().slice(0, MAX_MESSAGE_CHARS);
      if (!cleanText) return;

      io.to(cleanRoomId).emit('message-edited', { id: id.trim(), text: cleanText });
    }
  );

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
      xOffset: Math.random() * 120 - 60,
      floatDuration: 3.5 + Math.random() * 2,
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

  // 8c. Cinemática del combo Interestellar: quien completa el combo propone
  // sus 3 frases. El servidor solo deja pasar la PRIMERA propuesta dentro de
  // la ventana y la reenvía a la sala: todos ven exactamente lo mismo, como
  // con el video. Efímero, sin persistencia.
  socket.on(
    'cinematic-trigger',
    (
      data:
        | { roomId: string; comboId: string; quotes: unknown; userName?: string }
        | undefined
    ) => {
      if (!data) return;
      const { roomId, comboId, quotes } = data;
      if (typeof roomId !== 'string' || !roomId.trim()) return;
      if (typeof comboId !== 'string' || !comboId.trim()) return;
      if (!Array.isArray(quotes) || quotes.length !== 3) return;
      if (!checkSocketRateLimit(socket.id, 'cinematic-trigger', CINEMATIC_LIMIT.max, CINEMATIC_LIMIT.windowMs)) return;
      const cleanRoomId = roomId.toUpperCase().trim();
      const serverName = memberNameOf(socket.id, cleanRoomId);
      if (!serverName) return;
      const cleanQuotes = quotes.map((q) =>
        typeof q === 'string' ? q.trim().slice(0, MAX_QUOTE_CHARS) : ''
      );
      if (cleanQuotes.some((q) => !q)) return;
      const now = Date.now();
      if (now - (lastCinematicTrigger.get(cleanRoomId) ?? 0) < CINEMATIC_WINDOW_MS) return;
      lastCinematicTrigger.set(cleanRoomId, now);

      io.to(cleanRoomId).emit('cinematic-trigger', {
        comboId: comboId.trim().slice(0, MAX_COMBO_ID_CHARS),
        quotes: cleanQuotes,
        user: serverName,
      });
    }
  );

  // 8d. Cierre compartido de la cinemática: quien la omite lo emite y se
  // reenvía a la sala para que se cierre en todos y siga la película.
  // Idempotente (cerrar dos veces no hace nada); sin ventana temporal.
  socket.on(
    'cinematic-skip',
    (data: { roomId: string; comboId: string; userName?: string } | undefined) => {
      if (!data) return;
      const { roomId, comboId } = data;
      if (typeof roomId !== 'string' || !roomId.trim()) return;
      if (typeof comboId !== 'string' || !comboId.trim()) return;
      if (!checkSocketRateLimit(socket.id, 'cinematic-skip', CINEMATIC_LIMIT.max, CINEMATIC_LIMIT.windowMs)) return;
      const cleanRoomId = roomId.toUpperCase().trim();
      const serverName = memberNameOf(socket.id, cleanRoomId);
      if (!serverName) return;

      io.to(cleanRoomId).emit('cinematic-skip', {
        comboId: comboId.trim().slice(0, MAX_COMBO_ID_CHARS),
        user: serverName,
      });
    }
  );
}
