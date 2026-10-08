// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Chat } from '../src/features/chat/Chat';
import type { ChatMessage } from '../src/types/room';

const baseMessages: ChatMessage[] = [
  { id: 'm1', user: 'Ana', text: 'Hola', timestamp: '10:00' },
];

describe('Chat', () => {
  it('renderiza mensajes correctamente', () => {
    render(
      <Chat messages={baseMessages} onSendMessage={() => {}} typingUsers={[]} />
    );
    expect(screen.getByText('Hola')).toBeTruthy();
  });

  it('muestra el indicador "escribiendo" con un usuario', () => {
    render(
      <Chat
        messages={baseMessages}
        onSendMessage={() => {}}
        typingUsers={['Ana']}
      />
    );
    expect(screen.getByText('Ana está escribiendo')).toBeTruthy();
    // 3 bolitas saltando presentes
    const dots = document.querySelectorAll('.typing-indicator__dot');
    expect(dots.length).toBe(3);
    // avatares superpuestos estilo cartas
    const avatars = document.querySelectorAll('.typing-indicator__avatar');
    expect(avatars.length).toBe(1);
    expect(avatars[0].textContent).toMatch(/^AN$/i);
  });

  it('muestra varios usuarios escribiendo con texto "están escribiendo"', () => {
    render(
      <Chat
        messages={baseMessages}
        onSendMessage={() => {}}
        typingUsers={['Ana', 'Beto', 'Carol']}
      />
    );
    expect(screen.getByText(/Ana, Beto y 1 más están escribiendo/i)).toBeTruthy();
  });

  it('no muestra indicador cuando no hay nadie escribiendo', () => {
    render(
      <Chat messages={baseMessages} onSendMessage={() => {}} typingUsers={[]} />
    );
    expect(document.querySelectorAll('.typing-indicator').length).toBe(0);
  });

  it('llama onTyping al teclear con texto (el hook lo throttlea)', () => {
    const onTyping = vi.fn();
    render(
      <Chat
        messages={baseMessages}
        onSendMessage={() => {}}
        typingUsers={[]}
        onTyping={onTyping}
      />
    );
    const input = screen.getByPlaceholderText('Escribe un mensaje…');
    fireEvent.change(input, { target: { value: 'h' } });
    expect(onTyping).toHaveBeenCalledTimes(1);
  });

  it('NO llama onTyping si el texto está vacío (solo espacios)', () => {
    const onTyping = vi.fn();
    render(
      <Chat
        messages={baseMessages}
        onSendMessage={() => {}}
        typingUsers={[]}
        onTyping={onTyping}
      />
    );
    const input = screen.getByPlaceholderText('Escribe un mensaje…');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(onTyping).not.toHaveBeenCalled();
  });
});
