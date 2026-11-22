import { Button, Field } from '../../shared/components/ui';
import React, { useState, useLayoutEffect, useRef } from 'react';
import { Send, X, ArrowDown, Pencil, Reply } from 'lucide-react';
import { ChatMessage } from '../../types/room';
import { getAvatarColor, getInitials } from '../../shared/utils';

interface ChatProps {
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  // Mensaje en edición (solo propios) y cita de respuesta.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; user: string; text: string } | null>(null);
  const prevMessagesCountRef = useRef(0);
  const wasOpenRef = useRef(false);

  // Check scroll position to determine if user is reading previous messages
  const handleScroll = () => {
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
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={`drawer-chat__msg ${
                    isMine(m.user) ? 'drawer-chat__msg--mine' : ''
                  }`}
                >
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
                  <span className="drawer-chat__author">{m.user}</span>
                  <span className="drawer-chat__text">
                    {m.text}
                    {m.edited && <em className="drawer-chat__edited"> · editado</em>}
                  </span>
                  <span className="drawer-chat__time">{m.timestamp}</span>
                  <span className="drawer-chat__actions">
                    <Button variant="unstyled"
                      type="button"
                      className="drawer-chat__action"
                      title={`Responder a ${m.user}`}
                      aria-label={`Responder a ${m.user}`}
                      onClick={() => startReply(m)}
                    >
                      <Reply size={13} />
                    </Button>
                    {isMine(m.user) && (
                      <Button variant="unstyled"
                        type="button"
                        className="drawer-chat__action"
                        title="Editar mensaje"
                        aria-label="Editar mensaje"
                        onClick={() => startEdit(m)}
                      >
                        <Pencil size={13} />
                      </Button>
                    )}
                  </span>
                </div>
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
