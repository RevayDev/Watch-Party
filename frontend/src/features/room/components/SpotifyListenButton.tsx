import React from 'react';
import { Music } from 'lucide-react';

export type SpotifyConnState = 'loading' | 'disconnected' | 'connected' | 'error';

interface SpotifyListenButtonProps {
  /** Estado de la conexión (lo consulta el padre; el botón no hace fetch). */
  state: SpotifyConnState;
  /** Cuenta vinculada, si se conoce (tooltip). */
  accountName?: string | null;
  /** ¿Está abierto el panel musical? (anillo activo). */
  panelOpen: boolean;
  /** Conectado: abre/cierra el panel. Desconectado o error: conecta. */
  onTogglePanel: () => void;
  onConnect: () => void;
}

const DOT_CLASS: Record<SpotifyConnState, string> = {
  loading: 'spotify-status-dot spotify-status-dot--loading',
  disconnected: 'spotify-status-dot spotify-status-dot--disconnected',
  connected: 'spotify-status-dot spotify-status-dot--connected',
  error: 'spotify-status-dot spotify-status-dot--error',
};

function titleFor(state: SpotifyConnState, accountName?: string | null, panelOpen?: boolean): string {
  switch (state) {
    case 'connected':
      return `Música${accountName ? ` (conectado como ${accountName})` : ''} — ${panelOpen ? 'cerrar panel' : 'abrir panel'}`;
    case 'error':
      return 'Spotify: error de conexión — pulsa para vincular de nuevo';
    case 'loading':
      return 'Spotify: comprobando conexión…';
    default:
      return 'Spotify: vincular cuenta para la música de la sala';
  }
}

/**
 * Botón musical del footer (y del chat): mismo círculo que los demás.
 * - Desconectado o error → inicia el OAuth (pestaña nueva, sin perder la sala).
 * - Conectado → abre/cierra el panel musical (toggle, como Chat).
 * El punto indica el estado: gris = desconectado, verde = conectado,
 * rojo = error. Cerrar el panel no desconecta ni vacía la cola.
 */
export const SpotifyListenButton: React.FC<SpotifyListenButtonProps> = ({
  state,
  accountName,
  panelOpen,
  onTogglePanel,
  onConnect,
}) => {
  const loading = state === 'loading';
  const linked = state === 'connected';
  return (
    <button
      type="button"
      onClick={() => (linked ? onTogglePanel() : onConnect())}
      className={`meet-circle-btn meet-circle-btn--music${linked && panelOpen ? ' meet-circle-btn--active' : ''}`}
      title={titleFor(state, accountName, panelOpen)}
      aria-label={titleFor(state, accountName, panelOpen)}
      disabled={loading}
      aria-busy={loading}
    >
      <Music size={18} />
      <span className={DOT_CLASS[state]} aria-hidden="true" />
    </button>
  );
};

export default SpotifyListenButton;
