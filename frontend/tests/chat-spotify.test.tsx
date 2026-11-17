// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Chat } from '../src/features/chat/Chat';

/**
 * Chat sin mezclas: la barra de escribir solo tiene input + Enviar
 * (la música vive en su propia pestaña del drawer).
 */

const chatProps = (overrides: Partial<Record<string, any>> = {}) => ({
  messages: [],
  onSendMessage: vi.fn(),
  ...overrides,
});

describe('Chat (barra de mensaje limpia)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('muestra input y Enviar sin botón de música', () => {
    render(<Chat {...chatProps()} />);
    expect(screen.getByPlaceholderText(/escribe un mensaje/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /enviar mensaje/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /música|spotify/i })).toBeNull();
  });

  it('envía el mensaje escrito', async () => {
    const onSendMessage = vi.fn();
    render(<Chat {...chatProps({ onSendMessage })} />);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/escribe un mensaje/i), {
        target: { value: 'Hola sala' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /enviar mensaje/i }));
    });
    expect(onSendMessage).toHaveBeenCalledWith('Hola sala', null);
  });
});
