// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Chat, formatChatTime } from '../src/features/chat/Chat';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const messages = [{ id: 'one', user: 'Ana', text: 'Hola', timestamp: '2026-11-21T15:30:00.000Z' }, { id: 'two', user: 'Ana', text: 'Seguimos', timestamp: '2026-11-21T15:31:00.000Z' }];
it('formats ISO timestamps in the viewer locale and keeps legacy short times readable', () => {
 expect(formatChatTime(messages[0].timestamp)).toBe(new Date(messages[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
 expect(formatChatTime('10:30')).toBe('10:30');
});
it('places each reader avatar only under their most recent read message', () => {
 render(<Chat messages={messages} currentUserName="Ana" currentUserId="ana" onSendMessage={vi.fn()} readReceipts={[{ readerId: 'beto', userName: 'Beto', messageId: 'two' }, { readerId: 'ana', userName: 'Ana', messageId: 'two' }]} />);
 expect(screen.getAllByRole('img')).toHaveLength(1);
 const avatar = screen.getByRole('img', { name: 'Visto por Beto' });
 expect(avatar.parentElement?.previousElementSibling?.querySelector('#msg-two')).toBeTruthy();
 expect(document.querySelector('time')?.getAttribute('datetime')).toBe(messages[0].timestamp);
});
it('reports only visible messages while the document is visible, never moving backward', () => {
 let callback: IntersectionObserverCallback;
 class Observer { constructor(cb: IntersectionObserverCallback) { callback = cb; } observe() {} disconnect() {} }
 vi.stubGlobal('IntersectionObserver', Observer);
 const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
 const read = vi.fn(); render(<Chat messages={messages} onSendMessage={vi.fn()} onReadMessage={read} />);
 expect(read).not.toHaveBeenCalled();
 const entry = (id: string) => ({ target: document.getElementById('msg-' + id), isIntersecting: true, intersectionRatio: 1 }) as IntersectionObserverEntry;
 act(() => { callback!([entry('two')], {} as IntersectionObserver); }); expect(read).not.toHaveBeenCalled();
 visibility.mockReturnValue('visible');
 act(() => { callback!([entry('two')], {} as IntersectionObserver); }); expect(read).toHaveBeenCalledWith('two');
 act(() => { callback!([entry('one')], {} as IntersectionObserver); }); expect(read).toHaveBeenCalledTimes(1);
});
