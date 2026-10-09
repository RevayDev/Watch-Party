# Watch Party — Guía de aprendizaje del proyecto REAL (2026-10-03)

> Fuente de verdad: código actual en `backend/src/` y `frontend/src/`.
> Esta guía describe **lo que existe hoy**. Si un documento antiguo la
> contradice, manda esta guía.

Última verificación: 2026-10-03 (lectura directa del código).

---

## 1. Qué es realmente este proyecto

Plataforma web para ver un video **sincronizado** en grupo pequeño sin compartir pantalla.
Cada navegador reproduce su propia copia del video (`<video>` + `hls.js`);
el servidor **solo sincroniza posiciones y eventos**, nunca retransmite el video.

Regla de arquitectura (vigente, coincide con el plan):

```text
MongoDB → datos de sala
Express (HTTP) → API + sirve el video (archivo local o redirect/proxy externo)
Socket.IO → tiempo real (sync, chat, presencia, señalización)
WebRTC (P2P directo) → audio/cámaras
React → interfaz
```

Lo que **NO** hay: Tailwind (se usa CSS propio BEM en `index.css`),
Redis/Kafka/microservicios, SFU/MCU, tests, ESLint.

---

## 2. Stack real (verificado en `package.json`)

| Capa | Real |
|---|---|
| Frontend | React 18.3, Vite 6, TypeScript 5.7, `socket.io-client` 4.8, `hls.js` 1.7, `lucide-react` |
| Backend | Node + Express 4.21, `socket.io` 4.8, `mongoose` 8.9, `multer` 1.4, `dotenv`, `cors`, `tsx` (dev) |
| DB | MongoDB **con fallback en memoria** (ver §5) |
| Puertos | Backend `4000` · Frontend `5173` |

---

## 3. Estructura de carpetas REAL (no la del plan)

```text
backend/src/
├── app.ts                    # Express: CORS, /uploads estático, /api/health, /api/proxy, /api/rooms
├── server.ts                 # http.createServer + Socket.IO (cors origin '*', listen 0.0.0.0)
├── config/database.ts        # connectDatabase() con timeout 2s → modo in-memory si falla
├── routes/room.routes.ts     # 7 rutas (ver §6)
├── controllers/room.controller.ts  # create/get/join/delete/uploadVideo/setVideoUrl/streamVideo + probeExternalUrl
├── services/room.service.ts  # Toda la lógica de salas (dual Mongo/memoria + rooms.json)
├── sockets/room.socket.ts    # Todos los eventos socket + resolveRoomTime + barrido de timer 15s
├── models/room.model.ts      # Esquemas Mongoose
├── types/room.types.ts       # IRoom, IParticipant, IJoinRequest, IKickedParticipant, IRoomSettings, IVideoMetadata
└── middleware/
    ├── upload.middleware.ts  # multer diskStorage, 4 GB, filtro video/*
    └── error.middleware.ts   # handler global genérico 500

frontend/src/
├── App.tsx                   # Navegación por estado (home/create/room), ?room=XXX, recentRooms, NotificationProvider
├── main.tsx
├── index.css                 # Sistema de diseño BEM propio (~miles de líneas, responsive + sheets)
├── pages/
│   ├── Home.tsx              # Landing, crear/unirse, recientes, tecnologías, roadmap, donaciones
│   ├── CreateRoom.tsx        # Formulario crear sala
│   └── Room.tsx              # Sala: sockets, WebRTC, chat, sync, aprobación, settings, modales (~1220 líneas)
├── components/
│   ├── VideoPlayer.tsx       # <video>/HLS, sync entrante con compensación, upload, URL externa
│   ├── Chat.tsx / Participants.tsx / Reactions.tsx / CameraGrid.tsx / MediaControls.tsx
│   ├── RoomHeader.tsx        # Botón único "Compartir" (código + link + copiar)
│   ├── RoomSettingsModal.tsx / HostExitModal.tsx / WaitingApproval.tsx / BottomSheet.tsx
├── hooks/
│   ├── useWebRTC.ts          # Malla P2P completa (~620 líneas, ver §8)
│   ├── useSwipeDown.ts       # Cierre de sheets con gesto touch
│   ├── useSheetDrag.ts       # Arrastre Pointer Events con rubber-band
│   └── usePresence.ts
├── services/
│   ├── api.ts                # BACKEND_BASE/VITE_API_URL → /api; create/get/join/uploadVideo(XHR)/setVideoUrl
│   ├── socket.ts             # getSocket(): VITE_SOCKET_URL || VITE_API_URL || http://<hostname>:4000
│   ├── notifications.tsx     # NotificationProvider + notify() + confirmAction()
│   └── recentRooms.ts        # Salas recientes en localStorage
└── types/room.ts             # Espejo de tipos del backend (joinedAt como string, etc.)
```

Carpetas que el plan preveía y **NO existen**: `backend/src/sockets/chat.socket.ts`,
`services/sync.service.ts`, `services/file.service.ts`, `frontend/src/hooks/useSocket.ts`,
`useRoom.ts`. La lógica vive en `room.socket.ts`, `Room.tsx`, `VideoPlayer.tsx`, `useWebRTC.ts`.

---

## 4. REST vs Socket.IO vs WebRTC (cómo decidir)

| Necesidad | Canal | Ejemplo |
|---|---|---|
| Crear / leer / unirse / borrar sala, subir video, fijar URL | **REST** (`fetch`/`XHR`) | `POST /api/rooms`, `POST /:roomId/video` |
| Servir bytes de video local | **HTTP** (`GET …/video/stream` con `Range`, 206, chunks 3 MB; `/uploads` estático) | `<video src>` |
| Servir video externo con CORS/HLS/Drive | **HTTP proxy** `GET /api/proxy?url=` (reescribe `.m3u8` y `URI=`) | HLS remoto |
| Play/pause/seek, chat, reacciones, presencia, moderación, roles, aprobación | **Socket.IO** | `sync-video`, `send-message`, `approve-join`… |
| Señalización para llamadas | **Socket.IO** (solo oferta/respuesta/ICE + `peer-media-state`) | `webrtc-offer/answer/ice-candidate` |
| Audio/video de cámaras y micrófonos | **WebRTC P2P directo** (nunca por Socket.IO) | `useWebRTC.ts`, `RTCPeerConnection` + `RTCDataChannel('media-state')` |

---

## 5. Persistencia: MongoDB + fallback en memoria (importante)

`config/database.ts`: `mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 })`.
Si falla → `isMongoConnected = false` y **todo sigue funcionando** con
`Map<string, IRoom>` en `room.service.ts` + persistencia en disco
`backend/data/rooms.json` (escritura diferida 300 ms, carga al arrancar).

Consecuencias para aprender/depurar:

- Hay **dos ramas** en casi cada método de `RoomService` (Mongo vs memoria). Es la
  principal fuente de duplicación del backend.
- `rooms.json` sobrevive a reinicios solo en modo memoria. En modo Mongo manda Atlas/local.
- `MONGODB_URI` por defecto: `mongodb://127.0.0.1:27017/watch_party`.

---

## 6. API REST real (base: `http(s)://<backend>/api`)

| Método y ruta | Body / campo | Respuesta clave | Código |
|---|---|---|---|
| `GET /api/health` | — | `{ status:'ok', service:'watch-party-backend', timestamp }` | `app.ts:77` |
| `GET /api/proxy?url=` | query `url` http(s) | video/segmento o `.m3u8` reescrito; JSON error si el origen devuelve HTML | `app.ts:211` |
| `POST /api/rooms` | `{ hostName, isTemporary=true }` | `{ roomId (6 chars), hostName, hostSecret, status, isTemporary, createdAt }` | `room.controller.ts:119` |
| `GET /api/rooms/:roomId` | — | `{ roomId, hostName, status, isTemporary, settings, video\|null, participants, createdAt }` | `:145` |
| `POST /api/rooms/:roomId/join` | `{ userName }` | Normal: `{ roomId, hostName, status, participants }`. **Con `requireApproval` y no-host: `{ …, participants, pendingApproval:true }` SIN añadir al participante** | `:174` |
| `DELETE /api/rooms/:roomId` | — | `{ message, roomId }` (borra archivo si temporal o forzado) | `:336` |
| `POST /api/rooms/:roomId/video` | `multipart single('video')`, límite **4 GB**, filtro `video/*` | `{ message, video, status:'active' }` | `:230` + `upload.middleware.ts` |
| `POST /api/rooms/:roomId/video-url` | `{ url, title? }` (convierte Drive `/file/d/ID` → `drive.usercontent…confirm=t`, detecta `.m3u8`, hace `probeExternalUrl` con `Range: bytes=0-2047`) | `{ message, video: { sourceType:'hls'|'url', mimeType, directUrl }, status }` | `:272` |
| `GET /api/rooms/:roomId/video/stream` | header `Range` opcional | `206` con `Content-Range`, chunks ~3 MB; si `sourceType url/hls` → `302 redirect` a `directUrl`; `404` si no hay video/archivo | `:359` |

Notas: `roomId` de 6 caracteres (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, `crypto.randomBytes`),
`hostSecret` de 32 hex (se genera y devuelve al crear, pero **no se exige después**).
`DELETE` con `forceDeleteVideo=true` interno siempre
borra el archivo; el barrido por timer llama con `false` (respeta no-temporales).

---

## 7. Eventos Socket.IO reales

Servidor: `backend/src/sockets/room.socket.ts`. Cliente emite desde `Room.tsx`,
`VideoPlayer.tsx` (vía `onSyncAction`), `useWebRTC.ts`, `Participants.tsx`.

### 7.1 Cliente → servidor

| Evento | Payload | Efecto |
|---|---|---|
| `join-room` | `{ roomId, userName, isHost?, userId? }` | Ban-check → si `requireApproval` y no-host y no-miembro: guarda `pending`, `addJoinRequest`, emite `join-pending` + `join-requests-updated`. Si no: `socket.join`, `joinRoom()`, emite `user-joined` (salvo rejoin mismo socket) + `room-state` con `peers`, `mediaStates`, `playback` |
| `leave-room` | `{ roomId, userName, userId? }` | `socket.leave`, si era `pending` cancela solicitud; si no `removeParticipantAndTransferHost` → `host-changed` + `user-left` |
| `close-room` | `{ roomId }` | `room-closed` a todos, `socketsLeave`, limpia `roomPlayback`/`roomPositions`, `deleteRoom(id, true)` |
| `sync-video` | `{ roomId, action:'play'|'pause'|'seek', currentTime }` | Guarda snapshot `{ currentTime, isPlaying: action==='play', updatedAt }`, reemite a la sala con `{ action, currentTime, sentAt: Date.now(), senderSocketId }` |
| `playback-heartbeat` | `{ roomId, currentTime, isPlaying }` | Guarda reporte por socket (TTL 12 s). Ignorado si el socket es `pending` o de otra sala |
| `video-changed` | `{ roomId, video: IVideoMetadata }` | Resetea playback a 0/pausado, reemite `video-changed` |
| `upload-progress` | `{ roomId, progress:number\|null, fileName? }` | Reemite a los demás |
| `send-message` | `{ roomId, text, userName }` | Reemite `chat-message { id, user, text, timestamp:'HH:MM' }` a toda la sala |
| `send-reaction` | `{ roomId, emoji, userName }` | Reemite `reaction { id, emoji, user, xOffset: ±20 }` |
| `webrtc-offer` | `{ targetSocketId, offer, callerName, callerIsHost }` | Reenvía con `senderSocketId` |
| `webrtc-answer` | `{ targetSocketId, answer }` | Reenvía con `senderSocketId` |
| `webrtc-ice-candidate` | `{ targetSocketId, candidate }` | Reenvía con `senderSocketId` |
| `peer-media-state` | `{ roomId, userName?, isCameraOn, isMicOn }` | Guarda por socketId **y** por nombre minúsculas, reemite `{ socketId, userName, isCameraOn, isMicOn }` |
| `moderate-mute-user` / `moderate-disable-camera` | `{ roomId, targetSocketId?, targetUserName }` | Reemite `force-mute-user` / `force-disable-camera` |
| `moderate-mute-all` / `moderate-disable-all-cameras` | `{ roomId }` | Reemite `force-mute-all` / `force-disable-all-cameras` |
| `kick-user` | `{ roomId, targetUserName, targetUserId?, kickedBy, ban=false }` | `kickParticipant` → emite `user-kicked { targetUserName, targetUserId, kickedBy, banned, participants, kickedUsers }` |
| `unban-user` | `{ roomId, targetUserName?, targetUserId? }` | Emite `kicked-users-updated` |
| `approve-join` | `{ roomId, userId?, name? }` | `approveJoinRequest` → `join-requests-updated` + `join-approved` al socket del solicitante (buscado en `activeUsers`) + `user-joined` a la sala |
| `reject-join` | `{ roomId, userId?, name?, ban?, requestedBy? }` | `rejectJoinRequest` → `join-rejected { reason:'banned'|'rejected' }` al solicitante + `join-requests-updated` (+ `kicked-users-updated` si ban) |
| `set-role` | `{ roomId, targetUserName, role:'cohost'|'member' }` | Emite `participant-role-updated` |
| `rename-participant` | `{ roomId, oldName, newName, targetUserId? }` | Actualiza `activeUsers` y `activeMediaStates`, emite `participant-renamed` |
| `update-room-settings` | `{ roomId, settings }` | **Solo host** (`activeUsers` check). Normaliza `timerEndsAt` a ISO o `null`. Emite `room-settings-updated` |

### 7.2 Servidor → cliente

`room-state`, `user-joined`, `user-left`, `host-changed`, `room-closed` (`{ message, reason?:'timer' }`),
`room-settings-updated`, `join-pending`, `join-approved`, `join-rejected`, `join-requests-updated`,
`kicked-users-updated`, `user-kicked`, `participant-role-updated`, `participant-renamed`,
`sync-video`, `chat-message`, `reaction`, `video-changed`, `upload-progress`,
`webrtc-offer`, `webrtc-answer`, `webrtc-ice-candidate`, `peer-media-state`,
`force-mute-user`, `force-disable-camera`, `force-mute-all`, `force-disable-all-cameras`.

---

## 8. Flujos trazados (código real)

### 8.1 Crear sala

```text
CreateRoom/Home → ApiService.createRoom(hostName, isTemporary)
 → POST /api/rooms → RoomService.createRoom: roomId 6 chars + hostSecret,
   participants=[{ name, isHost:true, role:'host' }], settings por defecto
 → App guarda watchparty_host_session + recentRooms, navega a ?room=XXX
 → Room.tsx: GET /api/rooms/:id (verifica) + socket join-room { isHost:true }
 → servidor: room-state { isHost:true, settings, video:null, playback:null }
```

### 8.2 Unirse (sin aprobación)

```text
Home (código) → ApiService.joinRoom → POST /:roomId/join { userName }
 → RoomService.joinRoom (identidad: userId si existe, si no nombre; no duplica)
 → Room.tsx socket join-room → socket.join(roomId) → user-joined a los demás
 → room-state al que entra (con peers WebRTC + playback de consenso si hay)
```

### 8.3 Unirse con aprobación (`settings.requireApproval=true`)

```text
REST join → { pendingApproval:true } (NO añade a participants)   [room.controller.ts:202]
 → Room.tsx muestra WaitingApproval
 → socket join-room → activeUsers pending + addJoinRequest + join-pending (al que espera)
   + join-requests-updated (al host)
 → host/cohost: approve-join { userId|name } → approveJoinRequest mueve a participants
   → join-approved (solo al socket del solicitante: re-ejecuta join-room y recibe room-state)
   → user-joined (a la sala, incluido el aprobador)
 → reject-join → join-rejected { reason } + join-requests-updated (+ kicked-users si ban)
 → disconnect/leave-room de un pending cancela su solicitud (no toca participants)
```

### 8.4 Sync de reproducción con `resolveRoomTime`

Estado en servidor (`room.socket.ts`):

- `roomPlayback: Map<roomId, { currentTime, isPlaying, updatedAt }>` — último `sync-video`.
- `roomPositions: Map<roomId, Map<socketId, { currentTime, isPlaying, updatedAt }>>` —
  heartbeats de `Room.tsx:950` cada pocos segundos (TTL 12 s, tolerancia de clúster 3 s).

Al entrar (`join-room`, líneas 240–273):

1. `resolveRoomTime(roomId, participants)`: agrupa reportes frescos en ventanas de 3 s,
   toma la **mediana del clúster mayoritario**; si no hay mayoría (todos dispersos),
   gana el **miembro más antiguo** (`joinedAt`, `seniorityOf`); `isPlaying` por mayoría.
2. Si no hay consenso pero hay snapshot: compensa `elapsed = (now - updatedAt)/1000`
   y suma si estaba en `play`.
3. Se envía en `room-state.playback { currentTime, isPlaying }`; `Room.tsx:340` lo
   convierte en `remoteAction { action: play|seek, sentAt: now }`.

En vivo (`sync-video` + `VideoPlayer.tsx:213`):

- Emisor: `onSyncAction(action, currentTime)` → `socket.emit('sync-video', …)` (`Room.tsx:843`).
- Receptor: `handleSyncVideo` → `setRemoteAction` → `VideoPlayer` aplica:
  `target = currentTime + (action==='play' ? (now - sentAt)/1000 : 0)`;
  si `|local - target| > 0.5 s` o es `seek`, salta; luego `play()`/`pause()`.
  Flag `isApplyingRemote` (300 ms) evita re-emitir el eco.
- `video-changed` resetea a 0/pausado; `Room.tsx` limpia `remoteAction`.

### 8.5 Video: subida vs enlace vs HLS/Drive

- **Archivo**: `VideoPlayer` → `ApiService.uploadVideo` (XHR con `%`) → `POST …/video`
  (multer `video`, 4 GB) → `updateRoomVideo({ sourceType:'file' })` + `status:'active'`
  → el que sube emite `video-changed` por socket → los demás reciben `video-changed`
  y resuelven `src = /api/rooms/:id/video/stream` (206) o `/uploads/…`.
- **Enlace**: `POST …/video-url { url, title? }` → normaliza Drive, `probeExternalUrl`
  (`Range: bytes=0-2047`, detecta HTML/cuota/401/404/5xx) → guarda
  `{ sourceType:'url'|'hls', directUrl }`. `streamVideo` hace `redirect` al `directUrl`.
- **HLS/externo con CORS**: el frontend pide vía `/api/proxy?url=`; el backend reescribe
  el `.m3u8` (segmentos y `URI="…"`) a URLs absolutas del proxy y mantiene `206`.
  HTML en vez de video (aviso de Drive, login, cuota) → `502` con mensaje en español.

### 8.6 Voz/cámara (WebRTC real, no solo plan)

`useWebRTC.ts`: malla P2P total. El recién llegado (`room-state.peers`) envía oferta a
cada peer existente; los existentes preparan `RTCPeerConnection` al ver `user-joined`.
STUN: 5× Google + Twilio (sin TURN). `getUserMedia` solo al activar mic/cámara
(`enableMedia`), renegociación con `replaceTrack`, `RTCDataChannel('media-state')`
para estado instantáneo + `peer-media-state` por Socket.IO como respaldo.
`CameraGrid.tsx` + `MediaControls.tsx` consumen `remotePeers`/`peerMediaStates`.
Moderación del host: `force-mute-*` / `force-disable-camera*`.

---

## 9. Variables de entorno, puertos y proxy (verificado)

| Variable | Dónde | Valor / defecto | Notas |
|---|---|---|---|
| `PORT` | `backend/.env.example`, `server.ts:10` | `4000` | Se escucha en `0.0.0.0` (LAN). Plataformas externas lo inyectan |
| `MONGODB_URI` | `backend/.env.example`, `server.ts:11` | `mongodb://127.0.0.1:27017/watch_party` | Sin Mongo → modo memoria + `data/rooms.json` |
| `CLIENT_URL` | `backend/.env.example` | `http://localhost:5173` | **No se usa en el código** (Socket.IO usa `cors: origin '*'`). Solo documental/deploy |
| `VITE_API_URL` | `frontend/.env.example`, `api.ts:5`, `socket.ts:8` | `http://localhost:4000` (vacío = mismo origen `/api`) | REST: `${VITE_API_URL}/api`; Socket: `VITE_SOCKET_URL \|\| VITE_API_URL \|\| http://<hostname>:4000` |
| `VITE_SOCKET_URL` | solo `socket.ts:8` | (no está en `.env.example`) | Permite separar REST y WS si se quiere |
| `VITE_PATREON_URL` / `VITE_PAYPAL_URL` | `frontend/.env.example`, `Home.tsx` | vacías = tarjeta "Próximamente" | Solo donaciones |
| `MAX_UPLOAD_MB` | propuesta en pendientes | **no existe**; límite fijo 4 GB en `upload.middleware.ts:53` | Ver plan de refactor |

Vite (`vite.config.ts`): `host:true`, puerto `5173`, proxy `/api` y `/uploads` → `http://localhost:4000`.
En producción (dominios distintos) el frontend usa `VITE_API_URL` absoluto y el proxy
de `app.ts` genera URLs absolutas (`req.protocol://req.get('host')`) para HLS.

---

## 10. Ruta de aprendizaje adaptada al stack REAL

Orden sugerido (cada paso con archivo y qué romper/probar):

1. **HTTP + Express** — `backend/src/app.ts`, `server.ts`. Levanta `npm --prefix backend run dev`,
   abre `GET /api/health`. Rompe: cambia el puerto, quita `trust proxy`.
2. **REST de salas** — `room.routes.ts` → `room.controller.ts` → `room.service.ts`.
   Prueba con curl/Postman `POST /api/rooms`, `GET /:id`, `POST /:id/join`, `DELETE /:id`.
3. **Mongoose + fallback** — `models/room.model.ts`, `types/room.types.ts`, `config/database.ts`.
   Apaga Mongo y observa `data/rooms.json`. Pregunta clave: ¿por qué dos ramas?
4. **Upload + streaming** — `upload.middleware.ts` (4 GB, `video/*`), `streamVideo` (206, 3 MB).
   Sube un mp4, pide con `Range: bytes=0-` y mira `Content-Range`.
5. **Video por URL/HLS/Drive + proxy** — `setVideoUrl`, `probeExternalUrl`, `app.ts proxyFetch`.
   Pega un `.m3u8` y traza cómo se reescribe a `/api/proxy?url=`.
6. **Socket.IO base** — `room.socket.ts` (`join-room`, `room-state`, `user-joined/left`,
   `disconnect` + transferencia de host). Abre dos navegadores en `?room=XXX`.
7. **Sync con `resolveRoomTime`** — `roomPlayback` vs `roomPositions`, heartbeats,
   `VideoPlayer.tsx:213` (umbral 0.5 s, `sentAt`, `isApplyingRemote`). Prueba: entra un
   tercero con el video en tiempos distintos y observa a quién sigue.
8. **Aprobación/moderación/roles** — `joinRequests`, `kickedUsers`, `approve/reject-join`,
   `kick-user`/`unban-user`, `set-role`, `rename-participant`, `update-room-settings` + timer.
9. **WebRTC** — `useWebRTC.ts` (oferta/respuesta/ICE, STUN, DataChannel, renegociación).
   Activa mic/cámara en 2 peers en LAN (no solo localhost) y mira los logs `[WebRTC]`.
10. **Frontend estado** — `App.tsx` (vistas sin router), `Room.tsx` (orquesta todo),
    `api.ts`/`socket.ts`/`notifications.tsx`/`recentRooms.ts`, CSS BEM.
11. **Temporizador y limpieza** — `settings.timerEndsAt`, barrido 15 s (`room-closed reason:timer`),
    `deleteRoom` (temporal vs persistente), `removeOldVideoFile`.

Preguntas que deberías poder responder (criterio de éxito):
¿por qué el video no va por Socket.IO? ¿qué pasa si Mongo está caído? ¿cómo sabe un
recién llegado a qué segundo saltar? ¿qué hace el proxy con un `.m3u8`? ¿cómo se
transfiere el host? ¿qué diferencia `kick` de `ban`? ¿por qué el socket necesita
`userId` además de `userName`?

---

## 11. Archivos críticos vs ignorables (para no perderse)

**Críticos (leer primero):**
`backend/src/sockets/room.socket.ts`, `backend/src/services/room.service.ts`,
`backend/src/controllers/room.controller.ts`, `backend/src/app.ts`,
`frontend/src/pages/Room.tsx`, `frontend/src/components/VideoPlayer.tsx`,
`frontend/src/hooks/useWebRTC.ts`, `frontend/src/services/api.ts`,
`frontend/src/services/socket.ts`, tipos `room.types.ts` / `room.ts`.

**Importantes (segundo):** `room.routes.ts`, `room.model.ts`, `upload.middleware.ts`,
`App.tsx`, `Participants.tsx`, `Chat.tsx`, `RoomSettingsModal.tsx`, `WaitingApproval.tsx`,
`vite.config.ts`, `.env.example` (ambos).

**Ignorables al empezar:** `frontend/src/Example.png`, `dist/`, `node_modules/`,
`*.tsbuildinfo`, `backend/uploads/*`, `backend/data/rooms.json` (generado),
`public/`, `vercel.json`, detalles CSS de `index.css` (volver cuando toque responsive).

---

## 12. En migración (arquitectura OBJETIVO — NO existe aún)

> Otros subagentes están refactorizando en paralelo. **Nada de esto debe leerse como hecho.**

- **Frontend por features**: `features/rooms|video|chat|participants|media|…`
  (cada una con `components/hooks/services/types`), más `shared/` y `app/`.
  Hoy todo está plano en `components/pages/hooks/services`.
- **Backend hexagonal**: `domain/` (entidades y puertos) + `application/` (casos de uso)
  + `infrastructure/` (Express, Mongoose, multer, Socket.IO, memoria) + `interfaces/`.
  Hoy `controller → service → model` con lógica mezclada y ramas Mongo/memoria duplicadas.
- Esta guía describe el código **actual**; cuando la migración aterrice, esta sección
  se sustituirá por la nueva topología verificada.

---

## 13. Notas históricas (2026-10-03, revisado 2026-10-09)

> Los planes originales describían Tailwind, pocos endpoints y WebRTC como
> fase futura; el código real usa CSS propio BEM, 7+ rutas, 30+ eventos
> socket y WebRTC P2P implementado. Esos documentos se eliminaron en la
> limpieza de `docs/` (2026-10-09): solo quedan esta guía + `architecture/`.

---

## 14. Cómo usar esta guía con otros agentes

- Si vas a refactorizar: lee primero §7–§8 (payloads exactos) y no cambies nombres de
  eventos sin actualizar `Room.tsx` + `useWebRTC.ts` + esta guía.
- Si vas a mover a `features/` o hexagonal: mantén §12 como objetivo y esta guía como
  foto del origen; no mezcles ambas topologías en un mismo documento.
