# Watch Party — Plan de refactoring inicial (basado en código visto, 2026-10-03)

> Alcance: deuda observada en `backend/src/` y `frontend/src/` el 2026-10-03.
> No asume trabajo de otros agentes. Orden sugerido al final.
> Severidad: **CRÍTICO** = explota/rompe datos o bloquea; **ALTO** = bug probable o
> mantenimiento muy caro; **MEDIO** = calidad/UX; **BAJO** = pulido.

---

## CRÍTICO

### C1. `/api/proxy` abierto (SSRF) — `backend/src/app.ts:211`
- **Problema:** acepta cualquier `url` http(s), sigue 5 redirects, timeout 20 s, sin
  allowlist, sin límite de tamaño/rate. Un cliente puede hacer al servidor pedir
  URLs internas (169.254.x, LAN) o usarlo como amplificador.
- **Solución:** allowlist de hosts para video (Drive, dominios HLS conocidos) o
  validación DNS anti-SSRF + bloqueo de rangos privados + límite de bytes + rate-limit.
- **Riesgo:** si se restringe mal, se rompen enlaces legítimos (HLS arbitrarios).
  Hacerlo con lista configurable + tests del reescritor `.m3u8`.
- **Orden:** 1 (antes de exponer en producción).

### C2. Sin autorización real de host — `room.socket.ts` + `room.service.ts`
- **Problema:** `hostSecret` se genera en `POST /api/rooms` pero **nunca se verifica**.
  `update-room-settings` comprueba `activeUsers.isHost` (falsificable vía `join-room
  { isHost:true }` + coincidencia de nombre). `close-room`, `kick-user`, `set-role`,
  `approve/reject-join` ni siquiera comprueban. Cualquiera que adivine el nombre del
  host puede escalar.
- **Solución:** sesión de host con secreto (token por socket tras `join-room` con
  `hostSecret`), middleware de autorización por evento, no confiar en `isHost` del cliente.
- **Riesgo:** cambio de protocolo (frontend debe enviar secreto). Coordinar con `Room.tsx`.
- **Orden:** 2.

### C3. CORS `*` en Express y Socket.IO — `app.ts:68`, `server.ts:22`
- **Problema:** `cors()` sin origen + `origin:'*'` permite a cualquier web usar la API
  y sockets (CSRF de lectura, abuso del proxy C1).
- **Solución:** usar `CLIENT_URL` (hoy sin uso) como allowlist + `VITE_API_URL` en dev,
  con fallback LAN configurable.
- **Riesgo:** romper dev en LAN/móvil si la lista es estricta. Prever `ALLOWED_ORIGINS`.
- **Orden:** 3 (junto a C1/C2).

### C4. Sin rate-limit — `app.ts`, `room.routes.ts`, `room.socket.ts`
- **Problema:** `express-rate-limit` no instalado (ya lo señala `Instrucciones_Pendientes.md §5`).
  `POST /api/rooms`, `/upload`, `send-message`, `send-reaction`, `sync-video` sin freno.
- **Solución:** rate-limit HTTP (crear/unir/subir/proxy) + throttle de eventos socket
  (chat/reacciones/sync/heartbeats).
- **Riesgo:** límites agresivos cortan el chat en grupo. Medir primero.
- **Orden:** 4.

### C5. Subida 4 GB fija y sin cuota — `middleware/upload.middleware.ts:53`
- **Problema:** `fileSize: 4 GB` hardcodeado, sin `MAX_UPLOAD_MB`, sin cuota por sala/disco,
  nombre `Date.now()-rand+ext` sin saneamiento de extensión. Disco llenable.
- **Solución:** `MAX_UPLOAD_MB` por env (defecto conservador), validación de extensión,
  cuota y limpieza de huérfanos.
- **Riesgo:** bajar el límite rompe flujos actuales con películas largas. Avisar en UI.
- **Orden:** 5.

---

## ALTO

### A1. Doble backend Mongo/memoria duplicado — `services/room.service.ts` (~735 líneas)
- **Problema:** cada método tiene rama `isMongoConnected` / `inMemoryRooms`. Duplica
  lógica (join, roles, rename, kick, approval, settings, timer, delete) y diverge fácil
  (ej. `renameParticipant`/`kickParticipant` ya difieren en matices).
- **Solución:** patrón repositorio (interfaz `RoomStore` + `MongoRoomStore`/`MemoryRoomStore`),
  paso previo a la hexagonalización. Tests por contrato.
- **Riesgo:** refactor grande; hacerlo por método con tests de paridad.
- **Orden:** 6.

### A2. `deleteRoom`/`updateRoomVideo` con borrado físico acoplado — `room.service.ts:664,705`
- **Problema:** efectos en disco dentro del servicio de dominio, `removeOldVideoFile`
  síncrono (`unlinkSync`), `fs.existsSync/statSync` en `streamVideo` bloquean el loop.
- **Solución:** servicio de almacenamiento (`file.service`) async + cola de borrado +
  `fs/promises` y streams con manejo de errores.
- **Riesgo:** condiciones de carrera subiendo/borrando a la vez. Versionar por `fileName`.
- **Orden:** 7.

### A3. Estado efímero en memoria sin escalar — `room.socket.ts:15,24,37`
- **Problema:** `activeUsers`, `activeMediaStates`, `roomPlayback`, `roomPositions` solo
  viven en un proceso. Con 2 réplicas o reinicio se pierde presencia/playback/approval-sockets.
- **Solución:** documentar "una sola réplica" o externalizar (Redis adapter) cuando toque.
- **Riesgo:** introducir Redis prematuramente contradice la regla de no sobreingenierizar.
  De momento: documentar + `sticky` si hay LB.
- **Orden:** 8 (documentar ya, migrar solo si hay réplicas).

### A4. Validación de payloads socket mínima — `room.socket.ts` (todos los `.on`)
- **Problema:** `if (!roomId) return` como única guarda; `settings: any`, `offer: any`,
  `currentTime` sin rango, `emoji` sin longitud, `text` solo `trim()`. Basura o abuso
  llega a todos (`io.to().emit`).
- **Solución:** esquemas `zod`/`yup` por evento + clamp (`currentTime >= 0`, `emoji` 1–8 chars,
  `text` ≤ 500, `settings` con allowlist).
- **Riesgo:** validación estricta puede silenciar clientes viejos. Loguear rechazos.
- **Orden:** 9.

### A5. Errores y logs — `middleware/error.middleware.ts`, `app.ts`, `room.socket.ts`
- **Problema:** handler global devuelve `err.message` interno (fuga), multer no tiene
  manejo específico (4 GB → 500 genérico), `console.log/warn` por todas partes sin niveles.
- **Solución:** mapear multer/validación a 400/413 con mensajes ES, ocultar `message`
  interno en prod, logger con niveles + `requestId`.
- **Riesgo:** bajo si se mantiene formato `{ error }` que espera el frontend (`api.ts`).
- **Orden:** 10.

### A6. Frontend `Room.tsx` dios (~1224 líneas) — `frontend/src/pages/Room.tsx`
- **Problema:** orquesta sockets, WebRTC, chat, sync, aprobación, settings, modales,
  sonidos, notificaciones. Difícil de probar y de mover a `features/`.
- **Solución:** extraer hooks (`useRoomSocket`, `usePlaybackSync`, `useApproval`,
  `useModeration`, `useRoomSettings`) sin cambiar eventos; luego mover a features.
- **Riesgo:** regresiones de wiring (listeners `on/off`). Hacerlo por hook con checklist.
- **Orden:** 11 (en paralelo UI, después de C2 para no arrastrar permisos).

### A7. Tipos `any` y duplicados — `Room.tsx` (`video: any`, `settings: any`), `room.socket.ts`
- **Problema:** `noUnusedLocals` sí está activo pero no hay lint de `any`. Contratos
  socketREST se rompen en silencio (ej. `settings.timerEndsAt` string|null).
- **Solución:** tipos compartidos (`shared/types`) + `typescript-eslint no-explicit-any`,
  empezando por `room-state`, `sync-video`, `settings`.
- **Riesgo:** fricción inicial; hacerlo incremental.
- **Orden:** 12.

### A8. Doble sistema de toast — `services/notifications.tsx` vs `meet-toast` en `Room.tsx`
- **Problema:** ya registrado en pendientes §3: dos rutas de notificación coexisten.
- **Solución:** unificar en `notify()`/`confirmAction()` (regla: sin `alert/confirm`).
- **Riesgo:** perder callbacks de click (ver `handleChatMessage` con acción al clicar).
- **Orden:** 13.

---

## MEDIO

### M1. `sync-video` sin permiso ni throttle — `room.socket.ts:397`, `Room.tsx:843`
- **Problema:** cualquiera (no solo host/cohost) emite `play/pause/seek`; peleas de
  control + tormenta de eventos. El plan original pedía "solo host al principio".
- **Solución:** política `whoCanControl: 'host'|'cohost'|'all'` en `settings` (defecto
  según decida producto) + throttle/coalesce en `VideoPlayer` (ya hay `isApplyingRemote`
  300 ms; falta emisor).
- **Riesgo:** cambiar el defecto rompe la UX actual ("todos controlan"). Decidir producto.
- **Orden:** 14.

### M2. Consenso `resolveRoomTime` sin tests — `room.socket.ts:75`
- **Problema:** lógica sutil (ventana 3 s, mediana, seniority, TTL 12 s) sin un solo test.
  Regresión fácil al refactorizar.
- **Solución:** `vitest` con casos: mayoría, empate→senior, dispersos→senior, TTL expirado,
  `isPlaying` por mayoría, fallback `roomPlayback` con elapsed.
- **Riesgo:** ninguno; es el primer test a escribir.
- **Orden:** 0 (hacer antes de tocar sync).

### M3. Heartbeat sin backoff — `Room.tsx:950`
- **Problema:** emisión periódica fija por miembro; con N grande, carga O(N) en servidor.
- **Solución:** intervalo adaptativo + jitter + solo si hay cambios o cada X s.
- **Riesgo:** degradar precisión del consenso. Medir.
- **Orden:** 15.

### M4. Upload XHR sin abort/retry estructurado — `services/api.ts:72`
- **Problema:** `uploadVideo` con XHR manual, sin cancelación ni reintento; `upload-progress`
  socket separado sin reconciliación.
- **Solución:** `AbortController`, timeout, reintento con backoff, estados unificados.
- **Riesgo:** medio-bajo.
- **Orden:** 16.

### M5. HLS/Drive frágil ante cambios del proveedor — `room.controller.ts:19,79`, `app.ts:25,52`
- **Problema:** `probeExternalUrl` (Range 2 KB, heurística HTML), `extractDriveDownloadUrl`
  (parseo de formulario), `toDriveExplicitRange` (chunks 4 MB) dependen de HTML de Google.
- **Solución:** tests de `probe`/`extract`/reescritor + mensajes ya buenos en ES + fallback claro.
- **Riesgo:** Google cambia el formulario y se rompe Drive. Monitorizar.
- **Orden:** 17.

### M6. MediaStates con doble clave — `room.socket.ts:383`, `useWebRTC.ts:68`
- **Problema:** se guarda por `socketId` y por `nombre minúsculas`; `rename-participant`
  re-mapea pero hay ventana de inconsistencia; colisión si dos usuarios comparten nombre.
- **Solución:** clave única `userId` (ya existe en participantes) en vez de nombre.
- **Riesgo:** clientes legacy sin `userId`. Migración gradual (ya hay fallback por nombre).
- **Orden:** 18.

### M7. Timer de sala con granularidad 15 s — `room.socket.ts:829`
- **Problema:** barrido cada 15 s: el cierre puede llegar 15 s tarde; `timerEndsAt` en
  `settings` tipado `any`/string sin validación de rango (pendientes pedían ≤7 días ISO).
- **Solución:** validar rango en `update-room-settings` + `setTimeout` por sala además
  del sweep (respaldo).
- **Riesgo:** timers en memoria se pierden al reiniciar (ver A3). El sweep persiste; el
  timeout no. Mantener ambos.
- **Orden:** 19.

### M8. `streamVideo` síncrono y sin `If-Range` — `room.controller.ts:359`
- **Problema:** `existsSync/statSync`, sin `If-Range`/`ETag`, `Cache-Control: max-age=3600`
  fijo, 404 JSON vs stream mezclados.
- **Solución:** `fs/promises`, `ETag`+`Last-Modified`, rangosSuffix, errores homogéneos.
- **Riesgo:** bajo.
- **Orden:** 20.

### M9. Erratas y textos — `room.model.ts:73` default `'Afitrión'`, logs `'Affitrión'`
- **Problema:** `kickedBy` por defecto con typo; logs con typo. Cosmetico pero visible.
- **Solución:** `'Anfitrión'` + constante compartida.
- **Riesgo:** migración de datos existentes con el typo (normalizar al leer).
- **Orden:** 21.

### M10. Bundle y code-splitting — `Instrucciones_Pendientes.md §3` (~898 kB)
- **Problema:** `hls.js` + `socket.io` en el chunk principal, sin `React.lazy` ni `manualChunks`.
- **Solución:** `manualChunks` (vendor/hls/socket), `lazy(Home/Room)`, analizar con `rollup-plugin-visualizer`.
- **Riesgo:** romper HLS dinámico si se parte mal. Probar `.m3u8` tras el split.
- **Orden:** 22.

---

## BAJO

### B1. Sin ESLint/tests — ambos `package.json` sin scripts `lint`/`test`
- **Solución:** `eslint + typescript-eslint + react-hooks` y `vitest` mínimo
  (M2 + puerta de aprobación + `WaitingApproval`).
- **Orden:** 23 (pero M2 ya).

### B2. Timestamps de chat como string `HH:MM` — `room.socket.ts:483`
- **Problema:** sin fecha/zona; orden y "hora" del mensaje relativo ya se calculan en Home.
- **Solución:** ISO + formato en cliente.
- **Riesgo:** cambiar formato rompe `Chat.tsx`. Versionar.

### B3. `disconnect`/`leave` duplican transferencia de host — `room.socket.ts:294,767`
- **Problema:** dos caminos casi idénticos (`removeParticipantAndTransferHost` + `host-changed`).
- **Solución:** función común `handleDeparture()`.

### B4. `roomId` upper/trim repetido en cada handler
- **Solución:** helper `cleanRoomId()` + middleware de normalización.

### B5. Constantes mágicas dispersas
- `CLUSTER_TOLERANCE_SEC=3`, `POSITION_TTL_MS=12s`, chunk 3 MB, Drive chunk 4 MB,
  probe 12 s/2 KB, proxy 20 s/5 redirects, `isApplyingRemote` 300 ms, diff 0.5 s.
- **Solución:** `config/constants.ts` por lado + documentar en la guía.

### B6. Donaciones/legales ya resueltos, no tocar
- `VITE_PATREON_URL/PAYPAL_URL`, lenguaje "archivo multimedia/sesión" (pendientes #13–14).
  Solo mantener la convención.

---

## Orden de ejecución sugerido

```text
0. M2 tests de resolveRoomTime (red de seguridad, sin riesgo)
1-5. C1 proxy SSRF → C2 auth host → C3 CORS → C4 rate-limit → C5 subida/cuota
6-10. A1 repositorio dual → A2 file.service → A3 documentar 1 réplica → A4 validación zod → A5 errores/logger
11-13. A6 descomponer Room.tsx → A7 tipos compartidos + lint → A8 unificar toasts
14+. M1 política de control → M3 heartbeat → M4 upload abort → M5 tests HLS/Drive → M6 userId único
     → M7 timer preciso → M8 stream ETag → M9 typos → M10 bundle → B1-B5 pulido
```

Reglas durante el refactor (de `Instrucciones_Pendientes.md §Reglas`):
build verde (`frontend npm run build`, `backend npx tsc --noEmit`), sin `alert/confirm`,
`noUnusedLocals` limpio, UI en español, y mover cada tarea cerrada a "Hecho con fecha".

---

## Preguntas abiertas (para el dueño del producto)

1. ¿Quién puede controlar play/pause/seek por defecto: todos, solo host, host+cohost? (M1)
2. ¿Límite de subida y de participantes visible en UI? (C5; pendientes pedía mostrarlo)
3. ¿Orígenes CORS permitidos en prod + cuántas réplicas del backend? (C3, A3)
4. ¿Política de salas no-temporales: conservar video hasta DELETE explícito? (ya implementado,
   confirmar que es lo deseado)
5. ¿Host puede desactivar reacciones? (pendientes §3 lo propone: `disable-reactions`)

---

## Resuelto 2026-10-04 (auditor�a 3 subagentes + integraci�n)

- QA fij� baseline: backend 117 tests, frontend 63 tests; nuevos witnesses it.fails para B1/B2.
- Corregido: join-room ya NO conf�a en el flag isHost del cliente (solo nombre registrado o participante persistido).
- Corregido B1: send-message/send-reaction descartan payload undefined/no-string sin lanzar.
- Corregido B2: relay webrtc-* exige 	argetSocketId string no vac�o.
- Corregido B3: SyncPlaybackUseCase devuelve 
ull con acci�n inv�lida o tiempo no finito/negativo; el handler no emite ni envenena el snapshot.
- Corregido SocketEventBus.broadcastExcept (ahora s� excluye) + comentario stale en ports/event-bus.ts.
- Tests it.fails convertidos en asserts normales + test nuevo de entradas inv�lidas de sync.
- Backend: 12 ficheros, 151/151 tests en verde; 	sc limpio en ambos paquetes.
- Pendiente con decisi�n del due�o: playback solo-host (pregunta abierta 1), EventBus cablear vs eliminar, Button.tsx sin uso, ESLint, jsdom/TL, XHR-mock, Example.png 2.84 MB.


- 2026-10-04 (2): ESLint 9 + `npm run lint` en ambos paquetes (0 errores); `useRoomSocket` cubierto con 8 tests renderHook+socket mock (contrato pineado); `catch (_)` -> `catch`; warnings restantes = `any` legacy aceptados.

- 2026-10-04 (3): CORS allowlist (`CLIENT_URL` + dev) cableada en Express y Socket.IO; rate-limit REST (global/join/delete) + throttle socket (chat/reacciones/heartbeat) con dedup <500ms; `getIsMongoConnected()` en todos los usos; anónimos sin userId frente a nombre registrado -> name-taken/409; `EventBus` y `Button.tsx` eliminados (0 refs verificadas); jsdom acotado por pragma + setup jest-dom; XHR `uploadVideo` con 7 tests; `useRoomSocket` con 13 tests. Backend 176/176, frontend 94/94.

