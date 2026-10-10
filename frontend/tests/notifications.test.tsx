// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { NotificationProvider, notify } from '../src/services/notifications';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('notifications (sin duplicados)', () => {
  it('el mismo aviso dos veces seguidas sale una sola vez, con su X', () => {
    act(() => {
      render(<NotificationProvider><span>app</span></NotificationProvider>);
    });
    act(() => {
      notify('info', 'Roberto se unió a la sala', 'Participantes');
    });
    act(() => {
      notify('info', 'Roberto se unió a la sala', 'Participantes');
    });
    expect(document.querySelectorAll('.notif-toast')).toHaveLength(1);
    // El que queda es el del toggle de la X.
    expect(document.querySelector('.notif-toast__close')).not.toBeNull();
  });

  it('avisos distintos sí se apilan', () => {
    act(() => {
      render(<NotificationProvider><span>app</span></NotificationProvider>);
    });
    act(() => {
      notify('info', 'Roberto se unió a la sala', 'Participantes');
    });
    act(() => {
      notify('info', 'Carlos se unió a la sala', 'Participantes');
    });
    expect(document.querySelectorAll('.notif-toast')).toHaveLength(2);
  });
});
