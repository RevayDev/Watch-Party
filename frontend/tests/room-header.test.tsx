// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomHeader } from '../src/components/RoomHeader';

describe('RoomHeader — reloj de sala y temporizador', () => {
  it('renderiza el pill de reloj con tiempo transcurrido y abre su menú al hacer click', () => {
    const createdAt = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min atrás
    const timerEndsAt = new Date(Date.now() + 195 * 60 * 1000).toISOString(); // 195 min restantes

    render(
      <RoomHeader
        roomId="TEST12"
        participantCount={3}
        isHost={true}
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
