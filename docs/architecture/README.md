# docs/architecture — README

Mapa arquitectónico de **Watch-Party**, generado por el subagente arquitecto
**solo con lectura de código** (análisis de `import`/`from` con búsqueda de
texto, sin instalar dependencias, sin `madge`/`dependency-cruiser` disponibles
en el entorno — no hay `rg` ni `git` en el PATH del shell).

## Archivos

| Archivo | Contenido |
|---|---|
| `ARCHITECTURE.md` | Arquitectura actual verificada + diagramas Mermaid. Solo conexiones comprobadas en código; el resto marcado como ⏳ pendiente. |
| `SOCKET_EVENTS.md` | Tabla completa evento / emisor / receptor / datos / validación / auth / limpieza + duplicados e inconsistencias. |
| `SEQUENCES.md` | 8 flujos: crear sala, unirse, approval, reconexión, chat, sync video, moderación, persistencia. |
| `IMPACT_MAP.md` | Módulos centrales y qué se rompería al tocarlos. |
| `README.md` | Este archivo. |

## Cómo leer

1. Empezar por `ARCHITECTURE.md` (visión estática: quién importa a quién).
2. Seguir por `SOCKET_EVENTS.md` (contrato real cliente↔servidor).
3. Usar `SEQUENCES.md` para entender flujos temporales.
4. Consultar `IMPACT_MAP.md` antes de cualquier refactor.

## Cómo actualizar (solo lectura de código, sin herramientas de grafo)

1. Buscar imports nuevos: patrones `from '../`, `from '../../`, `from './`
   en `backend/src` y `frontend/src`.
2. Verificar cada arista listada en `ARCHITECTURE.md §2`; si un import
   desaparece, eliminar la arista del Mermaid.
3. Para eventos socket: los emisores están en
   `backend/src/sockets/handlers/*.ts` (`.on` = inbound, `.emit`/`io.to().emit`
   = outbound) y en `frontend/src/features/room/hooks/useRoomSocket.ts`,
   `frontend/src/hooks/useWebRTC.ts`, `Room.tsx`, `RoomDrawer.tsx`.
   Toda fila de `SOCKET_EVENTS.md` debe citar el archivo:línea aproximado.
4. Regla: **nada que no esté verificado en código entra al diagrama sin la
   marca ⏳ pendiente**.
5. Métricas: recontar con conteo de líneas por archivo y `Get-ChildItem`
   sobre `frontend/dist` y `backend/dist` (artefactos ya construidos;
   no reconstruir salvo que sea rápido y seguro).

## Estado de verificación

- ✅ Grafo de imports backend y frontend (búsqueda de `from '…'` en todo `src`).
- ✅ Los 6 handlers socket leídos íntegramente + `room.socket.ts`,
  `socket-auth.ts`, `socket-state.ts`, `disconnect-grace.ts`.
- ✅ Dominio (`auth/room/playback/settings-policy`), `application/*`,
  `RoomService`, `room.controller.ts`, routing + memory adapters leídos íntegros.
- ✅ `useRoomSocket.ts` (912 líneas), `useWebRTC.ts` (cabecera + emits),
  `Room.tsx`, `socket.ts`, `api.ts`, `shared/utils.ts`, `App.tsx` leídos.
- ⏳ No verificado: `mongo-room.repository.ts` (solo imports), `proxy.service.ts`
  (solo LOC), `VideoPlayer.tsx` interior (solo grep de sync), `RoomDrawer.tsx`
  interior (solo grep de emits), `vite.config.ts`/`vercel.json`, `data/rooms.json`.
