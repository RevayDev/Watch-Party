import React, { useState } from 'react';
import { selfRedirectUri } from './spotifyUser';

interface SelfSpotifyLinkProps {
  linked: boolean;
  accountName: string | null;
  ownClientId: string | null;
  busy?: boolean;
  onSaveClientId: (clientId: string) => void;
  onConnect: () => void;
  onUnlink: () => void;
}

/**
 * Vinculación por el propio usuario (sin `.env` en el servidor): Client ID
 * suyo (PKCE) y tokens solo en su navegador. Se usa en el panel Música y en
 * Configuración → Música (cuando el servidor no ofrece OAuth, es la única vía).
 */
export const SelfSpotifyLink: React.FC<SelfSpotifyLinkProps> = ({
  linked,
  accountName,
  ownClientId,
  busy = false,
  onSaveClientId,
  onConnect,
  onUnlink,
}) => {
  const [clientIdInput, setClientIdInput] = useState(ownClientId ?? '');

  return (
    <div className="room-settings__box">
      <div className="room-settings__box-head">
        <span className="room-settings__box-title">Tu cuenta de Spotify</span>
      </div>
      {linked ? (
        <>
          <p className="room-settings__box-desc">
            Vinculada{accountName ? ` como ${accountName}` : ''} en este navegador.
          </p>
          <button
            type="button"
            className="leader-exit-modal__cancel-btn"
            disabled={busy}
            onClick={onUnlink}
          >
            Desvincular mi cuenta
          </button>
        </>
      ) : (
        <>
          <p className="room-settings__box-desc">
            Sin depender del servidor: crea tu app en el panel de Spotify, añade esta URI de
            redirección y pega tu Client ID. Tus tokens quedan solo en tu navegador.
          </p>
          <p className="room-settings__box-desc">
            <code>{selfRedirectUri()}</code>
          </p>
          <div className="drawer-chat__input-bar">
            <input
              type="text"
              className="drawer-chat__input"
              placeholder="Tu Client ID de Spotify"
              aria-label="Tu Client ID de Spotify"
              value={clientIdInput}
              onChange={(e) => setClientIdInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="room-settings__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!clientIdInput.trim() || busy}
              onClick={() => {
                onSaveClientId(clientIdInput.trim());
                onConnect();
              }}
            >
              Vincular mi cuenta
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default SelfSpotifyLink;
