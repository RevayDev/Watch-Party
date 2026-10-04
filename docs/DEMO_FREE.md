# Watch Party — DEMO GRATUITA (`demo-free`)

Demo controlada, privada y recuperable. No reescribe el proyecto: todo lo desactivado vive tras flags (`DEMO_MODE` backend, `VITE_DEMO_MODE` frontend; con `false` vuelve el comportamiento completo).

## 1. Arquitectura (igual que producción + límites)

Frontend (Vercel) → REST + Socket.IO → Backend (Render, 1 instancia) → MongoDB Atlas Free o memoria. WebRTC P2P entre miembros. Playback: acciones de todos + heartbeat 5s y consenso para recién llegados (ver `PROJECT_LEARNING_GUIDE.md`).

## 2. Límites configurados

| Límite | Valor | Dónde se valida |
|---|---|---|
| Salas globales | 5 | `RoomService.createRoom` (mutex + `DemoCapacityError` → REST 429) |
| Usuarios por sala | 10 (`participants`, incluye host; espera no consume) | `join` REST 429 + `join-room`/`approve-join` socket |
| Upload de archivo | Deshabilitado (403 antes de multer) | `demoUploadGuard` + respaldo en controlador |
| Salas | Siempre temporales; la vacía se borra (libera cupo) | servicio + settings forzado |
| Timer | 1–480 min, `timerEndsAt` de servidor, `null` desactiva | `sanitizeRoomSettings` |

Mensajes exactos: `"La demo ha alcanzado el límite de 5 salas. Intenta nuevamente más tarde."`, `"Esta sala está llena."`, `"La subida de archivos está deshabilitada en la demo. Usa un enlace de video (por ejemplo, Google Drive) en su lugar."`

Disponibilidad: `GET /api/demo/availability` → `{roomsUsed, roomsTotal: 5, roomsAvailable}` (solo conteos).

## 3. Crear sala / entrar con código

Igual que producción: crear (siempre temporal en demo) o pegar código de 6 caracteres. Home muestra "DEMO GRATUITA" + "X de 5 salas en uso / Y disponibles". Sin código no se entra (404); no existe listado de salas.

## 4. Por qué Drive y no Render

Render Free tiene disco efímero y poco ancho de banda: guardar vídeos ahí se pierde al reiniciar y consume la cuota. La demo reproduce por **enlace de Google Drive** (`video-url` → descarga directa; proxy intacto como respaldo). El reproductor, sync y consenso no cambian de proveedor: solo cambia de dónde sale la URL.

## 5. Sala llena / liberación

Llena (10/10): el 11º recibe "Esta sala está llena." (REST 429 o `join-rejected room-full`) y su socket no entra al canal. Al salir/desconectar (tras la gracia de 20s) o cerrar, el cupo se libera; sala vacía se borra y libera cupo global (verificable en `availability`).

## 6. Limitaciones de Drive y de la demo

- Links con cuota de descarga de Google pueden fallar (error 403 de Google): reintentar o regenerar el enlace.
- Reinicios de Render: se pierden consenso, snapshots, gracias y rate-limits en memoria; las salas en Mongo sobreviven, en memoria no.
- Cuotas válidas para **1 instancia**; con N réplicas haría falta contador distribuido.
- 50 usuarios reales con WebRTC/red: ESTIMADO (medido solo en memoria: setup 5×10 en ~1–2 ms). Recomendado: k6/Artillery en staging.

## 7. Volver a `backup`

```bash
git checkout backup   # código original intacto (SHA idéntico al crearla)
```

## 8. Cambiar de proveedor de vídeo

Solo hay que cambiar cómo se obtiene `directUrl` en `setVideoUrl`/reproductor (hoy Drive → `drive.usercontent…` o proxy `/api/proxy`). Contratos intactos: `IVideoMetadata`, `video-changed`, consenso y sync no dependen del origen.
