import React, { useState } from 'react';
import { Music } from 'lucide-react';
import { ApiService } from '../../../services/api';

/**
 * Playlist ambiente por defecto (música de espera mientras entra la gente).
 * El anfitrión puede cambiarla desde la pestaña Spotify ("Cambiar").
 */
export const DEFAULT_AMBIENT_SPOTIFY_URL =
  'https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6';

interface SpotifyListenButtonProps {
  roomId: string;
  /** Enlace público de lo que suena (null = sin fuente Spotify). */
  openUrl: string | null;
  /** ¿Puede poner música en la sala (anfitrión/co-anfitrión)? */
  canPlayAmbient: boolean;
  /** Pone el ambiente en la sala (API + `video-changed` a todos). */
  onPlayAmbient: () => Promise<void>;
}

/**
 * Botón Spotify del footer (como los demás botones circulares).
 * Música ambiente mientras entra la gente + vincular cuenta estilo
 * Instagram (pantalla oficial de Autorizar de Spotify vía OAuth):
 * - Sin cuenta vinculada → redirige (misma pestaña) a vincularla.
 * - Vinculada + anfitrión + nada sonando → ambiente para toda la sala.
 * - Sonando Spotify → abre lo que suena para escucharlo.
 * - Miembro sin nada sonando → abre el ambiente en su propio Spotify.
 */
export const SpotifyListenButton: React.FC<SpotifyListenButtonProps> = ({
  roomId,
  openUrl,
  canPlayAmbient,
  onPlayAmbient,
}) => {
  const [checking, setChecking] = useState(false);

  const handleClick = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const status = await ApiService.spotifyStatus(roomId);
      if (status.configured && !status.connected) {
        // Vincular cuenta (pantalla oficial de Spotify, como Instagram).
        const { authUrl } = await ApiService.spotifyAuthUrl(roomId);
        window.open(authUrl, '_self');
        return;
      }
      if (openUrl) {
        // Ya suena Spotify en la sala: escucharlo.
        window.open(openUrl, '_blank');
        return;
      }
      if (canPlayAmbient) {
        // Sonidito de ambiente para toda la sala mientras entra la gente.
        // Funciona sin OAuth: el embed es público (el backend no exige token
        // para guardar enlaces Spotify).
        try {
          await onPlayAmbient();
        } catch {
          window.open(DEFAULT_AMBIENT_SPOTIFY_URL, '_blank');
        }
        return;
      }
      window.open(DEFAULT_AMBIENT_SPOTIFY_URL, '_blank');
    } catch {
      // Sin red o con error: igual se puede escuchar el enlace público.
      window.open(openUrl ?? DEFAULT_AMBIENT_SPOTIFY_URL, '_blank');
    } finally {
      setChecking(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      className="meet-circle-btn"
      title="Spotify: vincular cuenta y música ambiente"
      disabled={checking}
      aria-busy={checking}
    >
      <Music size={18} />
    </button>
  );
};

export default SpotifyListenButton;
