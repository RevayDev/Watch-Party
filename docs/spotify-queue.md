# Spotify: cola y búsqueda (fase B)

> Reproducción en el propio dispositivo + búsqueda sin usuario. Sin
> sincronía de audio entre participantes: la sala comparte la misma fuente
> y cada cliente la reproduce (embed o app).

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

1. `GET /api/spotify/auth-url?roomId=` → `{authUrl}` con `state` anti-CSRF
   de un solo uso (`base64url(roomId.nonce)`, expira en 10 min).
2. El usuario autoriza en Spotify → `GET /api/spotify/callback?code=&state=`.
3. El callback valida el `state` (formato, existencia, expiración y sala
   ligada; un solo uso) y canjea el código. `state` inválido/expirado →
   `400 {error:'Sesión de autorización inválida o expirada.'}`.
4. Éxito → `302` a `CLIENT_URL?room=&spotify=connected`. Fallo de Spotify
   → `502 {error}` (sin tokens en la respuesta).
5. `GET /api/spotify/status?roomId=` → `{configured, connected, persistent,
   roomId}`. `POST /api/spotify/disconnect {roomId}` borra memoria Y base.

Scopes mínimos: `user-read-playback-state user-modify-playback-state`
(reproducir en el propio dispositivo). La búsqueda usa client-credentials
sin usuario; el embed no necesita token.

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

- **Premium**: solo cuentas Premium reproducen a disco completo en el
  navegador; el resto oye previews de ~30 s vía embed.
- **Sin sincronía de audio**: no hay reloj compartido de audio; pausas y
  cambios llegan por el sync de la sala como con el video, pero cada
  dispositivo decodifica por su cuenta.
- Los tokens nunca viajan al frontend ni salen en logs (solo booleans).
