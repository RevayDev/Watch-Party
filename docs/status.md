# Estado del Proyecto (Watch-Party) — real, post-reorganización

## 1. Stack y arquitectura real
- **Frontend**: React 18 + Vite 6 + TypeScript 5, CSS propio con metodología BEM (`src/styles/` + `src/index.css` como agregador). Sin Tailwind, sin store global (solo `NotificationProvider`).
  - `src/features/{room,participants,player,chat,waiting,home}` — `Room.tsx` es composición sobre `hooks/useRoomSocket.ts`; `Participants`, `VideoPlayer` y `Home` divididos por responsabilidad.
  - `src/shared/` — `BottomSheet`, botones, `useSheetDrag` (absorbe el antiguo `useSwipeDown`), `utils` (`getInitials`, `getAvatarColor`, `formatRelativeTime`), `constants` (claves de storage, eventos).
  - `src/services/` — `api.ts` (REST), `socket.ts` (singleton Socket.IO), `notifications.tsx` (toasts + confirm), `recentRooms.ts`.
  - Tests vitest: `frontend/tests/` (recentRooms, api, shared-utils, auth).
- **Backend**: Node + Express + Socket.IO + Mongoose, arquitectura hexagonal.
  - `domain/` (entidades, `playback-policy` con `resolveRoomTime`, `auth-policy`, `settings-policy`), `ports/`, `application/` (use-cases), `adapters/` (repos mongo/memoria + routing), `sockets/handlers/` por dominio, `services/proxy.service.ts`, `routes/proxy.routes.ts`.
  - Tests vitest: `backend/tests/` (playback, room.service memoria, validaciones, settings, auth, name-collision, disconnect-grace, rest-security, socket-guards).
- **Verificación**: `npx tsc --noEmit` + `npm run build` + `npm run test` en ambos paquetes (117 backend + 63 frontend en verde).

## 2. Seguridad (autorización real, no solo UI)
- `hostSecret` (32 hex, generado al crear) se guarda en sesión y viaja en payloads socket (`hostSecret`) y headers REST (`x-host-secret`, + `x-user-id`/`x-user-name`).
- Guards por estado del servidor (`domain/auth-policy.ts`): moderación (mute/cam/kick/ban/roles/approve/reject) exige host o cohost; settings/close-room exigen host; renombrar a otros exige moderador (auto-rename libre). Denegado → `action-denied` al emisor.
- REST: subida/video-url/borrado → 403 sin host; `join` → 403 baneado, 409 nombre en uso.
- Settings inválidos/desconocidos → 400 REST con mensaje; por socket → `settings-error` y no se aplica nada.
- Límite conocido: `userId` lo genera el navegador (suplantable entre cómplices); el secreto cubre al host original.

## 3. Comportamientos sensibles implementados
- **Consenso de playback**: heartbeat 5s por miembro; al (re)entrar se adopta la mediana del grupo mayoritario (±3s), empate → más antiguo en sala, sin reportes → último snapshot.
- **Gracia de desconexión**: 20s antes de eliminar/transferir host; rejoin con mismo `userId` conserva rol; `leave-room` inmediato.
- **Colisión de nombres**: rechazo `name-taken` (join y rename) salvo misma identidad.
- **Toasts**: fondo oscuro común + línea inferior por tipo (3px), X visible siempre (22px PC / 18px móvil), auto-dismiss 5s.
- **Botones**: verde encendido/aceptar, rojo apagado/rechazar/salir, índigo activo/presionado (mismo lenguaje en Chat, Participantes y Solicitudes).

## 4. Pendiente / riesgos aceptados
- Sin ESLint; bundle principal >500 kB (code-splitting hls pendiente); sin PWA.
- `CLIENT_URL` documentado pero sin uso como allowlist CORS (CORS `*`); sin rate-limit.
- Refresh que supera la gracia de 20s re-entra como miembro (el host transferido no revierte).
- `PATCH /:roomId/settings` acepta `{settings:{…}}` u objeto directo (flexible a propósito).
