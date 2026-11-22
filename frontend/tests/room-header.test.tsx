// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoomHeader } from '../src/components/RoomHeader';

describe('RoomHeader — reloj de sala y temporizador', () => {
  it('renderiza el pill de reloj con tiempo transcurrido y abre su menú al hacer click', () => {
    const createdAt = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min atrás
    const timerEndsAt = new Date(Date.now() + 195 * 60 * 1000).toISOString(); // 195 min restantes

    render(
      <RoomHeader
        roomId="TEST12"
        participantCount={3}
        isLeader={true}
        createdAt={createdAt}
        timerEndsAt={timerEndsAt}
      />
    );

    // Encuentra el botón del temporizador por su título
    const clockBtn = screen.getByTitle(/tiempo restante de la sala/i);
    expect(clockBtn).toBeTruthy();

    // Al hacer click, despliega el menú con "Llevan" y "Quedan"
    fireEvent.click(clockBtn);

    expect(screen.getByText(/Tiempo en sala/i)).toBeTruthy();
    expect(screen.getByText(/Llevan/i)).toBeTruthy();
    expect(screen.getByText(/Tiempo restante/i)).toBeTruthy();
    expect(screen.getByText(/Quedan/i)).toBeTruthy();
    expect(screen.getByText(/Hora de cierre/i)).toBeTruthy();
  });
});

it('keeps the portaled share menu interactive when copying its room code', async () => {
 const writeText = vi.fn(async () => {});
 Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{writeText} });
 const view=render(<RoomHeader roomId="SHARE1" participantCount={1} isLeader onOpenSettings={()=>{}} />);
 fireEvent.click(screen.getByRole('button',{name:'Compartir sala'}));
 const copy=screen.getByTitle('Copiar código');
 expect(view.container.contains(copy)).toBe(false);
 fireEvent.mouseDown(copy); fireEvent.click(copy);
 await waitFor(()=>expect(writeText).toHaveBeenCalledWith('SHARE1'));
});
