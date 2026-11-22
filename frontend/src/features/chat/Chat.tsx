import { Button, Field, Popover } from '../../shared/components/ui';
import React, { useState, useLayoutEffect, useRef, useEffect } from 'react';
import { Send, X, ArrowDown, Pencil, Reply, Smile, MoreVertical, Trash2 } from 'lucide-react';
import { ChatMessage } from '../../types/room';
import { getAvatarColor, getInitials } from '../../shared/utils';

export interface ChatReadReceipt { readerId: string; userName: string; messageId: string; }
export function formatChatTime(timestamp: string): string {
  const date = /^\d{4}-\d{2}-\d{2}T/.test(timestamp) ? new Date(timestamp) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : timestamp;
}
interface ChatProps {
  onDeleteMessage?: (id: string) => void;
  onReactMessage?: (id: string, emoji: string) => void;
  readReceipts?: ChatReadReceipt[];
  currentUserId?: string;
  onReadMessage?: (id: string) => void;
  isOpen?: boolean;
  messages: ChatMessage[];
  onSendMessage: (text: string, replyTo?: { id: string; user: string; text: string } | null) => void;
  onEditMessage?: (id: string, text: string) => void;
  currentUserName?: string;
  /** Usuarios escribiendo ahora (ya filtrados y sin expirar, ordenados). */
  typingUsers?: string[];
  /** Se llama al teclear con texto no vacío (el hook lo throttlea a 1/2 s). */
  onTyping?: () => void;
  /** No leídos acumulados (insignia de la flecha para bajar). */
  unreadCount?: number;
}

export const Chat: React.FC<ChatProps> = ({
  onDeleteMessage = () => undefined, onReactMessage = () => undefined,
  readReceipts = [], currentUserId, onReadMessage,
  isOpen = true,
  messages,
  onSendMessage,
  onEditMessage = () => undefined,
  currentUserName,
  typingUsers = [],
  onTyping,
  unreadCount = 0,
}) => {
  const [input, setInput] = useState('');
  const [messageMenu, setMessageMenu] = useState<{ id: string; kind: 'options' | 'reaction' | 'all'; anchor: HTMLElement } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  // Mensaje en edición (solo propios) y cita de respuesta.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; user: string; text: string } | null>(null);
  const prevMessagesCountRef = useRef(0);
  const wasOpenRef = useRef(false);

  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; pointerId: number } | null>(null);
  const cancelPress = () => { if (press.current?.timer) clearTimeout(press.current.timer); press.current = null; };
  useEffect(() => {
    if (!isOpen) setMessageMenu(null);
    return cancelPress;
  }, [isOpen]);
  const startPress = (event: React.PointerEvent<HTMLDivElement>, message: ChatMessage) => {
    if (message.deleted || !['touch', 'pen'].includes(event.pointerType) || (event.target as HTMLElement).closest('button, a, input')) return;
    cancelPress();
    const anchor = event.currentTarget;
    press.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, timer: setTimeout(() => {
      if (press.current) { press.current.timer = null; setMessageMenu({ id: message.id, kind: 'all', anchor }); }
    }, 500) };
  };
  const movePress = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = press.current;
    if (current && (event.pointerId !== current.pointerId || Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10)) cancelPress();
  };

  // Check scroll position to determine if user is reading previous messages
  const handleScroll = () => {
    cancelPress();
    if (bodyRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = bodyRef.current;
      const near = scrollHeight - scrollTop - clientHeight <= 24;
      isNearBottomRef.current = near;
      setShowJump(!near);
    }
  };

  const jumpToLatest = () => {
    const body = bodyRef.current;
    if (!body) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    body.scrollTo({ top: body.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  useLayoutEffect(() => {
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!isOpen || !bodyRef.current) return;

    const prev = prevMessagesCountRef.current;
    prevMessagesCountRef.current = messages.length;
    if (justOpened || prev === 0 || messages.length === 0) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      isNearBottomRef.current = true;
      setShowJump(false);
      return;
    }

    if (messages.length > prev) {
      const lastMessage = messages[messages.length - 1];
      const isMyMessage =
        lastMessage &&
        currentUserName &&
        lastMessage.user.trim().toLowerCase() === currentUserName.trim().toLowerCase();

      // Always scroll for own messages, or if user is already near bottom.
      // Ráfaga (>3 de golpe): salto instantáneo para no perseguir la
      // animación suave sin asentarse nunca en el último.
      if (isMyMessage || isNearBottomRef.current) {
        const burst = messages.length - prev > 3;
        bodyRef.current.scrollTo({
          top: bodyRef.current.scrollHeight,
          behavior: isMyMessage && !burst ? 'smooth' : 'auto',
        });
        isNearBottomRef.current = true;
        setShowJump(false);
      }
    }
  }, [isOpen, messages, currentUserName]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!isOpen || !body || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) body.scrollTop = body.scrollHeight;
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [isOpen]);

  const lastRead = useRef<string | null>(null);
  const hasReadCallback = !!onReadMessage;
  const readCallback = useRef(onReadMessage);
  readCallback.current = onReadMessage;
  useEffect(() => {
    const root = bodyRef.current;
    if (!isOpen || !root || !hasReadCallback) return;
    const report = (ids: string[]) => {
      if (document.visibilityState !== 'visible') return;
      const index = messages.map(message => message.user !== 'Sistema' && ids.includes(message.id)).lastIndexOf(true);
      if (index < 0) return;
      const previous = messages.findIndex(message => message.id === lastRead.current);
      if (index <= previous) return;
      lastRead.current = messages[index].id;
      readCallback.current?.(messages[index].id);
    };
    const elements = [...root.querySelectorAll<HTMLElement>('[data-message-id]')];
    const measure = () => { const bounds = root.getBoundingClientRect(); if (!bounds.height) return; report(elements.filter(element => { const rect = element.getBoundingClientRect(); return rect.bottom <= bounds.bottom && rect.top >= bounds.top; }).map(element => element.dataset.messageId!)); };
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => report(entries.filter(entry => entry.isIntersecting && entry.intersectionRatio >= .6).map(entry => (entry.target as HTMLElement).dataset.messageId!)), { root, threshold: .6 });
      elements.forEach(element => observer!.observe(element));
    } else root.addEventListener('scroll', measure);
    document.addEventListener('visibilitychange', measure);
    measure();
    return () => { observer?.disconnect(); root.removeEventListener('scroll', measure); document.removeEventListener('visibilitychange', measure); };
  }, [isOpen, messages, hasReadCallback]);

  const handleInputFocus = () => {
    // Keep input visible above virtual keyboard on mobile
    setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setInput(next);
    // Solo con texto no vacío: el hook throttlea la emisión (máx 1/2 s).
    if (next.trim() && onTyping) onTyping();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    if (editingId) {
      onEditMessage(editingId, input.trim());
      setEditingId(null);
    } else {
      onSendMessage(input.trim(), replyTo);
      setReplyTo(null);
    }
    setInput('');
  };

  const isMine = (user: string) =>
    !!currentUserName && user.trim().toLowerCase() === currentUserName.trim().toLowerCase();

  const startEdit = (m: ChatMessage) => {
    setMessageMenu(null);
    setReplyTo(null);
    setEditingId(m.id);
    setInput(m.text);
    inputRef.current?.focus();
  };

  const cancelEditing = () => {
    setEditingId(null);
    setInput('');
  };

  const startReply = (m: ChatMessage) => {
    setMessageMenu(null);
    setEditingId(null);
    setReplyTo({ id: m.id, user: m.user, text: m.text });
    inputRef.current?.focus();
  };

  const jumpToMessage = (id: string) => {
    document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const typingText =
    typingUsers.length === 1
      ? `${typingUsers[0]} está escribiendo`
      : typingUsers.length === 2
        ? `${typingUsers[0]} y ${typingUsers[1]} están escribiendo`
        : typingUsers.length > 2
          ? `${typingUsers[0]}, ${typingUsers[1]} y ${typingUsers.length - 2} más están escribiendo`
          : '';

  return (
    <div className="drawer-chat">
      <div className="drawer-chat__history">
        <div
          ref={bodyRef}
          onScroll={handleScroll}
          className="drawer-chat__messages"
        >
          {messages.length === 0 ? (
            <div className="drawer-chat__empty">
              Sin mensajes aún. ¡Di algo! 👋
            </div>
          ) : (
            messages.map((m) => {
              const isSystem = m.user === 'Sistema';
              if (isSystem) {
                return (
                  <div key={m.id} className="drawer-chat__system-row">
                    <div className="drawer-chat__system-pill">
                      <span>{m.text}</span>
                    </div>
                  </div>
                );
              }
              return (
                <React.Fragment key={m.id}>
                {m.replyTo && <div className={`drawer-chat__reply-preview ${isMine(m.user) ? 'drawer-chat__reply-preview--mine' : ''}`}><span>{isMine(m.user) ? 'Respondiste' : m.user + ' respondió'} a {m.replyTo.user}</span>
                  {m.replyTo && (
                    <Button variant="unstyled"
                      type="button"
                      className="drawer-chat__quote"
                      onClick={() => jumpToMessage(m.replyTo!.id)}
                      title={`Ir al mensaje de ${m.replyTo.user}`}
                    >
                      <span className="drawer-chat__quote-user">{m.replyTo.user}</span>
                      <span className="drawer-chat__quote-text">{m.replyTo.text}</span>
                    </Button>
                  )}
                </div>}

                <div className={`drawer-chat__row ${isMine(m.user) ? 'drawer-chat__row--mine' : ''}`}>
                <div
                  data-message-id={m.id}
                  tabIndex={m.deleted ? undefined : 0}
                  onPointerDown={event => startPress(event, m)}
                  onPointerMove={movePress}
                  onPointerUp={cancelPress}
                  onPointerCancel={cancelPress}
                  onContextMenu={event => { if (!m.deleted && window.matchMedia?.('(max-width: 768px), (pointer: coarse)').matches) { event.preventDefault(); cancelPress(); setMessageMenu({ id: m.id, kind: 'all', anchor: event.currentTarget }); } }}
                  onKeyDown={event => { if (!m.deleted && event.target === event.currentTarget && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) { event.preventDefault(); setMessageMenu({ id: m.id, kind: 'all', anchor: event.currentTarget }); } }}
                  id={`msg-${m.id}`}
                  className={`drawer-chat__msg ${
                    isMine(m.user) ? 'drawer-chat__msg--mine' : ''
                  }`}
                >
                  <span className="drawer-chat__author">{m.user}</span>
                  <span className="drawer-chat__text">
                    {m.deleted ? <em className="drawer-chat__deleted">Mensaje eliminado</em> : m.text}
                    {m.edited && <em className="drawer-chat__edited"> · editado</em>}
                  </span>
                  <time className="drawer-chat__time" dateTime={m.timestamp.includes('T') ? m.timestamp : undefined} title={m.timestamp.includes('T') ? new Date(m.timestamp).toLocaleString() : m.timestamp}>{formatChatTime(m.timestamp)}</time>
                  {!m.deleted && <span className="drawer-chat__actions">
                    <Button variant="unstyled" type="button" className="drawer-chat__action" title={`Responder a ${m.user}`} aria-label={`Responder a ${m.user}`} onClick={() => startReply(m)}><Reply size={15} /></Button>
                    <Button variant="unstyled" type="button" className="drawer-chat__action" title="Reaccionar al mensaje" aria-label={`Reaccionar al mensaje de ${m.user}`} onClick={event => setMessageMenu(current => current?.id === m.id && current.kind === 'reaction' ? null : { id: m.id, kind: 'reaction', anchor: event.currentTarget })}><Smile size={15} /></Button>
                    {isMine(m.user) && <Button variant="unstyled" type="button" className="drawer-chat__action" title="Más opciones del mensaje" aria-label="Más opciones del mensaje" onClick={event => setMessageMenu(current => current?.id === m.id && current.kind === 'options' ? null : { id: m.id, kind: 'options', anchor: event.currentTarget })}><MoreVertical size={15} /></Button>}
                  </span>}
                  {!m.deleted && messageMenu?.id === m.id && <Popover anchor={messageMenu.anchor} className={`chat-message-menu ${messageMenu.kind === 'reaction' ? 'chat-message-menu--reactions' : ''}`} onDismiss={() => setMessageMenu(null)} aria-label={messageMenu.kind === 'reaction' ? 'Reaccionar al mensaje' : 'Opciones del mensaje'}>
                    {messageMenu.kind !== 'reaction' ? <>
                      {messageMenu.kind === 'all' && <>
                        <Button variant="ghost" type="button" onClick={() => startReply(m)}><Reply size={15} />Responder</Button>
                        <Button variant="ghost" type="button" onClick={() => setMessageMenu({ ...messageMenu, kind: 'reaction' })}><Smile size={15} />Reaccionar</Button>
                      </>}
                      {isMine(m.user) && <>
                      <Button variant="ghost" type="button" onClick={() => startEdit(m)}><Pencil size={15} />Editar mensaje</Button>
                      <Button variant="ghost" type="button" className="chat-message-menu__delete" onClick={() => { onDeleteMessage(m.id); setMessageMenu(null); }}><Trash2 size={15} />Eliminar mensaje</Button>
                      </>}
                    </> : <div className="chat-message-menu__emojis">{['❤️','😂','😮','👏','😢','🔥'].map(emoji => <Button variant="ghost" key={emoji} type="button" aria-label={`Reaccionar con ${emoji}`} onClick={() => { onReactMessage(m.id, emoji); setMessageMenu(null); }}>{emoji}</Button>)}</div>}
                  </Popover>}
                  {!m.deleted && !!m.reactions?.length && <div className="drawer-chat__message-reactions">{[...new Set(m.reactions.map(reaction => reaction.emoji))].map(emoji => <Button variant="unstyled" key={emoji} type="button" title={m.reactions!.filter(reaction => reaction.emoji === emoji).map(reaction => reaction.userName).join(', ')} aria-label={`Reacción ${emoji}`} onClick={() => onReactMessage(m.id, emoji)}>{emoji} {m.reactions!.filter(reaction => reaction.emoji === emoji).length}</Button>)}</div>}

                </div>
                </div>
                {readReceipts.some(receipt => receipt.messageId === m.id && receipt.readerId !== currentUserId && receipt.userName !== currentUserName) && <div className={`drawer-chat__seen ${isMine(m.user) ? 'drawer-chat__seen--mine' : ''}`} aria-label="Visto por">
                  {readReceipts.filter(receipt => receipt.messageId === m.id && receipt.readerId !== currentUserId && receipt.userName !== currentUserName).map(receipt => <span key={receipt.readerId} className="drawer-chat__seen-avatar" role="img" aria-label={`Visto por ${receipt.userName}`} title={receipt.userName} style={{ background: getAvatarColor(receipt.userName) }}>{getInitials(receipt.userName)}</span>)}
                </div>}
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* Flechita para bajar al último mensaje (estilo WhatsApp) */}
        {isOpen && showJump && (
          <Button variant="unstyled"
            type="button"
            className="drawer-chat__jump"
            title="Bajar al último mensaje"
            aria-label="Bajar al último mensaje"
            onClick={jumpToLatest}
          >
            <ArrowDown size={18} />
            {unreadCount > 0 && (
              <span className="drawer-chat__jump-badge">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Button>
        )}
      </div>

      {/* Indicador "está escribiendo" al pie del chat (sobre el input) */}
      {typingUsers.length > 0 && (
        <div className="typing-indicator" role="status" aria-live="polite" aria-label={typingText}>
          <span className="typing-indicator__avatars" aria-hidden="true">
            {typingUsers.slice(0, 5).map((name, i) => (
              <span
                key={name}
                className="typing-indicator__avatar"
                style={{ background: getAvatarColor(name), zIndex: typingUsers.length - i }}
                title={name}
              >
                {getInitials(name)}
              </span>
            ))}
          </span>
          <span className="typing-indicator__text">{typingText}</span>
          <span className="typing-indicator__dots" aria-hidden="true">
            <span className="typing-indicator__dot" />
            <span className="typing-indicator__dot" />
            <span className="typing-indicator__dot" />
          </span>
        </div>
      )}

      {/* Barra de contexto: editando o respondiendo */}
      {editingId && (
        <div className="drawer-chat__context" role="status">
          <span className="drawer-chat__context-label">Editando mensaje</span>
          <Button variant="unstyled"
            type="button"
            className="drawer-chat__context-close"
            title="Cancelar edición"
            aria-label="Cancelar edición"
            onClick={cancelEditing}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      {!editingId && replyTo && (
        <div className="drawer-chat__context" role="status">
          <span className="drawer-chat__context-label">
            Respondiendo a <strong>{replyTo.user}</strong>: {replyTo.text}
          </span>
          <Button variant="unstyled"
            type="button"
            className="drawer-chat__context-close"
            title="Quitar respuesta"
            aria-label="Quitar respuesta"
            onClick={() => setReplyTo(null)}
          >
            <X size={14} />
          </Button>
        </div>
      )}

      {/* Input bar always visible */}
      <form onSubmit={handleSubmit} className="drawer-chat__input-bar">
        <Field
          ref={inputRef}
          type="text"
          className="drawer-chat__input"
          placeholder={editingId ? 'Edita tu mensaje…' : 'Escribe un mensaje…'}
          value={input}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          autoComplete="off"
        />
        <Button variant="unstyled"
          type="submit"
          className="drawer-chat__send"
          disabled={!input.trim()}
          title="Enviar mensaje"
          aria-label="Enviar mensaje"
        >
          <Send size={16} />
        </Button>
      </form>
    </div>
  );
};

export default Chat;
