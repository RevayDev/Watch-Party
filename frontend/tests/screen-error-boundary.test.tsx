// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ScreenErrorBoundary } from '../src/shared/components/ScreenErrorBoundary';

it('offers recovery when a screen fails to load', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  function BrokenScreen(): React.ReactElement { throw new Error('Failed to fetch dynamically imported module'); }
  try {
    render(<ScreenErrorBoundary><BrokenScreen /></ScreenErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('No se pudo cargar');
    expect(screen.getByRole('button', { name: 'Volver a cargar' })).toBeTruthy();
  } finally { consoleError.mockRestore(); }
});
