# ARCHITECTURE — estado actual verificado

> Solo aristas comprobadas con lectura de imports. ⏳ = no verificado.

## 1. Visión global

```mermaid
flowchart TB
    subgraph FE["FRONTEND — features + shared (verificado)"]
        APP["App.tsx"]
        HOME["features/home/*"]
        ROOMC["features/room/Room.tsx\n(composición, 227 lín)"]
        URS["features/room/hooks/useRoomSocket.ts\n(god-hook, 844 lín)"]
        DRAWER["features/room/components/*\nRoomControls, RoomDrawer"]
        PLAYER["features/player/VideoPlayer.tsx\n(582 lín)"]
        CHAT["features/chat/Chat.tsx"]
        PART["features/participants/*"]
        WAIT["features/waiting/WaitingApproval.tsx"]
        WRTC["hooks/useWebRTC.ts (563 lín)"]
        API["services/api.ts (REST)"]
        SOCK["services/socket.ts\n(singleton socket.io-client)"]
        SHU["shared/utils.ts\n(auth: buildSocketAuth/buildRestAuthHeaders)"]
        SHC["shared/components + hooks"]
        TYPESFE["types/room.ts"]
    end
    subgraph BE["BACKEND — hexagonal (verificado)"]
        SERVER["server.ts"]
        APPE["app.ts"]
        ROUTES["routes/room.routes.ts\n8 endpoints"]
        CTRL["controllers/room.controller.ts\n(474 lín)"]
        SVC["services/room.service.ts\n(444 lín)"]
        ROUT["adapters/room-repository.routing.ts"]
        MEM["adapters/memory-room.repository.ts"]
        MONGO["adapters/mongo-room.repository.ts ⏳"]
        DOMA["domain/auth-policy\nroom.entity\nplayback-policy\nsettings-policy"]
        APPL["application/aprove-join\nsync-playback\nmoderate-user usecases"]
        PORTS["ports/room.repository.ts\nports/event-bus.ts"]
        SKT["sockets/room.socket.ts\n(setup + timer sweep 15s)"]
        H_JOIN["handlers/join-approval (410 lín)"]
        H_SYNC["handlers/sync-playback"]
        H_MOD["handlers/moderation (221 lín)"]
        H_SET["handlers/settings"]
        H_CHAT["handlers/chat-reactions"]
        H_RTC["handlers/webrtc-relay"]
        SAUTH["sockets/socket-auth.ts"]
        SSTATE["sockets/socket-state.ts\n(activeUsers, activeMediaStates)"]
        GRACE["sockets/disconnect-grace.ts\n(20s)"]
        DEAD["adapters/SocketEventBus\n⚠️ MUERTO: 0 usos"]
    end
    APP --> HOME & ROOMC
    ROOMC --> URS
    URS --> API & SOCK & WRTC & SHU
    DRAWER --> SOCK & SHU
    PLAYER --> URS
    WRTC --> SOCK
    API --> SHU
    HOME & PART & CHAT --> TYPESFE & SHU & SHC
    SERVER --> APPE & SKT
    SKT --> H_JOIN & H_SYNC & H_MOD & H_SET & H_CHAT & H_RTC
    H_JOIN & H_SYNC & H_MOD & H_SET --> APPL & SVC & DOMA & SAUTH & SSTATE
    H_CHAT --> SSTATE
    H_RTC --> SSTATE
    H_JOIN --> GRACE
    APPL --> SVC
    SVC --> ROUT
    ROUT --> MEM & MONGO
    CTRL --> SVC & DOMA
    ROUTES --> CTRL
    DEAD -.- PORTS
    URS -.REST + socket.io.-> CTRL & SKT
```

## 2. Aristas verificadas (import real → dependencia)

### Backend

| Origen | Destino | Vía |
|---|---|---|
| `server.ts` | `app.ts`, `config/database`, `config/cors`, `sockets/room.socket` | import directo |
| `app.ts` | `routes/room.routes`, `routes/proxy.routes`, `middleware/error`, `config/cors` | import directo |
| `routes/room.routes` | `controllers/room.controller`, `middleware/upload`, `middleware/rate-limit` | import directo |
| `controllers/room.controller` | `services/room.service`, `domain/{room.entity,auth-policy,settings-policy}` | import directo — **REST salta `application/`** |
| `services/room.service` | `adapters/room-repository.routing` (singleton concreto) | import directo — **sin inyección, viola DI hexagonal** |
| `adapters/room-repository.routing` | `ports/room.repository` (type), `config/database` (`getIsMongoConnected`), `memory`, `mongo` | import directo |
| `adapters/memory|mongo` | `ports/room.repository` (type), `types/room.types` | solo tipos + modelo |
| `sockets/room.socket` | `services/room.service`, `domain/playback-policy` (maps + re-export `resolveRoomTime`), 6 handlers | import directo |
| `sockets/handlers/*` | `application/*` (casos de uso), `services/room.service`, `domain/*`, `socket-auth`, `socket-state` | ver detalle §4 |
| `application/*.usecase` | `services/room.service` o `domain/playback-policy` | **usecase → servicio concreto (capa invertida)** |
| `domain/auth-policy` | `domain/room.entity` (`isHostParticipant`) | única arista domain→domain |
| `sockets/socket-auth` | `sockets/socket-state` (`activeUsers`) | estado compartido |
| `ports/event-bus` / `adapters/SocketEventBus` | **nadie los importa** (solo `import type` interno) | ⚠️ código muerto |

### Frontend

| Origen | Destino | Vía |
|---|---|---|
| `App.tsx` | `features/home`, `features/room`, `services/api`, `services/recentRooms`, `services/notifications`, `shared/*` | import directo |
| `features/room/Room.tsx` | `useRoomSocket`, `VideoPlayer`, `CameraGrid`, modales, `RoomControls`, `RoomDrawer` | composición pura |
| `useRoomSocket.ts` | `services/api`, `services/socket`, `services/recentRooms`, `services/notifications`, `hooks/useWebRTC`, `hooks/usePresence`, `shared/*`, `room/utils/sounds` | **9 dependencias: god-hook** |
| `features/room/components/RoomDrawer` | `features/chat`, `features/participants`, `services/socket` implícito vía prop `socket`, `shared/utils` | verificado por grep |
| `hooks/useWebRTC` | `socket.io-client` (inyectado por `useRoomSocket` vía `getSocket()`) | prop `socket` |
| `services/api` | `types/room`, `shared/utils` (auth headers) | import directo |
| `shared/utils` | `shared/constants` | evita importar `services/*` (comentario explícito: no invertir `shared→services`) |
| `shared/index.ts` (barrel) | re-exporta `BottomSheet`, `Button`, `useSheetDrag`, `utils`, `constants` | ⏳ uso del barrel en features no verificado (los features importan rutas profundas) |

## 3. Circulares: **ninguna detectada** en imports estáticos

- Búsqueda de `from '…'` en `backend/src` (91 coincidencias) y `frontend/src`
  (93 coincidencias): ningún par A↔B.
- Sentido único backend: `sockets/handlers → application → services → adapters → ports/types`;
  `domain` solo recibe desde fuera (salvo `auth-policy → room.entity`, unidireccional).
- Riesgo no-circular pero real: **estado global mutable compartido**
  (`activeUsers`, `activeMediaStates` en `socket-state.ts`;
  `roomPlayback`, `roomPositions` en `domain/playback-policy.ts`) — acoplamiento
  temporal invisible al grafo de imports.

## 4. Detalle handlers → capas (verificado línea a línea)

| Handler | application | services | domain | socket-* |
|---|---|---|---|---|
| `join-approval` | Approve/RejectJoin, ResolveSyncTime | RoomService | playback-policy, room.entity, auth-policy | socket-state, socket-auth, disconnect-grace |
| `sync-playback` | SyncPlayback, RecordHeartbeat | RoomService | playback-policy | socket-state; `PrivilegedPayload` (type, sin uso de auth) |
| `moderation` | Kick/Unban/SetRole/Rename | RoomService | auth-policy | socket-state, socket-auth |
| `settings` | — | RoomService | settings-policy, auth-policy | socket-auth |
| `chat-reactions` | — | — | — | **ninguno (ni state ni auth)** |
| `webrtc-relay` | — | — | — | socket-state (solo lectura) |

Lectura: `chat-reactions` y `webrtc-relay` son **relays sin validación ni auth**;
`sync-playback` importa el tipo `PrivilegedPayload` pero **nunca llama a
`resolveSocketClaim`/`requireHost`** (cualquiera sincroniza o cambia el video).

## 5. Módulos más conectados (nº de importadores en `src`)

1. `types/room.types.ts` — casi todo el backend (entidad plana compartida).
2. `services/room.service.ts` — 7 importadores: controller + 3 usecases +
   `room.socket` (re-export indirecto) + handlers join/sync/moderation/settings.
3. `domain/auth-policy.ts` — controller + 3 handlers + `socket-auth` (type).
4. `sockets/socket-state.ts` — `socket-auth` + 4 handlers (directorio en memoria).
5. Frontend: `shared/utils.ts` (`buildSocketAuth`, `buildRestAuthHeaders`,
   `getStoredUserId`) — `api.ts`, `useRoomSocket`, `Room.tsx`, `RoomDrawer`,
   `Participants/*`, `RoomHeader`; y `services/socket.ts` (`getSocket`) —
   `useRoomSocket` + `useWebRTC` (vía prop).

## 6. Código sin referencias en `src` (honesto: verificación por búsqueda)

- ⚠️ `ports/event-bus.ts` + `SocketEventBus`/`createSocketEventBus`
  (`adapters/index.ts`): **0 usos fuera de su archivo**. Muerto confirmado.
- ⚠️ `domain/room.entity.ts`: `normalizeRoomId`, `participantIdentity`,
  `matchesParticipant`, `isAlreadyParticipant`, `findParticipant`,
  `resolveIsHost` — **sin llamadas en `src`** (lógica duplicada inline en
  `RoomService.joinRoom`, `removeParticipantAndTransferHost` y en
  `join-approval.handler`). Solo cubiertos parcial/directamente por tests.
- ⚠️ `SocketEventBus.broadcastExcept(roomId, exceptSocketId, …)` ignora
  `exceptSocketId` (`void exceptSocketId`) y emite a **toda** la sala —
  trampa latente si alguien lo usa creyendo que excluye.
- ⏳ `frontend/src/shared/index.ts` (barrel): los features importan rutas
  profundas (`shared/utils`, `shared/components/BottomSheet`); sin grep de
  `from '…/shared'` (barrel) no se confirma uso — pendiente.
- ⏳ `frontend/src/components/MediaControls.tsx` vs `RoomControls.tsx`:
  posible duplicación de controles — pendiente (solo LOC: 44 vs 190).

## 7. Métricas honestas

### Líneas por módulo clave (físicas, con `Get-Content`; frontend incluye binarios)

Backend `src` (top): `room.controller.ts` 474 · `room.service.ts` 444 ·
`join-approval.handler.ts` 410 · `moderation.handler.ts` 221 ·
`proxy.service.ts` 167 · `playback-policy.ts` 112 · `room.model.ts` 106 ·
`settings-policy.ts` 98 · `room.entity.ts` 97 · `auth-policy.ts` 89 ·
`memory-room.repository.ts` 88 · `sync-playback.handler.ts` 72 ·
`room.types.ts` 68 · `disconnect-grace.ts` 62 · `sync-playback.usecase.ts` 57 ·
`mongo-room.repository.ts` 53 · `webrtc-relay.handler.ts` 52 ·
`room.socket.ts` 46 · `moderate-user.usecase.ts` 39 ·
`room-repository.routing.ts` 36 · `settings.handler.ts` 33 · `app.ts` 33 ·
`chat-reactions.handler.ts` 30 · `socket-auth.ts` 26 · `adapters/index.ts` 25 ·
`room.routes.ts` 14 · `event-bus.ts` 13 · `socket-state.ts` 13 ·
`approve-join.usecase.ts` 20.

Frontend `src` (código): `useRoomSocket.ts` 844 · `Home.tsx` 733 ·
`VideoPlayer.tsx` 582 · `useWebRTC.ts` 563 (624 con el conteo del lector) ·
`HomeModals.tsx` 381 · resto < 300. Total `src` ≈ 7.500 líneas de código
(descontando `Example.png` e `index.css`).

### Socket, tests, bundle

- Eventos socket: **25 inbound + `disconnect` / 30 outbound** (detalle en
  `SOCKET_EVENTS.md`).
- Tests: backend 10 ficheros (~1.450 líneas con `helpers.ts`):
  `socket-guards` 345, `resolveRoomTime` 248, `room.service` 204,
  `rest-security` 204, `room.validations` 105, `settings-policy` 100,
  `auth-policy` 98, `disconnect-grace` 66, `helpers` 43, `name-collision` 35.
  Frontend 6 ficheros (~590 líneas): `auth` 175, `api` 127, `recentRooms` 122,
  `uploadVideo` 113, `shared-utils` 80, `WaitingApproval` 72.
- Bundle (artefactos existentes, **no reconstruido**): `frontend/dist` ≈
  **3,8 MB** total = JS `index-*.js` **938 KB** + CSS 104 KB +
  `Example-*.png` **2,84 MB** + `index.html` 1,8 KB. `backend/dist` = 38 `.js`
  ≈ **124 KB**.

## 8. ¿Hexagonal/features proporcional? (revisión conceptual)

1. **Application como pasamanos.** Los 3 ficheros de `application/` (20–57 lín)
   delegan 1:1 en `RoomService` sin regla propia (salvo `sync-playback`,
   que sí encapsula el snapshot). La dirección `application → services`
   (concreto) invierte la hexagonal: el caso de uso depende de la
   implementación, no del puerto.
2. **REST ignora `application/`.** El controller llama a `RoomService` +
   `domain` directamente. Dos puertas de entrada, dos caminos distintos.
3. **Puerto sin adaptador usado.** `EventBus` + `SocketEventBus` muertos: la
   abstracción existe pero los handlers emiten con `io`/`socket` crudos.
4. **Dominio con estado global.** `roomPlayback`/`roomPositions` viven en
   `domain/playback-policy.ts`: el “núcleo puro” es un singleton mutable en
   memoria (pérdida de sync ante reinicio; el consenso depende de heartbeats
   de 12 s TTL). Funciona, pero no es dominio puro.
5. **Servicio acoplado al adaptador concreto.** `RoomService` importa el
   singleton `roomRepository` del routing; no hay inyección ni costura de
   test sin tocar el módulo.
6. **Contradicción con el comentario de `auth-policy`.** Dice “nunca se confía
   en flags del cliente”, pero `join-room` calcula `isActuallyHost` con
   `isHost || …` (flag del cliente cuenta) y `isAuthorized` tiene fallback por
   `hostName == requesterName` (suplantable con solo el nombre).
7. Frontend `features/` es proporcional y legible; la excepción es
   `useRoomSocket` (844 lín, 25 listeners + todas las acciones + timers UI):
   god-hook que concentra lo que el backend reparte en 6 handlers.
8. Veredicto: hexagonal **ceremonial** para el tamaño real (1 servicio gordo +
   policies puras habrían bastado); útil si se va a inyectar el repositorio,
   revivir el `EventBus` y engordar `application/`. Si no, simplificar a
   `routes → controller → service + domain policies → repository port`.
