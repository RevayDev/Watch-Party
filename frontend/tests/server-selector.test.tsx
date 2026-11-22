// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ServerSelector } from '../src/features/home/ServerSelector';

afterEach(() => vi.unstubAllGlobals());

it('disables Render and selects browser hosting when the health endpoint fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const onChange = vi.fn();
  const available = vi.fn();
  render(<ServerSelector mode="external" onChange={onChange} onAvailability={available} />);
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('host'));
  expect(screen.getByRole('radio', { name: /Servidor externo/ })).toBeDisabled();
  expect(screen.getByRole('radio', { name: /Servidor externo/ })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reintentar conexión del servidor' })).toBeEnabled();
  expect(screen.getByRole('radio', { name: /Navegador del anfitrión/ })).toBeEnabled();
  expect(available).toHaveBeenLastCalledWith(false);
});

it('enables Render only after validating its health response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));
  const available = vi.fn();
  const onChange = vi.fn();
  render(<ServerSelector mode="external" onChange={onChange} onAvailability={available} />);
  await waitFor(() => expect(available).toHaveBeenLastCalledWith(true));
  expect(screen.getByRole('radio', { name: /Servidor externo/ })).toBeEnabled();
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps mixed mode selected when Render is offline so creation can fall back to the host', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const onChange = vi.fn();
  const available = vi.fn();
  render(<ServerSelector mode="hybrid" onChange={onChange} onAvailability={available} />);
  await waitFor(() => expect(available).toHaveBeenLastCalledWith(false));
  expect(screen.getByRole('radio', { name: /Mixto inteligente/ })).toBeChecked();
  expect(onChange).not.toHaveBeenCalled();
});


it('retries in place without removing the external card', async () => {
 const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Response.json({ ok: true }));
 vi.stubGlobal('fetch', fetch);
 const onChange = vi.fn(), onAvailability = vi.fn();
 render(<ServerSelector mode="host" onChange={onChange} onAvailability={onAvailability} />);
 const card = screen.getByRole('radio', { name: /Servidor externo/ });
 await waitFor(() => expect(onAvailability).toHaveBeenLastCalledWith(false));
 await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar conexión del servidor' })).toBeEnabled());
 fireEvent.click(screen.getByRole('button', { name: 'Reintentar conexión del servidor' }));
 await waitFor(() => expect(onAvailability).toHaveBeenLastCalledWith(true));
 expect(screen.getByRole('radio', { name: /Servidor externo/ })).toBe(card);
 expect(card).toBeEnabled();
});
