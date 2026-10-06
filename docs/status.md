# Estado del Proyecto (Watch-Party) — real, post-reorganización y endurecimiento

## 1. Stack y arquitectura real
- **Frontend**: React 18 + Vite 6 + TypeScript 5, CSS propio con metodología BEM (`src/styles/` + `src/index.css` como agregador). Sin Tailwind, sin store global (solo `NotificationProvider`).
  - `src/features/{room,participants,player,chat,waiting,home}` — `Room.tsx` es composición sobre `hooks/useRoomSocket.ts`; `Participants`, `VideoPlayer` y `Home` divididos por responsabilidad.
  - `src/shared/` — `BottomSheet`, botones, `useSheetDrag`, `utils` (`getInitials`, `getAvatarColor`, `formatRelativeTime`), `constants` (claves de storage, eventos).
  - `src/services/` — `api.ts` (REST), `socket.ts` (singleton Socket.IO), `notifications.tsx` (toasts + confirm), `recentRooms.ts`.
  - Tests vitest con jsdom: `frontend/tests/` (recentRooms, api, shared-utils, auth, uploadVideo, WaitingApproval).
- **Backend**: Node + Express + Socket.IO + Mongoose, arquitectura hexagonal.
  - `domain/` (entidades, `playback-policy` con `resolveRoomTime`, `auth-policy`, `settings-policy`), `ports/`, `application/` (use-cases), `adapters/` (repos mongo/memoria + routing dinámico con `getIsMongoConnected()`), `sockets/handlers/` por dominio, `services/proxy.service.ts`, `routes/proxy.routes.ts`, `middleware/rate-limit.middleware.ts`, `config/cors.ts`.
  - Tests vitest: `backend/tests/` (playback, room.service memoria, validaciones, settings, auth, name-collision, disconnect-grace, rest-security, socket-guards con permisos de sync).
- **Verificación**: `npx tsc --noEmit` + `npm run build` + `npm run test` en ambos paquetes (310 backend + 143 frontend en verde). ESLint 9 + `npm run lint` en ambos (0 errores; warnings de `any` legacy aceptados).
- **CORS**: allowlist explícita (`CLIENT_URL` + `ALLOWED_ORIGINS` con exactos y comodines controlados `*.dominio` solo https) + loopback dev `:5173/:4173` + LAN solo en no-producción (`ALLOW_LAN_DEV`, default sí). Previews `https://*.vercel.app` y dominios custom www/apex vía env. `credentials: true` preservado aunque hoy no hay cookies.
- **Anónimos**: dos conexiones sin `userId` y mismo nombre se fusionan (legacy, con tests); frente a nombre registrado rige `name-taken`/409.

## 2. Seguridad y Permisos
- `hostSecret` (32 hex, generado al crear) se guarda en sesión y viaja en payloads socket (`hostSecret`) y headers REST (`x-host-secret`, + `x-user-id`/`x-user-name`).
- **Guards de Socket (`domain/auth-policy.ts`)**:
  - `sync-video` (play, pause, seek): restringido a anfitrión o co-anfitrión (`requireModerator`). Miembros no autorizados reciben `action-denied`.
  - Moderación (mute/cam/kick/ban/roles/approve/reject): exige host o cohost.
  - Settings/close-room: exigen host.
  - Renombrar a otros: exige moderador (auto-rename libre).
- **CORS Centralizado (`config/cors.ts`)**: Coherente en Express y Socket.IO; respeta `CLIENT_URL` y `ALLOWED_ORIGINS` en producción y permite LAN/localhost en desarrollo.
- **Rate Limiting (`middleware/rate-limit.middleware.ts`)**: Ventana deslizante en memoria para creación de salas, subida de video y proxy de streaming con respuesta 429 y `Retry-After`.
- **REST**: subida/video-url/borrado → 403 sin host; `join` → 403 baneado, 409 nombre en uso.
- Settings inválidos/desconocidos → 400 REST con mensaje; por socket → `settings-error` y no se aplica nada.

## 3. Comportamientos sensibles implementados
- **Consenso de playback**: heartbeat 5s por miembro; al (re)entrar se adopta la mediana del grupo mayoritario (±3s), empate → más antiguo en sala, sin reportes → último snapshot.
- **Gracia de desconexión**: 20s antes de eliminar/transferir host; rejoin con mismo `userId` conserva rol; `leave-room` inmediato.
- **Colisión de nombres**: rechazo `name-taken` (join y rename) salvo misma identidad.
- **Toasts**: fondo oscuro común + línea inferior por tipo (3px), X visible siempre (22px PC / 18px móvil), auto-dismiss 5s.
- **Botones**: verde encendido/aceptar, rojo apagado/rechazar/salir, índigo activo/presionado (mismo lenguaje en Chat, Participantes y Solicitudes).

## 4. Documentación y Arquitectura
- `docs/DECISIONS.md`: Registro de decisiones de arquitectura (ADRs 01 a 06).
- `docs/PROJECT_ARCHITECTURE.md`: Documento de referencia de capas hexagonal y frontend.
- `docs/PROJECT_LEARNING_GUIDE.md`: Guía de estudio y mantenimiento para el desarrollador.

## 5. Observabilidad y monetización
- **Métricas** (`services/metrics.service.ts`, en memoria con buckets): requests, latencia avg/p95, errores, WS connects/disconnects, usuarios pico, CPU/RAM (`null` si no disponible).
- **Público**: `GET /api/health` (retrocompatible), `GET /api/status` (10 claves agregadas, cero PII), `GET /api/status/stream` (SSE cada 5s). Frontend: `/status` con sparklines (SSE + fallback polling 12s).
- **Admin** (`ADMIN_TOKEN`, `x-admin-token`/Bearer, token solo en memoria en `/admin`): `GET /api/admin/summary|rooms|payments|gift-codes|audit|metrics`, CRUD de códigos `WATCH-XXXX-XXXX`, reembolsos (solo estado), auditoría. Frontend `/admin` con 7 tabs y gráficas SVG propias.
- **Pagos** (`src/payments/`): `PaymentProvider` + `PaypalProvider` (sandbox/HMAC) + `CardProvider` (stub 501); `POST /checkout`, webhooks PayPal con firma e idempotencia por `providerTransactionId`, canje de regalos idempotente. Sin tarjetas/CVV jamás. Planes centrales en `src/config/plans.ts` (FREE 5/480min, PREMIUM 10/$5000 COP, override por env).
- **Carga** (`backend/tests/load/`, autocannon devDep): rampas 10→100 y escenarios 1×10/5×10/10×10 medidos en local (0 errores; ver `LOAD_TESTING.md`). Nunca contra producción sin aviso.
