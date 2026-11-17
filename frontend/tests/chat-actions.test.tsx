// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Chat } from '../src/features/chat/Chat';
import type { ChatMessage } from '../src/types/room';

const msg = (id: string, user = 'Beto', text = 'hola'): ChatMessage => ({
  id,
  user,
  text: `${text} ${id}`,
  timestamp: '10:00',
});

let scrollToMock!: ReturnType<typeof vi.fn>;

function mockGeometry() {
  scrollToMock = vi.fn();
  Object.defineProperty(window.HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: scrollToMock,
  });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => 5000,
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 500,
  });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
}

function restoreGeometry() {
  vi.restoreAllMocks();
  delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo;
  delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
}

function renderChat(ui: React.ReactElement) {
  let utils!: ReturnType<typeof render>;
  act(() => {
    utils = render(ui);
  });
  return utils;
}

describe('Chat (flechita para bajar)', () => {
  afterEach(() => {
    restoreGeometry();
  });

  it('aparece al subir y baja al pulsarla', () => {
    mockGeometry();
    const { container } = renderChat(
      <Chat messages={[msg('m1')]} onSendMessage={() => {}} typingUsers={[]} currentUserName="Ana" />
    );
    expect(screen.queryByRole('button', { name: /bajar al último mensaje/i })).toBeNull();
    const el = container.querySelector('.drawer-chat__messages') as HTMLElement;
    Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: 0 });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 5000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 500 });
    act(() => {
      fireEvent.scroll(el);
    });
    const jump = screen.getByRole('button', { name: /bajar al último mensaje/i });
    act(() => {
      fireEvent.click(jump);
    });
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' })
    );
  });

  it('muestra insignia con no leídos (tope 99+)', () => {
    mockGeometry();
    const { container } = renderChat(
      <Chat
        messages={[msg('m1')]}
        onSendMessage={() => {}}
        typingUsers={[]}
        currentUserName="Ana"
        unreadCount={150}
      />
    );
    const el = container.querySelector('.drawer-chat__messages') as HTMLElement;
    Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: 0 });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 5000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 500 });
    act(() => {
      fireEvent.scroll(el);
    });
    expect(screen.getByText('99+')).toBeDefined();
  });
});

describe('Chat (editar mensaje propio)', () => {
  afterEach(() => {
    restoreGeometry();
  });

  it('precarga el input, guarda y permite cancelar', async () => {
    mockGeometry();
    const onEditMessage = vi.fn();
    renderChat(
      <Chat
        messages={[msg('m1', 'Ana', 'texto')]}
        onSendMessage={() => {}}
        onEditMessage={onEditMessage}
        typingUsers={[]}
        currentUserName="Ana"
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /editar mensaje/i }));
    });
    expect(screen.getByText('Editando mensaje')).toBeDefined();
    const input = screen.getByPlaceholderText(/edita tu mensaje/i) as HTMLInputElement;
    expect(input.value).toBe('texto m1');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'texto editado' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /enviar mensaje/i }));
    });
    expect(onEditMessage).toHaveBeenCalledWith('m1', 'texto editado');
    expect(screen.queryByText('Editando mensaje')).toBeNull();
  });

  it('cancelar edición restaura el input', async () => {
    mockGeometry();
    renderChat(
      <Chat
        messages={[msg('m1', 'Ana', 'texto')]}
        onSendMessage={() => {}}
        typingUsers={[]}
        currentUserName="Ana"
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /editar mensaje/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancelar edición/i }));
    });
    expect(screen.queryByText('Editando mensaje')).toBeNull();
    expect((screen.getByPlaceholderText(/escribe un mensaje/i) as HTMLInputElement).value).toBe('');
  });

  it('los mensajes ajenos no tienen botón de editar', () => {
    mockGeometry();
    renderChat(
      <Chat messages={[msg('m1', 'Beto')]} onSendMessage={() => {}} typingUsers={[]} currentUserName="Ana" />
    );
    expect(screen.queryByRole('button', { name: /editar mensaje/i })).toBeNull();
    expect(screen.getByRole('button', { name: /responder a beto/i })).toBeDefined();
  });

  it('muestra la marca de editado', () => {
    mockGeometry();
    renderChat(
      <Chat
        messages={[{ ...msg('m1', 'Ana'), text: 'texto corregido', edited: true }]}
        onSendMessage={() => {}}
        typingUsers={[]}
        currentUserName="Ana"
      />
    );
    expect(document.querySelector('.drawer-chat__edited')).not.toBeNull();
  });
});

describe('Chat (responder con cita)', () => {
  afterEach(() => {
    restoreGeometry();
  });

  it('responde con cita y la envía adjunta', async () => {
    mockGeometry();
    const onSendMessage = vi.fn();
    renderChat(
      <Chat messages={[msg('m1', 'Beto', 'hola')]} onSendMessage={onSendMessage} typingUsers={[]} currentUserName="Ana" />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /responder a beto/i }));
    });
    expect(screen.getByText(/respondiendo a/i)).toBeDefined();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/escribe un mensaje/i), {
        target: { value: 'de acuerdo' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /enviar mensaje/i }));
    });
    expect(onSendMessage).toHaveBeenCalledWith('de acuerdo', {
      id: 'm1',
      user: 'Beto',
      text: 'hola m1',
    });
  });

  it('quitar la respuesta envía sin cita', async () => {
    mockGeometry();
    const onSendMessage = vi.fn();
    renderChat(
      <Chat messages={[msg('m1', 'Beto')]} onSendMessage={onSendMessage} typingUsers={[]} currentUserName="Ana" />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /responder a beto/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /quitar respuesta/i }));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/escribe un mensaje/i), {
        target: { value: 'solo' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /enviar mensaje/i }));
    });
    expect(onSendMessage).toHaveBeenCalledWith('solo', null);
  });

  it('la cita se renderiza y salta al original al pulsarla', async () => {
    mockGeometry();
    const withQuote: ChatMessage = {
      ...msg('m2', 'Ana', 'respuesta'),
      replyTo: { id: 'm1', user: 'Beto', text: 'hola m1' },
    };
    const { container } = renderChat(
      <Chat
        messages={[msg('m1', 'Beto', 'hola'), withQuote]}
        onSendMessage={() => {}}
        typingUsers={[]}
        currentUserName="Ana"
      />
    );
    const quote = screen.getByTitle('Ir al mensaje de Beto');
    expect(quote.textContent).toContain('hola m1');
    const target = container.querySelector('#msg-m1') as HTMLElement;
    const spy = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', { configurable: true, writable: true, value: spy });
    await act(async () => {
      fireEvent.click(quote);
    });
    expect(spy).toHaveBeenCalled();
  });
});
