// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ServerSelector } from '../src/features/home/ServerSelector';

afterEach(() => vi.unstubAllGlobals());

it('disables Render and selects browser hosting when the health endpoint fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const onChange = vi.fn();
  const available = vi.fn();
  render(<ServerSelector mode="external" onChange={onChange} onAvailability={available} />);
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('host'));
  expect(screen.getByRole('radio', { name: /Servidor externo/ })).toBeDisabled();
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
