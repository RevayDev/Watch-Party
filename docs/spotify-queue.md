# Spotify: cola y búsqueda (fase B)

> La sala comparte la cola y la selección (metadatos), nunca el audio. Cada
> persona escucha en su propio Spotify. La cola musical jamás modifica el
> reproductor de películas (`room.video`): `music-next`/`music-stop` solo
> actualizan `musicNowPlaying` + cola.

## 1. Configurar la app en el dashboard (paso a paso)

1. Entra en https://developer.spotify.com/dashboard y crea una app.
2. En **Settings → Redirect URIs** añade la URI EXACTA del backend, una por
   entorno (no se comparten entre dev y prod):
   - dev: `http://localhost:4000/api/spotify/callback`
   - prod: `https://tu-backend/api/spotify/callback`
3. Guarda el **Client ID** y el **Client Secret**.
4. Sin Premium la reproducción en navegador está limitada: el **embed**
   público reproduce hasta ~30 s de preview sin login; la reproducción
   completa en el propio dispositivo (Web Playback) exige **cuenta Premium**
   y el OAuth de la sala.

## 2. Variables de entorno

```bash
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://localhost:4000/api/spotify/callback
# Clave AES-256-GCM (hex 32 bytes). Genera una por entorno con:
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
SPOTIFY_TOKEN_KEY=
SPOTIFY_MARKET=ES
```

- `SPOTIFY_TOKEN_KEY` cifra los tokens en reposo. Sin ella (o inválida) el
  servicio avisa por consola y cae a **memoria efímera** (`persistent: false`
  en `/status`); al reiniciar se pierde la conexión.
- `SPOTIFY_MARKET` es el mercado por defecto de la búsqueda (default `ES`).
- `REDIRECT_URI` debe coincidir con el dashboard; una URI por entorno.

## 3. Flujo OAuth (endurecido)

Hay dos vías complementarias (el footer y el panel usan la que corresponda):

**A. OAuth del servidor** (requiere `.env`): pasos 1-7 de abajo.
**B. Cuenta propia, sin `.env`** (cada usuario vincula la suya): el usuario
crea su app en el dashboard (solo Client ID, sin secreto), registra como
redirect URI el origen del frontend (p. ej. `http://localhost:5173/`) y pega
el Client ID en el panel ("Tu cuenta de Spotify"). Flujo PKCE directo
navegador↔Spotify; los tokens quedan solo en su `localStorage`. La sala sigue
compartiendo solo cola y selección.

1. `GET /api/spotify/auth-url?roomId=` → `{authUrl}` con `state` anti-CSRF
   de un solo uso (`base64url(roomId.nonce)`, expira en 10 min).
2. El frontend abre esa URL en **pestaña nueva** (directo desde el clic, con
   fallback a la misma pestaña si el popup se bloquea). La sala sigue abierta.
3. El usuario autoriza en Spotify → `GET /api/spotify/callback?code=&state=`.
4. El callback valida el `state` (formato, existencia, expiración y sala
   ligada; un solo uso) y canjea el código.
5. Éxito → `302` a `CLIENT_URL?room=&spotify=connected`. Cualquier fallo
   (cancelado, expirado, no configurado, rechazado) → `302` a
   `CLIENT_URL?room=&spotify=error&reason=` (nunca una página JSON sin salida).
6. El frontend lee `spotify=connected|error`, avisa, refresca el estado y
   limpia la URL (conserva `room`).
7. `GET /api/spotify/status?roomId=` → `{configured, connected, persistent,
   roomId, accountName, error}` (`error: 'refresh_failed'` si hay conexión
   guardada pero el token no se pudo renovar). `POST /api/spotify/disconnect
   {roomId}` borra memoria Y base.

Scopes mínimos: `user-read-playback-state user-modify-playback-state`
(reproducir en el propio dispositivo). La búsqueda usa client-credentials
sin usuario.

## 4. Cola y búsqueda

- `GET /api/spotify/search?q=&roomId=&limit=` (limit 1-20, default 10,
  límite 30/min/IP) → `{tracks: [{id, name, artists, albumArt, durationMs,
  uri, openUrl}]}`.
- Gates de sala: `403 {error:'La música está desactivada en esta sala.'}`
  si `settings.musicEnabled !== true`; `403 {error:'La búsqueda está
  desactivada en esta sala.'}` si `settings.musicAllowSearch === false`;
  `404` si la sala no existe; `502` si Spotify falla.
- El token de aplicación se cachea ~55 min en memoria.

## 5. Límites conocidos

- **Premium**: solo cuentas Premium reproducen a disco completo en su
  dispositivo; el resto oye previews de ~30 s en la app de Spotify.
- **Sin sincronía de audio**: no hay reloj compartido ni retransmisión del
  anfitrión a los invitados (técnica y legalmente inviable con contenido
  protegido). `music-next`/`music-stop` y `video-url` con enlaces Spotify
  NO tocan `room.video`: la película nunca se interrumpe por la música.
- **Sin letras de Spotify**: no existe API oficial de letras; el panel muestra
  un estado informativo hasta integrar un proveedor autorizado. No se inventan
  letras ni se raspan.
- **Karaoke**: la arquitectura lo separa (catálogo → cola → reproductor
  autorizado → proveedor de letras). El turno (`singerName`) y la letra
  sincronizada llegarán con proveedor autorizado; hoy solo el estado.
- Los tokens nunca viajan al frontend ni salen en logs (solo booleans).
