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

## 2. Spotify ("Potify") — karaoke con cola sincronizada

> Diseño vigente: la sala comparte cola y selección (metadatos), nunca el
> audio. Detalle técnico en `docs/spotify-queue.md`.

### 2.1 Objetivo

Karaoke en grupo: la cola suena igual para todos en sus propios Spotify, la
selección avanza sincronizada y cada uno canta con su micrófono.

### 2.2 Alcance funcional (fase 1, implementado)

- Icono musical del footer: sin vincular abre el OAuth en pestaña nueva;
  vinculado abre/cierra el panel (toggle) con punto de estado.
- Panel Música: conexión + cuenta, buscador con carátulas, cola con orden y
  votos, canción actual, controles de moderación, desvincular y estado de
  letra informativo (sin proveedor autorizado no hay letra).
- La cola (`music-add/vote/remove/reorder/approve/next/stop`) solo mueve
  metadatos (`musicQueue` + `musicNowPlaying`); jamás toca `room.video`.
- Turno para cantar (`singerName` en ajustes) y aplausos con 👏.

### 2.3 Permisos

- Cola y moderación respetan `musicEnabled`, `musicCanAdd`, `musicQueueMode`,
  `musicCanRemove`, `musicAllowReorder`, `musicRequireApproval` y los roles
  leader/cohost/member (+ `adminToken` del panel).
- El reproductor de películas y su `sync-video` son independientes.

### 2.4 Requisitos técnicos (resumen)

- OAuth con `state` de un solo uso, tokens AES-256-GCM en el servidor, nunca
  en el frontend. Ver variables en `docs/spotify-queue.md` §2.
- Web Playback SDK solo si la app y el uso cumplen las políticas de Spotify;
  hoy no se implementa: cada dispositivo reproduce con su cuenta (Premium
  para disco completo).

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

Puntuación por afinación, efectos de voz, dúos simultáneos, cola votada con
más modos y reproducción sin cuenta de Spotify.

---

## 3. Orden de implementación (estado)

1. Panel Admin con `ADMIN_TOKEN` (listas + cerrar + ajustes + expulsar/rol/mute
   vía eventos socket existentes). ✅
2. Spotify fase B: OAuth con `state` anti-CSRF (10 min) + conexión persistente
   cifrada + búsqueda client-credentials con gates. ✅
3. Integración completa: icono toggle con estados, OAuth en pestaña nueva con
   retorno gestionado, cola solo-metadatos (sin tocar el video), cuenta en
   estado, desvincular, letra informativa. ✅ Detalle en `docs/spotify-queue.md`.

Notas de la implementación:

- La música JAMÁS toca `room.video`: `music-next`/`music-stop` solo mueven
  `musicQueue` + `musicNowPlaying`; `video-url` rechaza enlaces Spotify (400,
  "usa la cola musical"); el player muestra un placeholder amable si una sala
  vieja guardó música como video.
- Cada persona escucha en su propio Spotify (sin retransmisión del anfitrión,
  sin sync de audio, sin letras raspadas).
- Icono Spotify en el footer y en la barra del chat: sin vincular abre el
  OAuth en pestaña nueva (sin perder la sala); vinculado abre/cierra el panel
  (toggle) con punto gris/verde/rojo. Cerrar el panel no desconecta ni vacía.
- Sin `ADMIN_TOKEN`, `/api/admin/*` responde 503 (con token erróneo, 401); sin `SPOTIFY_CLIENT_ID/
  SECRET`, el panel muestra "no configurado".

## 4. Barra inferior por zonas y gusto personal

- Zonas: izquierda (micro/cámara), centro (reacciones, participantes, chat,
  ocultar), derecha (música), final (salir), con etiquetas visibles en PC.
- En PC (≥1024px) la barra se reparte a lo ancho por defecto; en móvil
  sigue la píldora centrada solo-iconos.
- Cada usuario configura su vista en Configuración → "Tu vista de la
  barra": textos sí/no y distribuida/centrada. Es local (`localStorage`,
  `useBarPrefs`), jamás se emite a la sala.
