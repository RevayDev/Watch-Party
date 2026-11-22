// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ScreenSharingStage } from '../src/components/ScreenSharingStage';

it('hides the presenter preview to prevent a screen-sharing mirror and offers a Spanish stop action', () => {
  const stop = vi.fn();
  const localScreen = {} as MediaStream;
  const { container } = render(
    <ScreenSharingStage localScreenStream={localScreen} isScreenSharing remotePeers={[]} peerMediaStates={{}} onStopSharing={stop} />,
  );
  expect(screen.getByText('Estás compartiendo tu pantalla')).toBeTruthy();
  expect(screen.getByText('Ocultamos la vista previa para evitar el efecto espejo.')).toBeTruthy();
  expect(container.querySelector('video')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Dejar de compartir' }));
  expect(stop).toHaveBeenCalledOnce();
});
