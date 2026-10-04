# IMPACT_MAP — módulos centrales y blast radius

Ordenados por nº de importadores / criticidad. “Si tocas X → verifica Y”.

## 1. `backend/src/services/room.service.ts` (444 lín) — CORAZÓN

7 importadores: controller, 3 usecases, 4 handlers (join/sync/moderation/settings).
Toda mutación de sala pasa por aquí + `roomRepository` singleton.

- Cambiar firma de `joinRoom/approveJoinRequest/rejectJoinRequest/
  removeParticipantAndTransferHost/updateSettings` → rompe controller + los 3
  usecases + `join-approval.handler` + tests `room.service`, `socket-guards`.
- Cambiar identidad (`userId` vs nombre) → rompe ban, colisión, approval, rename,
  transferencia de host y `activeUsers` del socket.
- Cambiar `deleteRoom(forceDeleteVideo)` → huérfanos en `uploads/` o borrado de
  videos de salas persistentes.

## 2. `backend/src/sockets/socket-state.ts` (13 lín) — DIRECTORIO EN MEMORIA

`activeUsers`/`activeMediaStates` importados por `socket-auth` + 4 handlers +
`webrtc-relay`. Es la “sesión” real (el claim cae aquí cuando el payload no
trae credenciales).

- Cambiar forma de `SocketUser` → rompe `socket-auth`, join/leave/disconnect,
  rename (re-key por nombre), `peer-media-state`.
- Se pierde con reinicio (no persistido): reconexiones masivas tras deploy
  pasan por gracia/REST, no por este mapa.

## 3. `backend/src/domain/*` — POLICIES

- `auth-policy` (controller + 3 handlers + socket-auth): endurecer
  `isAuthorized` (p. ej. quitar fallback por nombre) puede dejar sin permiso a
  clientes legacy sin `userId`; relajarlo abre moderación a cualquiera.
- `playback-policy` (`roomPlayback`/`roomPositions` + `resolveRoomTime`):
  cambiar `CLUSTER_TOLERANCE_SEC`/`POSITION_TTL_MS` altera a qué tiempo entran
  los recién llegados; es estado en memoria (reinicio = consenso vacío).
- `settings-policy` (whitelist + atómico): añadir/quitar clave cambia el
  contrato `update-room-settings` en 4 emisores FE; romper atomicidad deja
  medias aplicaciones.
- `room.entity` (`isNameTaken`, `findBannedEntry`): espejo REST↔socket; cambiar
  uno sin el otro reabre bypass de ban/colisión por la otra puerta.

## 4. `backend/src/sockets/handlers/join-approval.handler.ts` (410 lín)

Flujo más largo: ban, gracia, colisión, approval, peers WebRTC, `room-state`,
transferencia de host, `disconnect`. Tocar el orden (p. ej. mover el ban
después del `socket.join`) deja entrar a baneados al canal aunque se les
rechace luego.

## 5. `backend/src/adapters/*` + `ports/room.repository.ts`

El routing decide Mongo vs memoria **por llamada**. Cambiar `active()` (p. ej.
cachear la decisión) deja escrituras en el backend equivocado tras una
caída/recuperación de Mongo. `memory` persiste a `data/rooms.json` con debounce:
cambios de formato rompen `loadFromDisk` (tiene `reviveDate` defensivo).

## 6. Frontend: `useRoomSocket.ts` (844 lín) + `useWebRTC.ts` (563 lín)

- `useRoomSocket`: 25 listeners + todas las acciones + timers UI. Cambiar un
  nombre de evento rompe en silencio (socket.io no tipa; solo tests de contrato,
  que no existen en FE para sockets). El cleanup `socket.off` debe mantenerse
  1:1 con los `socket.on` o hay listeners duplicados tras remontar.
- `useWebRTC`: malla P2P (offer/answer/ICE + DataChannel `media-state`).
  Cambiar el payload `peer-media-state` rompe `CameraGrid`/`peerMediaStates`
  (doble clave socket.id + nombre en minúsculas).
- `shared/utils.ts` (`buildSocketAuth`/`buildRestAuthHeaders`): quitar un campo
  convierte acciones de host en `action-denied`/403 sin error visible salvo toast.
- `services/socket.ts`: singleton global; crear un segundo socket (p. ej. en
  tests o StrictMode) duplica `join-room` y peers.

## 7. Muertos y trampas (tocar con cuidado o eliminar)

- `EventBus`/`SocketEventBus`: muertos. **No** construir encima sin arreglar
  `broadcastExcept` (ignora `exceptSocketId`).
- Funciones de `room.entity` sin uso (`normalizeRoomId`, `matchesParticipant`,
  `isAlreadyParticipant`, `findParticipant`, `resolveIsHost`,
  `participantIdentity`): duplican lógica inline en `RoomService`/handlers.
  Centralizar aquí es mejora real, pero cambia comportamiento en 5+ sitios:
  hacerlo con tests (`name-collision`, `socket-guards`, `rest-security`).
- `Example.png` (2,84 MB) empaquetado en `frontend/dist`: cualquier cambio en
  assets de `home` mueve el bundle; optimizar (comprimir/lazy) ahorra ~75% del
  total servido.

## 8. Tabla rápida qué-rompe-qué

| Toco | Se rompe |
|---|---|
| Firma `RoomService.*` | controller, usecases, 4 handlers, tests BE |
| `AuthClaim` / `PrivilegedPayload` | `socket-auth`, 4 handlers, `buildSocketAuth`, `buildRestAuthHeaders`, `RoomDrawer` |
| Nombre de evento socket (cualquiera) | emisor FE ↔ handler BE en silencio (sin error de tipos) |
| `IRoom`/`IParticipant` | tipos BE+FE, `room.model`, repositorios, `CameraGrid`, `Participants` |
| `settings` whitelist | `update-room-settings` (4 emisores), `RoomSettingsModal`, REST PATCH |
| `DISCONNECT_GRACE_MS` / `graceKey` | reconexión refresh, tests `disconnect-grace` |
| `roomPositions` TTL / tolerancia | tiempo de entrada de newcomers, tests `resolveRoomTime` |
| `getIsMongoConnected` | todo el routing de persistencia |
| `STORAGE_KEYS` / `HOST_SESSION` | auth host en REST+socket, `App.tsx`, `useRoomSocket` |
