import React, { useState, useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { ChatMessage } from '../types/room';

interface ChatProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
}

export const Chat: React.FC<ChatProps> = ({ messages, onSendMessage }) => {
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
    <div className="drawer-chat">
      {/* Message list */}
      <div ref={bodyRef} className="drawer-chat__messages">
        {messages.length === 0 ? (
          <div className="drawer-chat__empty">
            Sin mensajes aún. ¡Di algo! 👋
          </div>
        ) : (
          messages.map((m) => {
            const isSystem = m.user === 'Sistema';
            return (
              <div key={m.id} className={`drawer-chat__msg ${isSystem ? 'drawer-chat__msg--system' : ''}`}>
                {!isSystem && <span className="drawer-chat__author">{m.user}</span>}
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
        <button type="submit" className="drawer-chat__send" disabled={!input.trim()}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
};
