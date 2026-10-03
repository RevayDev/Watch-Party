import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WaitingApproval } from '../src/features/waiting/WaitingApproval';

describe('WaitingApproval Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock navigator.mediaDevices
    const mockGetUserMedia = vi.fn().mockResolvedValue({
      getAudioTracks: () => [{ stop: vi.fn(), readyState: 'live' }],
      getVideoTracks: () => [{ stop: vi.fn(), readyState: 'live' }],
    });
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: mockGetUserMedia,
      },
    });
  });

  it('renderiza la sala, usuario y estado de espera', async () => {
    await act(async () => {
      render(
        <WaitingApproval
          roomId="TEST99"
          userName="Carlos"
          roomName="Sala de Pruebas"
          roomDescription="Descripción de prueba"
          onCancel={vi.fn()}
        />
      );
    });

    expect(screen.getByText(/Esperando aprobación/i)).toBeDefined();
    expect(screen.getByText('TEST99')).toBeDefined();
    expect(screen.getByText('Sala de Pruebas')).toBeDefined();
    expect(screen.getByText('Descripción de prueba')).toBeDefined();
    expect(screen.getByText('Carlos (tú)')).toBeDefined();
  });

  it('llama onCancel al hacer clic en Cancelar solicitud', async () => {
    const handleCancel = vi.fn();
    await act(async () => {
      render(
        <WaitingApproval
          roomId="TEST99"
          userName="Carlos"
          onCancel={handleCancel}
        />
      );
    });

    const cancelBtn = screen.getByText('Cancelar solicitud');
    fireEvent.click(cancelBtn);
    expect(handleCancel).toHaveBeenCalledTimes(1);
  });

  it('permite alternar el estado del micrófono', async () => {
    const handlePrefChange = vi.fn();
    await act(async () => {
      render(
        <WaitingApproval
          roomId="TEST99"
          userName="Carlos"
          initialMicOn={false}
          initialCamOn={false}
          onPrefChange={handlePrefChange}
          onCancel={vi.fn()}
        />
      );
    });

    const micBtn = screen.getByTitle('Encender micrófono');
    await act(async () => {
      fireEvent.click(micBtn);
    });

    expect(handlePrefChange).toHaveBeenCalledWith(true, false);
  });
});
