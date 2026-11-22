// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Chat } from '../src/features/chat/Chat';
import { PlayerActionDock } from '../src/features/player/PlayerActionDock';
afterEach(cleanup);
it('portals message actions outside the scrolling history and dispatches delete and reactions', () => {
 const remove = vi.fn(), react = vi.fn();
 const view = render(<Chat currentUserName="Ana" messages={[{ id:'a', user:'Ana', text:'Hola', timestamp:'10:30' }]} onSendMessage={vi.fn()} onDeleteMessage={remove} onReactMessage={react} />);
 fireEvent.click(screen.getByRole('button', { name:'Más opciones del mensaje' }));
 const menu = screen.getByLabelText('Opciones del mensaje');
 expect(view.container.contains(menu)).toBe(false);
 fireEvent.click(screen.getByRole('button', { name:'Eliminar mensaje' })); expect(remove).toHaveBeenCalledWith('a');
 fireEvent.click(screen.getByRole('button', { name:'Reaccionar al mensaje de Ana' }));
 fireEvent.click(screen.getByRole('button', { name:'Reaccionar con ❤️' })); expect(react).toHaveBeenCalledWith('a','❤️');
});
it('folds video actions into the right edge and restores their controls', () => {
 const change = vi.fn(), clear = vi.fn(); render(<div><PlayerActionDock onChange={change} onClear={clear} /></div>);
 fireEvent.click(screen.getByTitle('Cambiar video: subir archivo o pegar enlace')); expect(change).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button', {name:'Ocultar acciones del video'}));
 expect(screen.queryByTitle('Quitar video')).toBeNull();
 fireEvent.click(screen.getByRole('button', {name:'Mostrar acciones del video'}));
 fireEvent.click(screen.getByTitle('Quitar video')); expect(clear).toHaveBeenCalledTimes(1);
});
