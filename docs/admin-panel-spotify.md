# Panel Admin y Spotify — Especificación funcional

> Estado: **implementado** (fases 1, 2 y Spotify fase 1). El antiguo panel
> admin (`/api/admin/metrics`) se eliminó; el panel actual vive en
> `/api/admin/*` con `ADMIN_TOKEN` (ver `backend/.env.example`) y la vista
> `?admin` del frontend. Detalles de endpoints en `/api/docs` (OpenAPI).

---

## 1. Panel Admin — gestión de salas y usuarios

### 1.1 Objetivo

Dar a un administrador una vista única para **ver, moderar y cerrar salas** y
**gestionar usuarios** (conectados, expulsados, baneados), sin entrar a cada
sala como participante.

### 1.2 Acceso

- Ruta reservada (p. ej. `?admin=` o `/admin`), separada del Home y de la sala.
- Autenticación con el `ADMIN_TOKEN` del servidor (cabecera o secreto por
  query, nunca en el código del frontend). Sin token válido no se muestra nada.
- Solo lectura por defecto; las acciones destructivas (cerrar sala, banear)
  piden confirmación como ya hacen los modales de salida.

### 1.3 Módulo de salas

| Función | Qué hace | Base existente que reutiliza |
|---|---|---|
| Listar salas activas | Tabla con código, nombre, nº de participantes, modo (temporal/permanente), estado y tiempo restante del timer | `GET /api/rooms/:roomId`, mapa de usuarios activos del servidor |
| Ver detalle | Participantes con rol (leader/cohost/member), video actual, ajustes | `room-state`, `settings-policy.ts` |
| Cambiar ajustes | Nombre, descripción, aprobación manual, timer, `hostOnlySync`, flags de perf/reacciones | `PATCH /api/rooms/:roomId/settings`, `update-room-settings` |
| Cerrar sala | Expulsa a todos y elimina la sala | `DELETE /api/rooms/:roomId`, `room-closed` |
| Ver solicitudes | Cola de `join-requests` en salas con aprobación manual | `join-requests-updated`, `join-approved` / `join-rejected` |

### 1.4 Módulo de usuarios

| Función | Qué hace | Base existente que reutiliza |
|---|---|---|
| Ver conectados | Quién está en cada sala (nombre, rol, mic/cámara) | `activeUsers`, `activeMediaStates` (`socket-state.ts`) |
| Expulsar | Saca a un usuario de la sala (puede volver) | `kick-user` (`moderation.handler.ts`) |
| Banear / desbanear | Bloquea la entrada a la sala | Listas de expulsados/baneados, `unban-user` |
| Cambiar rol | Pasar a co-anfitrión o devolver a miembro | `set-role` (`coleader` \| `member`) |
| Traspasar liderazgo | Cambiar el líder de una sala | `transfer-leader` |
| Renombrar | Corregir el nombre visible de un participante | `rename-participant` |
| Silenciar | Mic o cámara de uno o de todos | `moderate-mute-user`, `moderate-disable-camera`, `moderate-mute-all`, `moderate-disable-all-cameras` |

### 1.5 Reglas que se heredan

- **Anti-suplantación**: el servidor ignora el `userName` del cliente y usa el
  nombre registrado (`memberNameOf`) — el panel también.
- **Anti-spam**: mismos rate-limits por socket que chat/reacciones.
- **Permisos**: con `hostOnlySync` en `true`, solo leader/cohost controlan la
  reproducción; el admin no salta esa regla, la gestiona.
- **Efímero**: como el resto del sistema, no hay base de usuarios persistente;
  el panel muestra el estado vivo, no un histórico (ver `dataSaver`,
  `isTemporary`).

### 1.6 Fuera de alcance (fase 1)

Histórico/baneos permanentes entre reinicios, estadísticas de uso, gestión del
`ADMIN_TOKEN` desde la UI y moderación de contenido de video.

---

## 2. Spotify ("Potify") — música sincronizada en la sala

### 2.1 Objetivo

Poder poner **música de Spotify como fuente de la sala**, igual que hoy se pone
un archivo o un enlace de video: todos escuchan lo mismo al mismo tiempo y el
anfitrión (o quien tenga el control) la pausa, reanuda y cambia.

### 2.2 Alcance funcional (fase 1)

- En el selector de fuente ("Cambiar") aparece la pestaña **Spotify** junto a
  Subir y Enlace.
- Pegar un **enlace de canción/playlist de Spotify** lo carga como fuente de
  la sala (`sourceType: 'spotify'`,Reuse del modelo `IVideoMetadata`).
- La reproducción usa el **mismo sync** que el video: `sync-video`
  (play/pause/seek), `playback-heartbeat` y consenso para recién llegados.
- La cinemática del combo, las reacciones y el ducking por mic funcionan igual
  (el player no distingue la fuente).
- Sin enlace válido se muestra el mismo estado de error del player actual.

### 2.3 Permisos

- Añadir/cambiar música respeta `hostOnlySync`: con sync solo-anfitrión, solo
  leader/cohost la controlan (mismo aviso de "Reproducción bloqueada").
- Con `reactionsEnabled`/`visualEffects` en `false`, la música sigue pero sin
  overlays.

### 2.4 Requisitos técnicos previos (no funcionales, resumen)

- Las URLs externas ya pasan por el **proxy CORS del backend**
  (`proxy.routes.ts` / `proxy.service.ts`): Spotify lo reutiliza.
- La Web Playback API exige **OAuth con cuenta Premium** para reproducir en el
  navegador: la fase 1 necesita el flujo de login de Spotify y guardar el
  token del lado del servidor (nunca en el frontend).
- Sin token válido, la pestaña Spotify muestra "Conectar con Spotify" en vez
  del campo de enlace.

### 2.5 Fuera de alcance (fase 1)

Cola de canciones votada, letras sincronizadas, modo DJ por turnos y
reproducción sin cuenta de Spotify.

---

## 3. Orden de implementación sugerido

1. Panel Admin solo-lectura (salas + usuarios) con `ADMIN_TOKEN`. ✅
   (`GET /api/admin/rooms`, `GET /api/admin/rooms/:roomId`, `RoomService.listRooms()`)
2. Acciones de sala (ajustes, cerrar) y de usuario (expulsar, rol, mute). ✅
   (`PATCH/DELETE /api/admin/rooms/:roomId…`, `POST …/kick|unban|role|transfer-leader|rename|mute`;
   emiten los mismos eventos socket que la moderación en sala)
3. Spotify fase 1 (enlace + sync + OAuth básico). ✅ → endurecido en fase B:
   OAuth con `state` anti-CSRF de un solo uso (10 min) + conexión persistente
   cifrada (`persistent` en `/status`; ver `docs/spotify-queue.md`) + búsqueda
   `GET /api/spotify/search` (client-credentials, gates `musicEnabled` /
   `musicAllowSearch`).
   (`sourceType: 'spotify'` con embed, `GET /api/spotify/resolve|status|auth-url|callback|search`,
   `POST …/disconnect`; sin pestaña en "Cambiar": el acceso es el icono Spotify
   del footer y de la barra del chat)

Notas de la implementación:

- El transporte fino (play/pausa/seek remoto sobre el embed) y el ducking
  por mic no aplican al iframe de Spotify sin SDK Premium: la sala comparte
  la misma fuente (`video-changed`) y cada embed la reproduce. Cola votada,
  letras y modo DJ siguen fuera de alcance.
- Sin `ADMIN_TOKEN` en el servidor, `/api/admin/*` responde 503; sin
  `SPOTIFY_CLIENT_ID/SECRET`, la pestaña muestra "no configurado".
- Icono Spotify en el footer de la sala y en la barra del chat
  (`SpotifyListenButton`, junto a Salir y junto a Enviar): música ambiente
  mientras entra la gente + vincular cuenta estilo Instagram (pantalla oficial
  de Autorizar de Spotify vía OAuth). Sin cuenta vinculada redirige a
  vincularla (`window.open(authUrl, '_self')`, el callback vuelve a `?room=`);
  vinculada + anfitrión + nada sonando pone el ambiente en toda la sala
  (`video-changed`, playlist `DEFAULT_AMBIENT_SPOTIFY_URL`); sonando Spotify
  abre lo que suena en pestaña nueva; miembro sin nada sonando lo abre en su
  propio Spotify. Sin OAuth en el servidor el ambiente igual funciona (embed
  público). El modal "Cambiar" vuelve a 2 pestañas (Subir/Enlace).

## 4. Barra inferior por zonas y gusto personal

- Zonas: izquierda (micro/cámara), centro (reacciones, participantes, chat,
  ocultar), derecha (música), final (salir), con etiquetas visibles en PC.
- En PC (≥1024px) la barra se reparte a lo ancho por defecto; en móvil
  sigue la píldora centrada solo-iconos.
- Cada usuario configura su vista en Configuración → "Tu vista de la
  barra": textos sí/no y distribuida/centrada. Es local (`localStorage`,
  `useBarPrefs`), jamás se emite a la sala.
