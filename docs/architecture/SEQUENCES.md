# SEQUENCES — 8 flujos verificados

Convenciones: `roomId` normalizado en servidor; `A → B: evento(payload)` =
socket; `A ⇒ B: método()` = llamada/REST. Solo pasos leídos en código.

## 1. Crear sala (REST + sesión host)

```mermaid
sequenceDiagram
    participant U as Usuario (Home.tsx)
    participant API as ApiService.createRoom
    participant BE as POST /api/rooms (controller)
    participant SVC as RoomService.createRoom
    participant DB as roomRepository.create
    U->>API: createRoom(hostName, isTemporary)
    API->>BE: body{hostName,isTemporary,userId?} + headers x-user-id
    BE->>SVC: createRoom(dto)
    SVC->>SVC: getUniqueRoomCode() (6 chars) + hostSecret 16B
    SVC->>DB: create(room con host como participant role:host)
    DB-->>U: 201 {roomId, hostSecret}
    U->>U: saveHostSession(roomId,hostName,hostSecret) + saveRecentRoom()
```

## 2. Unirse (caso simple, sin approval)

```mermaid
sequenceDiagram
    participant G as Invitado (App.handleJoinRoom)
    participant R as REST POST /:roomId/join
    participant S as socket join-room
    participant BE as join-approval.handler
    G->>R: {userName, userId} + headers auth
    R->>R: ban? (403) · name-taken? (409) · approval? (pendingApproval:true)
    R-->>G: {participants}
    G->>S: join-room{roomId,userName,isHost:false,userId}
    BE->>BE: ban→join-rejected · name-taken→join-rejected
    BE->>BE: activeUsers.set + RoomService.joinRoom (upsert por userId)
    BE->>BE: ResolveSyncTimeUseCase (consenso heartbeats → snapshot)
    S-->>G: room-state{hostName,isHost,settings,video,participants,peers,mediaStates,playback}
    S-->>G: a otros: user-joined (socket.to, salta mismo-socket rejoin)
```

Puertas paralelas: el REST añade al participante **y** el socket también
(`joinRoom` es upsert idempotente por `userId`, por eso no duplica).

## 3. Approval (sala con `requireApproval`)

```mermaid
sequenceDiagram
    participant G as Invitado
    participant H as Host (RoomDrawer/Solicitudes)
    participant BE as handler
    G->>BE: join-room{…}
    BE->>BE: requireApproval && !host && !alreadyParticipant
    BE->>BE: activeUsers.set{pending:true} + addJoinRequest (dedupe por userId)
    BE-->>G: join-pending (FE muestra WaitingApproval)
    BE-->>H: join-requests-updated (toast si es nuevo)
    alt aprobar
        H->>BE: approve-join{userId|name + auth}
        BE->>BE: requireModerator else action-denied
        BE->>BE: ApproveJoinUseCase (mueve request→participants)
        BE-->>G: join-approved{roomId} (al socket pendiente)
        BE-->>H: join-requests-updated + user-joined (io.to: incluye aprobador)
        G->>BE: join-room (re-join; recibe room-state + peers)
    else rechazar / ban
        H->>BE: reject-join{…ban? + auth}
        BE-->>G: join-rejected{rejected|banned} + borra su activeUsers
        BE-->>H: join-requests-updated (+kicked-users-updated si ban)
    end
```

## 4. Reconexión / gracia de refresh (20 s)

```mermaid
sequenceDiagram
    participant C as Cliente (socket.id A)
    participant BE as handler + disconnect-grace
    C->>BE: disconnect (cierre / refresh)
    BE->>BE: activeUsers.delete(A) + dropPosition
    alt pending (lista de espera)
        BE->>BE: rejectJoinRequest + join-requests-updated (inmediato)
    else con userId
        BE->>BE: schedulePendingGrace(roomId:userId, 20s)
        alt rejoin con mismo userId < 20s
            C->>BE: join-room (socket.id B)
            BE->>BE: hasPendingGrace→cancelPendingGrace (conserva participante+rol)
        else expira
            BE->>BE: removeParticipantAndTransferHost + host-changed? + user-left
        end
    else sin userId (legacy)
        BE->>BE: eliminación + transferencia inmediatas
    end
```

`leave-room` voluntario es inmediato y cancela gracias pendientes.
`user-left` solo se emite al eliminar de verdad. El FE además re-emite
`join-room` en cada `connect` (reconexión a nivel socket.io).

## 5. Chat y reacciones (broadcast puro)

```mermaid
sequenceDiagram
    participant A as Cliente A (handleSendMessage/handleReaction)
    participant BE as chat-reactions.handler
    participant B as Sala (io.to(roomId))
    A->>BE: send-message{roomId,text,userName} (sin auth)
    BE->>BE: solo exige text.trim() no vacío; id = Math.random()
    BE-->>B: chat-message{id,user,text,timestamp HH:MM}
    A->>BE: send-reaction{roomId,emoji,userName} (sin auth)
    BE-->>B: reaction{id,emoji,user,xOffset}
```

Sin persistencia (el historial vive solo en el estado React; al recargar se
pierde). Sin validación de longitud ni sanitización.

## 6. Sync de video (emisión + consenso de entrada + heartbeat)

```mermaid
sequenceDiagram
    participant H as Cualquiera (onSyncAction)
    participant BE as sync-playback.handler
    participant M as Miembros (socket.to)
    participant V as VideoPlayer (remoto)
    participant N as Recién llegado
    H->>BE: sync-video{roomId,action,currentTime} (sin auth)
    BE->>BE: SyncPlaybackUseCase → setPlaybackSnapshot (memoria)
    BE-->>M: sync-video{action,currentTime,sentAt,senderSocketId}
    M->>V: aplica con compensación (Date.now()-sentAt)s; seek si diff>2s
    loop heartbeat ~5s (VideoPlayer→Room.tsx→socket)
        M->>BE: playback-heartbeat{roomId,currentTime,isPlaying} (solo miembros)
        BE->>BE: RecordHeartbeatUseCase → roomPositions[socketId]
    end
    N->>BE: join-room
    BE->>BE: ResolveSyncTimeUseCase: mediana del cluster mayoritario (±3s, TTL 12s); sin mayoría gana el más antiguo; fallback snapshot con elapsed
    BE-->>N: room-state.playback{currentTime,isPlaying}
```

## 7. Moderación (patrón único con variantes)

```mermaid
sequenceDiagram
    participant M as Moderador (RoomDrawer + buildSocketAuth)
    participant BE as moderation.handler
    participant S as Sala / Víctima
    M->>BE: moderate-mute-user/disable-camera/mute-all/disable-all-cameras/kick-user/unban-user/set-role/rename-participant (+auth)
    BE->>BE: requireModerator(room, resolveSocketClaim) — salvo auto-rename
    BE->>BE: caso de uso delgado → RoomService (kick/unban/role/rename)
    alt kick/ban
        BE-->>S: user-kicked{target,banned,participants,kickedUsers} (víctima se auto-expulsa en FE)
    else mute/camara/rol/settings
        BE-->>S: force-mute-user / force-disable-camera / force-mute-all / force-disable-all-cameras / participant-role-updated / participant-renamed / kicked-users-updated
    else sin permiso / nombre ocupado
        BE-->>M: action-denied{event,message}
    end
```

`rename-participant` además re-keyea `activeUsers` y `activeMediaStates`
(clave por nombre en minúsculas) — acoplamiento nombre-como-clave.

## 8. Persistencia (routing + doble vía de video)

```mermaid
sequenceDiagram
    participant E as Entrada (REST controller / socket handler)
    participant SVC as RoomService
    participant R as routing repository
    participant MG as mongo-room.repository ⏳
    participant MM as memory-room.repository (data/rooms.json)
    E->>SVC: getRoomById/joinRoom/save… (siempre con cleanId)
    SVC->>R: exists/create/findById/save/delete/findTimerCandidates
    R->>R: getIsMongoConnected()? (por llamada)
    R->>MG: delega si Mongo conectado ⏳
    R->>MM: delega si no (Map + persistencia a disco con debounce 300ms)
```

Doble vía de video (divergencia posible): `POST /:roomId/video` o `/video-url`
(REST, exige host, persiste en BD) **+** `video-changed` por socket (sin auth,
solo broadcast + reset de snapshot). El FE ejecuta REST y, si ok, emite el
socket. `streamVideo` sirve fichero local con `206 Partial Content` (chunks
3 MB) o redirige a `directUrl` para `hls/url`. Borrado físico solo si
`forceDeleteVideo` o sala temporal; si no, el fichero se conserva.
Timer-sweep (`room.socket.ts` cada 15 s) cierra salas con `timerEndsAt` pasado.
