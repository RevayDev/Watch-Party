# SOCKET_EVENTS — contrato real verificado

Emisor → Receptor. Fuentes: `backend/src/sockets/handlers/*.ts`,
`room.socket.ts`, `socket-auth.ts`; frontend `useRoomSocket.ts`,
`useWebRTC.ts`, `Room.tsx`, `RoomDrawer.tsx` (grep de `socket.on/emit`).

Auth común privilegiada: payload puede traer `hostSecret?`, `requesterUserId?`,
`requesterName?` → `resolveSocketClaim` (cae a `activeUsers` por `socket.id`) →
`requireHost` (solo host) / `requireModerator` (host o cohost). Denegación =
`action-denied { event, message }` solo al emisor. `roomId` siempre se normaliza
(`toUpperCase().trim()`).

## 1. Cliente → Servidor (25 + disconnect)

| # | Evento | Emite (FE) | Valida (BE) | Auth | Emite a cambio (BE) |
|---|---|---|---|---|---|
| 1 | `join-room { roomId, userName, isHost?, userId? }` | `useRoomSocket.emitJoin` (+reintento en `connect`; re-emit tras `join-approved`) | payload objeto; `roomId && userName`; **máx 15 intentos/min por socket** (anti-flood); ban (`findBannedEntry`); colisión (`isNameTaken`); approval gate | ❌ acepta flag `isHost` del cliente en `isActuallyHost` | `join-rejected{banned,name-taken}` al emisor · `join-pending` + `join-requests-updated` a sala (si approval) · `user-joined` a otros (`socket.to`) · `room-state` al emisor |
| 2 | `close-room { roomId + auth }` | `useRoomSocket.handleDeleteRoomForAll` | `roomId` | ✅ `requireHost`, si no `action-denied` | `room-closed{message}` a sala + `socketsLeave` + borra playback/positions + `deleteRoom(force=true)` |
| 3 | `leave-room { roomId, userName, userId? }` | `handleLeaveOnlyMe`, `handleCancelWaiting` | `roomId`; cancela gracia pendiente | ❌ | pendientes: `join-requests-updated` · resto: `removeParticipantAndTransferHost` → `host-changed` (si aplica) a sala + `user-left` a otros |
| 4 | `approve-join { roomId, userId?, name? + auth }` | `RoomDrawer` (Solicitudes) | `roomId && (userId\|\|name)` | ✅ `requireModerator` | `join-requests-updated` a sala + `join-approved{roomId}` al socket del solicitante + `user-joined` a sala |
| 5 | `reject-join { roomId, userId?, name?, ban?, requestedBy? + auth }` | `RoomDrawer` | idem | ✅ `requireModerator` | `join-rejected{rejected,banned}` al solicitante (+borra su `activeUsers`) + `join-requests-updated` (+`kicked-users-updated` si `ban`) |
| 6 | `sync-video { roomId, action:play\|pause\|seek, currentTime + auth* }` | `handleSyncAction` (VideoPlayer; pre-chequeo local + toast si locked) | `roomId`; sala existe; miembro (no pending) | ⚙️ `hostOnlySync` apagado → cualquiera sincroniza; encendido → solo host/cohost (`requireModerator`), si no `action-denied` | snapshot vía `SyncPlaybackUseCase` + `sync-video{action,currentTime,sentAt,senderSocketId}` a otros (`socket.to`) |
| 7 | `playback-heartbeat { roomId, currentTime, isPlaying }` | `Room.tsx → onPlaybackHeartbeat` (VideoPlayer cada ~5 s) | `isFinite && >=0`; solo miembros (`isMember`) | ❌ (identidad = `activeUsers`) | sin emisión; alimenta `roomPositions` (consenso) |
| 8 | `video-changed { roomId, video }` | `handleUploadVideo`, `handleSetVideoUrl` (tras REST ok) | `roomId` (ni siquiera `video.originalName` se valida: `console.log` lo asume) | ❌ **cualquier miembro cambia el video**; resetea snapshot a 0/pausa | `video-changed{video}` a **toda** la sala (`io.to`, incluye emisor) |
| 9 | `upload-progress { roomId, progress\|null, fileName? }` | `handleUploadVideo` (0, N, null) | `roomId` | ❌ | reenvío a otros (`socket.to`) |
| 10 | `send-message { roomId, text }` | `handleSendMessage` | `roomId && text.trim()`; rate 8/10 s | ✅ **solo miembros** (ni pendientes ni externos); `user` = nombre del servidor (el `userName` del cliente se ignora: anti-suplantación) | `chat-message{id,user,text,timestamp}` a toda la sala |
| 11 | `send-reaction { roomId, emoji }` | `handleReaction` | `roomId && emoji`; rate 20/10 s | ✅ **solo miembros**; `user` = nombre del servidor | `reaction{id,emoji,user,xOffset}` a toda la sala |
| 11b | `typing { roomId }` | `emitTyping` (throttle 1/2 s en FE) | `roomId`; rate 10/10 s | ✅ **solo miembros**; `user` = nombre del servidor | `typing{user,timestamp}` a toda la sala |
| 12 | `moderate-mute-user { roomId, targetSocketId?, targetUserName + auth }` | `RoomDrawer` | `roomId` | ✅ `requireModerator` | `force-mute-user{targetSocketId,targetUserName}` a sala |
| 13 | `moderate-disable-camera { … }` | `RoomDrawer` | `roomId` | ✅ `requireModerator` | `force-disable-camera{…}` a sala |
| 14 | `moderate-mute-all { roomId + auth }` | `RoomDrawer` | `roomId` | ✅ `requireModerator` | `force-mute-all` (sin payload) a sala |
| 15 | `moderate-disable-all-cameras { roomId + auth }` | `RoomDrawer` | `roomId` | ✅ `requireModerator` | `force-disable-all-cameras` a sala |
| 16 | `kick-user { roomId, targetUserName, targetUserId?, kickedBy, ban? + auth }` | `RoomDrawer` | `roomId && targetUserName` | ✅ `requireModerator` | `KickUserUseCase` + `user-kicked{targetUserName,targetUserId,kickedBy,banned,participants,kickedUsers}` a sala (el expulsado se auto-expulsa en FE) |
| 17 | `unban-user { roomId, targetUserName?, targetUserId? + auth }` | `RoomDrawer` | `roomId && (nombre\|\|id)` | ✅ `requireModerator` | `kicked-users-updated{kickedUsers}` a sala |
| 18 | `set-role { roomId, targetUserName, role:cohost\|member + auth }` | `RoomDrawer` (botón solo visible al host) | `roomId && targetUserName` | ✅ `requireHost` estricto (cohost → `action-denied`) | `participant-role-updated{targetUserName,role,participants}` a sala |
| 18b | `transfer-host { roomId, targetUserName?, targetUserId? + auth }` | `RoomDrawer` ("Pasar sala", solo host, con confirm) | objetivo existe y no es host | ✅ `requireHost` estricto; rota `hostSecret` y lo envía solo al socket del nuevo host (`host-secret{hostSecret}`); sin socket → conserva + warn | flags `isHost` en `activeUsers` + `host-changed` a sala (el anterior baja a cohost) |
| 19 | `rename-participant { roomId, oldName, newName, targetUserId? + auth }` | `RoomDrawer` | `newName.trim()`; colisión con otro nombre → `action-denied` | ✅ auto-rename libre; a otros exige `requireModerator` | re-key de `activeUsers` + `activeMediaStates`; `participant-renamed{oldName,newName,userId,participants}` a sala |
| 20 | `update-room-settings { roomId, settings + auth }` | `useRoomSocket` (3 acciones) + `Room.tsx` (requireApproval) + `RoomDrawer` | `roomId && settings`; `sanitizeRoomSettings` **atómico** (error → `settings-error`, nada se aplica) | ✅ `requireHost` estricto | `room-settings-updated{settings}` a sala |
| 21 | `webrtc-offer { targetSocketId, offer, callerName, callerIsHost }` | `useWebRTC` | ❌ ninguna (ni sala ni membresía) | ❌ | `webrtc-offer{senderSocketId,offer,callerName,callerIsHost}` al target |
| 22 | `webrtc-answer { targetSocketId, answer }` | `useWebRTC` | ❌ | ❌ | `webrtc-answer{senderSocketId,answer}` al target |
| 23 | `webrtc-ice-candidate { targetSocketId, candidate }` | `useWebRTC` | ❌ | ❌ | `webrtc-ice-candidate{senderSocketId,candidate}` al target |
| 24 | `peer-media-state { roomId, userName?, isCameraOn, isMicOn }` | `useWebRTC` | `roomId` | ❌ (identidad = `activeUsers` o `userName` del payload) | guarda en `activeMediaStates` (por socket.id **y** por nombre) + reenvío a otros |
| 25 | `disconnect` (implícito) | cierre navegador / `disconnectSocket()` | pendiente→borra join-request; con `userId`→gracia 20 s; sin `userId`→eliminación inmediata | — | `join-requests-updated` / (`host-changed` + `user-left`) diferidos o inmediatos; limpia playback si la sala queda vacía |
| — | `timer-sweep` (servidor, cada 15 s) | — | `settings.timerEndsAt <= now` | — | `room-closed{message, reason:'timer'}` + `socketsLeave` + `deleteRoom(force=false)` |

## 2. Servidor → Cliente (30; todos verificados en ambos extremos salvo nota)

`room-state` · `join-pending` · `join-approved{roomId}` · `join-rejected{reason,message}`
· `join-requests-updated{joinRequests}` · `user-joined{socketId,userName,isHost?,participants}`
· `user-left{socketId,userName,participants}` · `host-changed{newHostName,participants}`
· `room-closed{message,reason?}` · `sync-video{action,currentTime,sentAt,senderSocketId}`
· `video-changed{video}` · `upload-progress{progress,fileName?}` · `chat-message{id,user,text,timestamp}`
· `reaction{id,emoji,user,xOffset}` · `force-mute-user{targetSocketId,targetUserName}`
· `force-disable-camera{…}` · `force-mute-all` · `force-disable-all-cameras`
· `user-kicked{targetUserName,targetUserId,kickedBy,banned,participants,kickedUsers}`
· `kicked-users-updated{kickedUsers}` · `participant-role-updated{targetUserName,role,participants}`
· `participant-renamed{oldName,newName,userId,participants}` · `room-settings-updated{settings}`
· `settings-error{message}` · `action-denied{event,message}` ·
`webrtc-offer{senderSocketId,offer,callerName,callerIsHost}` · `webrtc-answer{senderSocketId,answer}`
· `webrtc-ice-candidate{senderSocketId,candidate}` ·
`peer-media-state{socketId,userName,isCameraOn,isMicOn}`.

Listeners FE: 25 en `useRoomSocket` + 8 en `useWebRTC`
(`room-state,user-joined,webrtc-offer/answer/ice-candidate,peer-media-state,user-left,participant-renamed`).
⏳ `useWebRTC` re-escucha `room-state/user-joined/user-left/participant-renamed`
además de `useRoomSocket`: doble suscripción al mismo socket — funciona pero
duplica manejo; pendiente comprobar limpieza (`off`) en ese hook.

## 3. Duplicados e inconsistencias (todas verificadas)

1. **`video-changed` sin auth.** Cualquiera cambia el video de la sala y resetea
   el snapshot. REST (`uploadVideo`/`setVideoUrl`) sí exige host; el socket no.
   El FE hace ambas cosas (REST + emit), así que hoy el rol se controla solo en UI.
2. **`sync-video` sin auth ni validación de rango.** `currentTime` negativo/NaN no
   se filtra en este handler (el heartbeat sí filtra). El FE compensa latencia con
   `sentAt`, pero un cliente malicioso puede desincronizar la sala.
3. **Chat/reactions sin auth, sin longitud máxima, sin sanitización.**
   `userName` viene del payload (suplantación trivial); `Math.random()` como id.
4. **WebRTC relay totalmente abierto** (ofertas/ICE a cualquier `targetSocketId`,
   sin comprobar sala ni membresía): usable como reflector entre sockets.
5. **`broadcastExcept` del `EventBus` no excluye** (`void exceptSocketId` →
   emite a toda la sala). Hoy sin impacto (clase muerta), trampa si se revive.
6. **`io.to` vs `socket.to` inconsistente pero intencionado en su mayoría:**
   `video-changed`/`chat`/`moderación` incluyen al emisor; `sync-video`/
   `upload-progress`/`peer-media-state` lo excluyen; `user-joined` tras
   `approve-join` usa `io.to` (incluye al aprobador — comentario en código).
7. **`room-closed` con dos formas:** `close-room` sin `reason`, timer-sweep con
   `reason:'timer'`; el FE solo lee `message` (compatible hoy, frágil mañana).
8. **`join-room` confía parcialmente en el cliente:** `isHost` del payload entra en
   `isActuallyHost`, y `isAuthorized` acepta coincidencia solo por
   `hostName == requesterName`. Contradice el docstring “nunca se confía”.
9. **`video-changed` no persiste en BD** (solo broadcast + snapshot en memoria);
   la persistencia ocurre por la vía REST paralela. Si el REST falla pero el
   socket llega (o viceversa), sala y BD divergen.
10. **Limpieza asimétrica:** `leave-room`/`disconnect` llaman `dropPosition`;
    `close-room` y el timer-sweep borran los maps pero **no** limpian
    `activeUsers`/`activeMediaStates` de los desalojados (entradas huérfanas
    hasta su propio `disconnect`).
