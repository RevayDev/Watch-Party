// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Chat } from '../src/features/chat/Chat';
beforeEach(() => {
 vi.useFakeTimers();
 class TouchPointer extends MouseEvent { pointerType: string; pointerId: number; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerType=init.pointerType ?? 'touch'; this.pointerId=init.pointerId ?? 1; } }
 vi.stubGlobal('PointerEvent', TouchPointer);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(user='Ana') { render(<Chat currentUserName="Ana" messages={[{id:'m',user,text:'Mensaje',timestamp:'10:30'}]} onSendMessage={vi.fn()} />); return document.getElementById('msg-m')!; }
it('opens all own-message actions after holding, and retains the menu on release', () => {
 const message=setup();
 fireEvent.pointerDown(message,{pointerType:'touch',pointerId:1,clientX:30,clientY:30});
 act(()=>vi.advanceTimersByTime(499)); expect(screen.queryByLabelText('Opciones del mensaje')).toBeNull();
 act(()=>vi.advanceTimersByTime(1)); fireEvent.pointerUp(message,{pointerType:'touch'});
 expect(screen.getByRole('button',{name:'Responder',exact:true})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Reaccionar',exact:true})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Editar mensaje',exact:true})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Eliminar mensaje',exact:true})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Reaccionar',exact:true}));
 expect(screen.getByRole('button',{name:'Reaccionar con ❤️'})).toBeTruthy();
});
it('does not offer edit/delete for another author', () => {
 const message=setup('Beto'); fireEvent.pointerDown(message,{pointerType:'touch'}); act(()=>vi.advanceTimersByTime(500));
 expect(screen.getByRole('button',{name:'Responder',exact:true})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Editar mensaje',exact:true})).toBeNull();
 expect(screen.queryByRole('button',{name:'Eliminar mensaje',exact:true})).toBeNull();
});
it.each(['short tap','movement','cancel','mouse'])('does not open on %s', kind => {
 const message=setup(); fireEvent.pointerDown(message,{pointerType:kind==='mouse'?'mouse':'touch',pointerId:1,clientX:30,clientY:30});
 if(kind==='short tap')fireEvent.pointerUp(message,{pointerType:'touch'});
 if(kind==='movement')fireEvent.pointerMove(message,{pointerType:'touch',pointerId:1,clientX:30,clientY:60});
 if(kind==='cancel')fireEvent.pointerCancel(message,{pointerType:'touch'});
 act(()=>vi.advanceTimersByTime(700)); expect(screen.queryByLabelText('Opciones del mensaje')).toBeNull();
});
