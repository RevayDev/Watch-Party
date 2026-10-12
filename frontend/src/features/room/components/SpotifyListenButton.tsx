import React from 'react';
import { Music } from 'lucide-react';

export type SpotifyConnState = 'loading' | 'disconnected' | 'connected' | 'error';

interface SpotifyListenButtonProps {
  /** Estado de la conexión (opcional en YouTube). */
  state?: SpotifyConnState;
  /** Cuenta vinculada, si se conoce. */
  accountName?: string | null;
  /** ¿Está abierto el panel musical? (anillo activo). */
  panelOpen: boolean;
  /** Abre/cierra el panel musical. */
  onTogglePanel: () => void;
  onConnect?: () => void;
}

/**
 * Botón de Música y Karaoke en la barra inferior (y chat).
 * Abre/cierra directamente la pestaña Música (cola colaborativa de YouTube).
 */
export const SpotifyListenButton: React.FC<SpotifyListenButtonProps> = ({
  panelOpen,
  onTogglePanel,
}) => {
  return (
    <button
      type="button"
      onClick={onTogglePanel}
      className={`meet-circle-btn meet-circle-btn--music${panelOpen ? ' meet-circle-btn--active' : ''}`}
      title={panelOpen ? 'Cerrar panel de música' : 'Abrir música y cola colaborativa (YouTube)'}
      aria-label={panelOpen ? 'Cerrar panel de música' : 'Abrir música y cola colaborativa (YouTube)'}
    >
      <Music size={18} />
    </button>
  );
};

export default SpotifyListenButton;
