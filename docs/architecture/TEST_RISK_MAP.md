# TEST_RISK_MAP — flujos críticos → módulos → tests a correr

> Estado 2026-10-09: `npm run test` frontend **19 ficheros / 207 tests OK**,
> backend **32 ficheros / 326 tests OK** (ver §3: `sync-hostonly` 7, `moderation-host` 12). Control de reproducción (`hostOnlySync`), roles solo-host y `transfer-host` cubiertos.
> borrados los tests de pagos/premium/admin/status (código eliminado) y
> añadidos `docs-openapi`, `useRoomSocket`, `room-header`, `chat-typing`,
> `interstellar`, `perf`, `webrtc-quality`, `video-ready`,
> `approve-join-full-socket`. Regla de organización: **1 módulo → 1 fichero
> de test** (por eso hay muchos: es orden, no duplicación).
> Este mapa dice **qué correr al tocar cada módulo**. No sustituye verificación
> en navegador real / MongoDB real (ver LIMITACIONES abajo).

## 1. Matriz flujo → módulos → tests obligatorios

| # | Flujo crítico | Módulos backend | Módulos frontend | Al tocar → correr |
|---|---|---|---|---|
| F1 | Crear sala (REST) | `routes/room.routes.ts`, `controllers/room.controller.ts`, `services/room.service.ts`, `middleware/rate-limit` | `services/api.ts` (createRoom), `features/home/Home.tsx`, `features/home/HomeModals.tsx` | BE `room.validations` + `room.service` + `rest-security`; FE `api` |
| F2 | Unirse a sala (REST + socket) | `room.service.joinRoom`, `domain/room.entity` (`isNameTaken`, `findBannedEntry`), `sockets/handlers/join-approval.handler` | `services/api.ts` (joinRoom), `features/room/hooks/useRoomSocket.ts` (emitJoin, join-pending/approved/rejected) | BE `name-collision` + `room.service` + `socket-guards` + `rest-security`; FE `api` + `WaitingApproval` |
| F3 | Salir de sala / transferencia host | `room.service.removeParticipantAndTransferHost`, `disconnect-grace.ts`, `socket-state.ts` | `useRoomSocket` (handleLeaveOnlyMe, host-changed), `HostExitModal`, `MemberExitModal` | BE `room.service` + `socket-guards` (H3) + `disconnect-grace`; FE `socket-singleton` |
| F4 | Approval (requireApproval) | `room.service` (joinRequests), `application/approve-join.usecase.ts`, `join-approval.handler` | `useRoomSocket` (join-requests-updated), `Participants/RequestsTab`, `WaitingApproval` | BE `room.service` + `socket-guards` (approve-join denegado); FE `WaitingApproval` |
| F5 | Chat + reacciones | `sockets/handlers/chat-reactions.handler.ts` ⚠️ **sin guards de payload (bugs B1)** | `features/chat/Chat.tsx`, `components/Reactions.tsx`, `useRoomSocket` (chat-message/reaction, unreadCount) | BE `chat-webrtc-relay` (incluye 1 `it.fails` == bug abierto); FE `shared-utils` |
| F6 | Sync video (play/pause/seek + heartbeat) | `domain/playback-policy.ts`, `application/sync-playback.usecase.ts` ⚠️ **sin validación en vía sync (bug B3)**, `handlers/sync-playback.handler.ts` | `features/player/VideoPlayer.tsx`, `useRoomSocket` (remoteAction, handleSyncAction) | BE `resolveRoomTime` + `sync-usecases` + `socket-guards` (sync-video); FE sin cobertura del player ⚠️ |
| F7 | Kick / ban / unban | `application/moderate-user.usecase.ts`, `handlers/moderation.handler.ts`, `domain/auth-policy.ts` (requireModerator) | `Participants/*` (KickedTab, ParticipantDetail), `useRoomSocket` (user-kicked) | BE `auth-policy` + `socket-guards` (moderación) + `rest-security` (403/409); FE sin cobertura ⚠️ |
| F8 | Rename participante | `room.service.renameParticipant`, `domain/room.entity` (matchesParticipant), `moderation.handler` | `useRoomSocket` (participant-renamed, myName), `Participants` | BE `room.service` + `socket-guards` (rename propio vs ajeno) |
| F9 | Settings sala (whitelist atómica + timer) | `domain/settings-policy.ts`, `handlers/settings.handler.ts`, `room.service.updateSettings` | `components/RoomSettingsModal.tsx`, `RoomHeader` (formatRemaining), `useRoomSocket` (handleSetRoomTimer, settings-error) | BE `settings-policy` + `socket-guards` (settings-error/action-denied) + `rest-security` (PATCH 403/400/200); FE `shared-utils` (formatRemaining) |
| F10 | Reconexión / gracia refresh | `sockets/disconnect-grace.ts`, `socket-state.ts`, `join-approval.handler` (cancelGrace on rejoin) | `services/socket.ts` (singleton/disconnect), `useRoomSocket` (connect→emitJoin) | BE `disconnect-grace` + `socket-guards` (H3 ×3); FE `socket-singleton` |
| F11 | Upload video / video-url / proxy HLS | `middleware/upload.middleware.ts`, `controllers` (video), `services/proxy.service.ts`, `middleware/rate-limit` (uploadVideoLimiter) | `features/player/VideoUploadPicker.tsx`, `services/api.ts` (uploadVideo XHR), `useRoomSocket` (upload-progress, video-changed) | BE `proxy-utils` + `rest-security` (upload 403 sin auth); FE `uploadVideo` + `api` |
| F12 | WebRTC voz/cámara + media-state | `handlers/webrtc-relay.handler.ts` ⚠️ **sin validación/membresía (bug B2)**, `socket-state.activeMediaStates` | `hooks/useWebRTC.ts` (563 lín, **0 tests** ⚠️), `components/CameraGrid.tsx`, `MediaControls.tsx` | BE `chat-webrtc-relay` (incluye 1 `it.fails` == bug abierto); FE sin cobertura ⚠️ |

## 2. Regla rápida por módulo tocado

- `backend/src/services/room.service.ts` → TODO backend (`npm run test` en `backend/`, ~4 s).
  Es el corazón: 7+ importadores; `room.service.test.ts` (21) + `socket-guards` (17)
  + `rest-security` (13) + `room.validations` (10) lo cubren en pinza.
- `backend/src/domain/*-policy.ts` + `room.entity.ts` → su `*.test.ts` directo
  (`auth-policy` 11, `settings-policy` 11, `resolveRoomTime` 24, `name-collision` 6)
  MÁS `socket-guards` + `rest-security` (espejo REST↔socket: cambiar uno sin el otro
  reabre bypass por la otra puerta).
- `backend/src/application/*.usecase.ts` → `sync-usecases` (9) para sync;
  approve/moderate solo tienen cobertura **indirecta** vía `socket-guards` ⚠️
  (gap: sin test unitario directo de `KickUserUseCase`/`ApproveJoinUseCase`).
- `backend/src/sockets/handlers/*` → `socket-guards` (17) + `chat-webrtc-relay` (12)
  + `disconnect-grace` (6). Chat y webrtc-relay **no tenían cobertura**: añadida
  2026-10-04 (`chat-webrtc-relay.test.ts`: 10 OK + 2 `it.fails` = bugs B1/B2).
- `backend/src/services/proxy.service.ts` → `proxy-utils` (10, nuevo 2026-10-04).
  `proxyFetch` con red real sigue sin cobertura (ver LIMITACIONES).
- `backend/src/middleware/*`, `adapters/*`, `config/*`, `routes/*` →
  cubiertos por: `rate-limit` + `rate-limit-extra`, `upload-middleware`,
  `error-middleware`, `adapters-memory`, `cors-config` + `cors-strict`,
  `docs-openapi` (cada path documentado responde de verdad).
- `backend/src/sockets/handlers/video-ready` → `video-ready` (handshake +
  auto-play grupal). `disconnect-grace` → `disconnect-grace`.
- `backend/src/adapters/prisma-room.repository` → `prisma-room` (mapeo puro +
  fallback a memoria; sin DB viva). Cambiar el schema exige
  `npm run prisma:generate` + correr este test.
- Anti-raid: `chat-webrtc-relay` (miembro obligatorio, anti-suplantación) +
  `socket-limits` (helpers + flood de joins frenado antes de la DB) +
  `rate-limit` (spam de chat). Regla: **ningún evento que escriba o emita a
  la sala puede confiar en el payload sin verificar membresía en
  `activeUsers`** (ver `memberNameOf` en `chat-reactions.handler.ts`).
- Legacy y colisiones: `anonymous-legacy` (merge de anónimos),
  `name-collision` (H8), `approve-join-full-socket` (cupo bajo mutex),
  `video-change-guard` (cambio de video), `room.validations` (crear/sala).
- `frontend/src/features/room/hooks/useRoomSocket.ts` → `useRoomSocket` (20:
  listeners, chat/unread, typing, interestellar, heartbeat). Los nombres de
  evento siguen sin tipar (socket.io): si renombras un evento, actualiza test
  + `SOCKET_EVENTS.md` y prueba en 2 navegadores.
- `frontend/src/hooks/useWebRTC.ts` → calidad/estrategia en `webrtc-quality`;
  el hook vivo sigue sin test de integración ⚠️ (mocks de PeerConnection).
- `features/player/VideoPlayer.tsx`, `features/chat/Chat.tsx`,
  `features/participants/*` → sin test directo ⚠️ (solo indirecta vía
  `useRoomSocket` + `WaitingApproval` + `demo-visual`).
- `frontend/src/services/socket.ts` → `socket-singleton`.
  `frontend/src/hooks/usePresence.ts` → `usePresence`.
  `frontend/src/shared/utils.ts` → `shared-utils` + `auth`
  (hostSecret/sesiones/headers).
- `frontend/src/services/api.ts` → `api` (rooms) + `uploadVideo` (XHR progreso)
  + `demo-mode` (`getDemoAvailability` y contrato de mensajes exactos).
- Demo en 3 capas (no duplicadas): `demo-mode` (lógica pura + contrato),
  `demo-home` (componente Home), `demo-visual` (Header/picker/modal).
- Extras UI: `room-header` (pill timer), `chat-typing` (indicador 4 s),
  `reactions-picker` (+ combo interestellar en `interstellar` + `perf`),
  `recentRooms`, `WaitingApproval`.

## 3. Cobertura antes/después (esta sesión QA, sin tocar `src/`)

| Proyecto | Antes (2026-10-04) | Ahora (2026-10-09) |
|---|---|---|
| backend | 12 fich. / 148 OK + 2 `it.fails` | **32 fich. / 326 OK** (dentro `sync-hostonly`, `moderation-host` + anti-raid previo) |
| frontend | 8 fich. / 78 tests | **19 fich. / 193 OK** (dentro `useRoomSocket` 20, `demo-*`, `room-header`, `chat-typing`, `interstellar`, `perf`, `webrtc-quality`) |
| jsdom nuevo / paquetes instalados | **0** | **0** (solo `swagger-ui-express` en backend, para `/api/docs`) |

## 4. ESLint

**Ausente**: no existe `eslint.config.*` ni `.eslintrc*` en raíz, `frontend/` ni
`backend/`; `eslint` no está en ninguna dependencia (`package.json` revisados).
Evidencia de deuda: 5× `// eslint-disable-next-line react-hooks/exhaustive-deps`
huérfanos (`useRoomSocket.ts:681`, `RoomSettingsModal.tsx:47`,
`WaitingApproval.tsx:143`, `useSheetDrag.ts:277`, `BottomSheet.tsx:169`).
No se instala nada (orden QA: sin aporte de test real no se añade herramienta).

## 5. LIMITACIONES — lo que compilar + vitest NO verifican

1. **Navegador real**: VideoPlayer/HLS, autoplay policies, 2 pestañas sincronizadas,
   WebRTC P2P real, `AudioContext` (sounds.ts), `localStorage` multi-sala.
2. **MongoDB real**: los tests usan repositorio en memoria + `data/rooms.json`
   (con backup/restore en `tests/helpers.ts`); routing Mongo↔memoria por llamada,
   TTLs, caídas de conexión y formato de `rooms.json` en disco no verificados.
3. **Reconexión física**: gracia de refresh probada con mocks de socket y
   `hasPendingGrace`, no con corte real de red / reinicio de servidor
   (`socket-state` es memoria volátil: se pierde en deploy).
4. **Red externa**: `proxyFetch` (redirects, Range, Drive virus-scan page),
   `uploadVideo` XHR con progreso, `video-url` con probe de red.
5. **Timing real**: debounce de persistencia (300 ms), `POSITION_TTL_MS` (12 s),
   timer de cierre de sala, throttling de heartbeat — solo unitarios con
   fake timers / valores fijos.
6. **Los 2 `it.fails` son bugs abiertos, no cobertura**: si alguien corrige
   `src/`, esos tests empezarán a *fallar* (así están diseñados: avisan para
   convertirlos en asserts normales). Ver reporte QA 2026-10-04 (B1, B2).
