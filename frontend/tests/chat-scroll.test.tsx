// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Chat } from '../src/features/chat/Chat';
import type { ChatMessage } from '../src/types/room';

const msg = (id: string, user = 'Beto', text = 'hola'): ChatMessage => ({
  id,
  user,
  text: `${text} ${id}`,
  timestamp: '10:00',
});

// jsdom no hace layout: se finge una lista alta (5000px) en ventana de 500px.
// Tampoco implementa scrollTo: se define un mock en el prototipo.
let scrollTopSetter!: ReturnType<typeof vi.spyOn>;
let scrollToMock!: ReturnType<typeof vi.fn>;
let origScrollHeight: PropertyDescriptor | undefined;
let origClientHeight: PropertyDescriptor | undefined;

function mockGeometry() {
  scrollTopSetter = vi.spyOn(window.HTMLElement.prototype, 'scrollTop', 'set');
  scrollToMock = vi.fn();
  Object.defineProperty(window.HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: scrollToMock,
  });
  origScrollHeight = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollHeight');
  origClientHeight = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => 5000,
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 500,
  });
}

function restoreGeometry() {
  vi.restoreAllMocks();
  delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo;
  if (origScrollHeight) {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', origScrollHeight);
  }
  if (origClientHeight) {
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', origClientHeight);
  }
}

function renderChat(messages: ChatMessage[], currentUserName = 'Ana') {
  return render(
    <Chat messages={messages} onSendMessage={() => {}} typingUsers={[]} currentUserName={currentUserName} />
  );
}

describe('Chat (auto-scroll al último mensaje)', () => {
  afterEach(() => {
    restoreGeometry();
  });

  it('al montar con historial existente baja al último mensaje', () => {
    mockGeometry();
    const messages = Array.from({ length: 50 }, (_, i) => msg(`m${i}`));
    renderChat(messages);
    // Salto instantáneo al fondo (scrollTop = scrollHeight).
    expect(scrollTopSetter).toHaveBeenCalledWith(5000);
  });

  it('nuevo mensaje con la vista al fondo hace scroll al final', () => {
    mockGeometry();
    const { rerender } = renderChat([msg('m1')]);
    scrollTopSetter.mockClear();
    scrollToMock.mockClear();
    rerender(
      <Chat messages={[msg('m1'), msg('m2')]} onSendMessage={() => {}} typingUsers={[]} currentUserName="Ana" />
    );
    expect(scrollToMock).toHaveBeenCalledWith({ top: 5000, behavior: 'auto' });
  });

  it('no roba el scroll si el usuario lee el historial', () => {
    mockGeometry();
    const { container, rerender } = renderChat([msg('m1')]);
    const el = container.querySelector('.drawer-chat__messages') as HTMLElement;
    // Simula vista arriba del todo (lejos del fondo).
    Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: 0 });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 5000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 500 });
    fireEvent.scroll(el);
    scrollToMock.mockClear();
    rerender(
      <Chat messages={[msg('m1'), msg('m2')]} onSendMessage={() => {}} typingUsers={[]} currentUserName="Ana" />
    );
    expect(scrollToMock).not.toHaveBeenCalled();
    const jump = screen.getByRole('button', { name: 'Bajar al último mensaje' });
    fireEvent.click(jump);
    expect(scrollToMock).toHaveBeenCalledWith({ top: 5000, behavior: 'smooth' });
    el.scrollTop = 4500;
    fireEvent.scroll(el);
    expect(screen.queryByRole('button', { name: 'Bajar al último mensaje' })).toBeNull();
  });

  it('reabre al final aunque el panel todavía esté montado durante el cierre', () => {
    mockGeometry();
    const props = { messages: [msg('m1'), msg('m2')], onSendMessage: vi.fn() };
    const { container, rerender } = render(<Chat {...props} isOpen />);
    const list = container.querySelector<HTMLElement>('.drawer-chat__messages')!;
    list.scrollTop = 0;
    fireEvent.scroll(list);
    expect(screen.getByRole('button', { name: 'Bajar al último mensaje' })).toBeDefined();

    rerender(<Chat {...props} isOpen={false} />);
    scrollTopSetter.mockClear();
    rerender(<Chat {...props} isOpen />);
    expect(scrollTopSetter).toHaveBeenCalledWith(5000);
    expect(screen.queryByRole('button', { name: 'Bajar al último mensaje' })).toBeNull();
  });

  it('ráfaga de mensajes propios usa salto instantáneo (no smooth eterno)', () => {
    mockGeometry();
    const { rerender } = renderChat([msg('m1', 'Ana')], 'Ana');
    scrollToMock.mockClear();
    const burst = [msg('m1', 'Ana'), ...Array.from({ length: 5 }, (_, i) => msg(`n${i}`, 'Ana'))];
    rerender(
      <Chat messages={burst} onSendMessage={() => {}} typingUsers={[]} currentUserName="Ana" />
    );
    expect(scrollToMock).toHaveBeenCalledWith({ top: 5000, behavior: 'auto' });
  });

  it('un mensaje propio aislado mantiene el scroll suave', () => {
    mockGeometry();
    const { rerender } = renderChat([msg('m1', 'Ana')], 'Ana');
    scrollToMock.mockClear();
    rerender(
      <Chat messages={[msg('m1', 'Ana'), msg('m2', 'Ana')]} onSendMessage={() => {}} typingUsers={[]} currentUserName="Ana" />
    );
    expect(scrollToMock).toHaveBeenCalledWith({ top: 5000, behavior: 'smooth' });
  });
});
