// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RoomHeader } from '../src/components/RoomHeader';
import { RoomSettingsModal } from '../src/components/RoomSettingsModal';
import { VideoUploadPicker } from '../src/features/player/VideoUploadPicker';
import {
  DEMO_UPLOAD_DISABLED_MESSAGE,
  isDemoMode,
} from '../src/shared/demo';

/**
 * Demo gratuita (`demo-free`): flags visuales tras `VITE_DEMO_MODE`
 * (default `true` en esta rama; con `false` todo vuelve al original).
 * `matchMedia` se stubbea porque jsdom no lo implementa y `BottomSheet`
 * lo usa para decidir portal vs inline.
 */
function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubMatchMedia();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isDemoMode tras VITE_DEMO_MODE', () => {
  it('default true sin variable (rama demo-free)', () => {
    expect(isDemoMode()).toBe(true);
  });

  it('false restaura el original', () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    expect(isDemoMode()).toBe(false);
  });
});

describe('RoomHeader en demo', () => {
  const baseProps = {
    roomId: 'ABC123',
    participantCount: 3,
    isHost: true,
    roomStatus: 'active' as const,
    videoDurationSeconds: 125,
    onOpenSettings: vi.fn(),
    onOpenParticipants: vi.fn(),
    onLeaveClick: vi.fn(),
  };

  it('muestra capacidad X/5 y duración del vídeo', async () => {
    await act(async () => {
      render(<RoomHeader {...baseProps} />);
    });
    const capacity = screen.getByTestId('room-capacity');
    expect(capacity).toHaveTextContent('3/5');
    expect(capacity).toHaveAttribute(
      'title',
      '3 de 5 participantes — ver lista',
    );
    // 125 s → formato m:ss reutilizado (2:05)
    expect(screen.getByTestId('video-duration')).toHaveTextContent('2:05');
  });

  it('sin vídeo no muestra duración; sin estado no muestra píldora', async () => {
    await act(async () => {
      render(
        <RoomHeader
          roomId="ABC123"
          participantCount={1}
          isHost={false}
          roomStatus={undefined}
          videoDurationSeconds={null}
        />,
      );
    });
    expect(screen.getByTestId('room-capacity')).toHaveTextContent('1/5');
    expect(screen.queryByTestId('room-status')).toBeNull();
    expect(screen.queryByTestId('video-duration')).toBeNull();
  });

  it('sala premium: capacidad X/10 y badge Premium', async () => {
    await act(async () => {
      render(<RoomHeader {...baseProps} roomPlan="premium" />);
    });
    const capacity = screen.getByTestId('room-capacity');
    expect(capacity).toHaveTextContent('3/10');
    expect(capacity).toHaveAttribute(
      'title',
      '3 de 10 participantes — ver lista',
    );
    expect(screen.getByText('Premium')).toBeDefined();
  });

  it('con VITE_DEMO_MODE=false vuelve al conteo original sin extras', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    await act(async () => {
      render(<RoomHeader {...baseProps} />);
    });
    expect(screen.getByTestId('room-capacity')).toHaveTextContent('3');
    expect(screen.queryByTestId('room-status')).toBeNull();
    expect(screen.queryByTestId('video-duration')).toBeNull();
  });
});

describe('VideoUploadPicker en demo', () => {
  const pickerProps = {
    activeTab: 'url' as const,
    setActiveTab: vi.fn(),
    urlInput: '',
    titleInput: '',
    setUrlInput: vi.fn(),
    setTitleInput: vi.fn(),
    isSubmittingUrl: false,
    onUrlSubmit: vi.fn(),
    isDragOver: false,
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
    onTriggerFile: vi.fn(),
  };

  it('tab de archivo disabled con tooltip y tab de enlace Drive visible', async () => {
    await act(async () => {
      render(<VideoUploadPicker {...pickerProps} />);
    });
    const uploadTab = screen.getByTestId('demo-upload-tab');
    expect(uploadTab).toBeDisabled();
    expect(uploadTab).toHaveAttribute('title', DEMO_UPLOAD_DISABLED_MESSAGE);
    expect(screen.getByText('Pegar enlace de Google Drive')).toBeDefined();
    expect(screen.getByTestId('demo-upload-note')).toHaveTextContent(
      DEMO_UPLOAD_DISABLED_MESSAGE,
    );
  });

  it('nunca muestra el panel de subida aunque activeTab sea upload', async () => {
    await act(async () => {
      render(<VideoUploadPicker {...pickerProps} activeTab="upload" />);
    });
    // El formulario de enlace se muestra en su lugar (sin dropzone de archivo)
    expect(screen.getByText('Pegar enlace de Google Drive')).toBeDefined();
    expect(screen.queryByText('Seleccionar de mi PC')).toBeNull();
  });

  it('con VITE_DEMO_MODE=false vuelve a los tabs originales', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    await act(async () => {
      render(<VideoUploadPicker {...pickerProps} />);
    });
    expect(screen.getByTestId('demo-upload-tab')).not.toBeDisabled();
    expect(screen.getByText('Enlace Web / HLS')).toBeDefined();
    expect(screen.queryByTestId('demo-upload-note')).toBeNull();
  });
});

describe('RoomSettingsModal en demo', () => {
  const modalProps = {
    isOpen: true,
    onClose: vi.fn(),
    isTemporary: true,
    onToggleTemporary: vi.fn(),
    roomName: 'Noche de peli',
    roomDescription: 'Pelis del viernes',
    timerMinutes: null as number | null,
    timerEndsAt: null as string | null,
    requireApproval: false,
    onSaveDetails: vi.fn(),
    onSetTimer: vi.fn(),
    onToggleRequireApproval: vi.fn(),
  };

  it('timer configurable y sala persistente deshabilitados con aviso', async () => {
    await act(async () => {
      render(<RoomSettingsModal {...modalProps} />);
    });
    // 6 chips de timer, todos disabled con tooltip del servidor
    const chips = screen.getAllByRole('button', { name: /min|h$/ });
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip).toBeDisabled();
      expect(chip).toHaveAttribute(
        'title',
        'En la demo el temporizador lo configura el servidor',
      );
    }
    expect(screen.getByTestId('demo-timer-note')).toBeDefined();
    // Persistencia: checkbox disabled forzado a temporal (el title está en
    // label e input para el tooltip; se busca el input entre ambos)
    const tempCandidates = screen.getAllByTitle(
      'En la demo todas las salas son temporales',
    );
    const tempCheckbox = tempCandidates.find(
      (el): el is HTMLInputElement => el instanceof HTMLInputElement,
    );
    expect(tempCheckbox).toBeDefined();
    expect(tempCheckbox).toBeDisabled();
    expect(tempCheckbox!.checked).toBe(true);
  });

  it('con VITE_DEMO_MODE=false los controles siguen habilitados', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    await act(async () => {
      render(<RoomSettingsModal {...modalProps} />);
    });
    const chips = screen.getAllByRole('button', { name: /min|h$/ });
    for (const chip of chips) {
      expect(chip).not.toBeDisabled();
    }
    expect(screen.queryByTestId('demo-timer-note')).toBeNull();
  });
});
