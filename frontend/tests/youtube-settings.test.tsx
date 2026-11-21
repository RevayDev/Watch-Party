// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { YouTubeSettingsSection } from '../src/components/YouTubeSettingsSection';

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });
it('registers the key privately and shares only the provider reference with the room', async () => {
  const id = 'a'.repeat(64);
  const fetch = vi.fn().mockImplementation((_url, options) => Promise.resolve(options?.method === 'POST'
    ? Response.json({ id, owner: 'b'.repeat(64) }, { status: 201 })
    : Response.json({ configured: true })));
  vi.stubGlobal('fetch', fetch);
  const onChange = vi.fn();
  render(<YouTubeSettingsSection canEdit onChange={onChange} />);
  await screen.findByText(/plataforma está disponible/);
  fireEvent.click(screen.getByRole('radio', { name: /Proveedor de esta sala/ }));
  const input = screen.getByLabelText('API key') as HTMLInputElement;
  expect(input.type).toBe('password');
  fireEvent.change(input, { target: { value: 'private-test-key-for-room' } });
  fireEvent.click(screen.getByRole('button', { name: 'Registrar para la sala' }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(id));
  expect(input.value).toBe('');
  expect(JSON.stringify(onChange.mock.calls)).not.toContain('private-test-key');
  expect(sessionStorage.getItem(`youtube-provider-owner:${id}`)).toBe('b'.repeat(64));
});

it('lets a participant inspect the current provider without changing the room', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ configured: false })));
  render(<YouTubeSettingsSection canEdit={false} />);
  await screen.findByText(/no tiene una API key/);
  expect(screen.getByRole('radio', { name: /Servicio de la plataforma/ })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Usar plataforma' })).toBeNull();
});
