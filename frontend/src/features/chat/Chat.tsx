import React, { useState, useEffect, useRef } from 'react';
import { Send, X } from 'lucide-react';
import { ChatMessage } from '../../types/room';

interface ChatProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  currentUserName?: string;
  onClose?: () => void;
}

export const Chat: React.FC<ChatProps> = ({ messages, onSendMessage, currentUserName, onClose }) => {
  const [input, setInput] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMessagesCountRef = useRef(messages.length);

  // Check scroll position to determine if user is reading previous messages
  const handleScroll = () => {
    if (bodyRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = bodyRef.current;
      // User is considered near bottom if within 80px of bottom
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight <= 80;
    }
  };

  // Smart auto-scroll on new messages
  useEffect(() => {
    if (!bodyRef.current) return;

    const isFirstLoad = prevMessagesCountRef.current === 0 && messages.length > 0;
    const isNewMessage = messages.length > prevMessagesCountRef.current;
    prevMessagesCountRef.current = messages.length;

    if (isFirstLoad) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      return;
    }

    if (isNewMessage) {
      const lastMessage = messages[messages.length - 1];
      const isMyMessage =
        lastMessage &&
        currentUserName &&
        lastMessage.user.trim().toLowerCase() === currentUserName.trim().toLowerCase();

      // Always scroll for own messages, or if user is already near bottom
      if (isMyMessage || isNearBottomRef.current) {
        bodyRef.current.scrollTo({
          top: bodyRef.current.scrollHeight,
          behavior: isMyMessage ? 'smooth' : 'auto',
        });
      }
    }
  }, [messages, currentUserName]);

  const handleInputFocus = () => {
    // Keep input visible above virtual keyboard on mobile
    setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput('');
  };

  return (
    <div className="drawer-chat" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header with Title and Close Button */}
      <div
        className="meet-drawer__header part-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', margin: 0 }}>
          Mensajes del chat
        </h3>
        {onClose && (
          <button
            type="button"
            className="drawer-close-btn"
            onClick={onClose}
            title="Cerrar chat"
            aria-label="Cerrar chat"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Message list */}
      <div
        ref={bodyRef}
        onScroll={handleScroll}
        className="drawer-chat__messages"
        style={{ flex: 1, overflowY: 'auto' }}
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
                className={`drawer-chat__msg ${
                  currentUserName &&
                  m.user.trim().toLowerCase() ===
                    currentUserName.trim().toLowerCase()
                    ? 'drawer-chat__msg--mine'
                    : ''
                }`}
              >
                <span className="drawer-chat__author">{m.user}</span>
                <span className="drawer-chat__text">{m.text}</span>
                <span className="drawer-chat__time">{m.timestamp}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Input bar always visible */}
      <form onSubmit={handleSubmit} className="drawer-chat__input-bar">
        <input
          ref={inputRef}
          type="text"
          className="drawer-chat__input"
          placeholder="Escribe un mensaje…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={handleInputFocus}
          autoComplete="off"
        />
        <button
          type="submit"
          className="drawer-chat__send"
          disabled={!input.trim()}
          title="Enviar mensaje"
          aria-label="Enviar mensaje"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
};

export default Chat;
