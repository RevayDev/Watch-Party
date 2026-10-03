import React, { useState, useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { ChatMessage } from '../../types/room';

interface ChatProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  currentUserName?: string;
}

export const Chat: React.FC<ChatProps> = ({ messages, onSendMessage, currentUserName }) => {
  const [input, setInput] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput('');
  };

  return (
    <div className="drawer-chat" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mobile header (sin botón X: el cierre es por backdrop, Esc o arrastre) */}
      <div className="meet-drawer__header part-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>Mensajes del chat</h3>
      </div>

      {/* Message list */}
      <div ref={bodyRef} className="drawer-chat__messages" style={{ flex: 1, overflowY: 'auto' }}>
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
          type="text"
          className="drawer-chat__input"
          placeholder="Escribe un mensaje…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
