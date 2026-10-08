// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Reactions, MAIN_EMOJIS, EXTRA_EMOJIS } from '../src/components/Reactions';

describe('Reactions — picker persistente + layout', () => {
  it('muestra ✨ y 🪐 en la fila principal junto a los demás principales', () => {
    render(<Reactions onReact={() => {}} />);
    const rows = document.querySelectorAll('.reactions-bar__row');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const btns = rows[0].querySelectorAll('.reactions-bar__btn');
    expect(btns.length).toBe(MAIN_EMOJIS.length + 1); // + botón "+"
    expect(btns[0].textContent).toBe('✨');
    expect(btns[1].textContent).toBe('🪐');
  });

  it('el botón + expande la fila extra con los emojis complementarios', () => {
    render(<Reactions onReact={() => {}} />);
    // No hay fila extra al inicio
    let extra = document.querySelector('.reactions-bar__row--extra');
    expect(extra).toBeNull();
    const moreBtn = screen.getByRole('button', { name: /mostrar más reacciones/i });
    fireEvent.click(moreBtn);
    // Ahora sí hay
    extra = document.querySelector('.reactions-bar__row--extra');
    expect(extra).toBeTruthy();
    const extraBtns = extra!.querySelectorAll('.reactions-bar__btn');
    expect(extraBtns.length).toBe(EXTRA_EMOJIS.length);
  });

  it('onReact se llama solo con emoji (NO cierra el picker desde dentro)', () => {
    const onReact = vi.fn();
    render(<Reactions onReact={onReact} />);
    const rows = document.querySelectorAll('.reactions-bar__row');
    const firstBtn = rows[0].querySelector('.reactions-bar__btn')!;
    fireEvent.click(firstBtn);
    expect(onReact).toHaveBeenCalledWith('✨');
    // El componente sigue montado (no se "autodestruye" tras el click)
    expect(document.querySelector('.reactions-bar')).toBeTruthy();
  });

  it('emitir varias reacciones seguidas funciona sin cerrar el picker', () => {
    const onReact = vi.fn();
    render(<Reactions onReact={onReact} />);
    const rows = document.querySelectorAll('.reactions-bar__row');
    const btns = rows[0].querySelectorAll('.reactions-bar__btn');
    fireEvent.click(btns[0]);
    fireEvent.click(btns[1]);
    fireEvent.click(btns[0]);
    expect(onReact).toHaveBeenCalledTimes(3);
    expect(onReact.mock.calls.map((c) => c[0])).toEqual(['✨', '🪐', '✨']);
  });
});

