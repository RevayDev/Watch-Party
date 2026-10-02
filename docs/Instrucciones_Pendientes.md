# Instrucciones y pendientes — Watch Party

> **Sección nueva.** Documento de trabajo para la IA/desarrollador: qué se hizo, qué queda por
> mejorar, reparar y agregar. Actualizar este archivo cada vez que se cierre una tarea
> (moverla a "Hecho" con fecha).

Última actualización: 02/10/2026

---

## 1. Recién terminado (02/10/2026)

| # | Tarea | Archivos |
|---|-------|----------|
| 1 | La barra superior del reproductor (filename + "Cambiar") **se auto-oculta a los 2.5s** de inactividad, no solo en fullscreen; reaparece con mouse/touch y permanece visible si el panel "Cambiar" está abierto | `frontend/src/components/VideoPlayer.tsx` |
| 2 | **Botón flotante "Cambiar" solo en móvil** (`player-change-fab`) que abre el popup de cambiar video; en móvil el botón de la topbar queda oculto para no duplicar | `VideoPlayer.tsx`, `frontend/src/index.css` |
| 3 | **UI móvil de Participantes reparada**: header/tabs compactas con scroll horizontal (sin recortar etiquetas), filas más apretadas (avatar 32px, botones 30px), footer a una columna, ficha de detalle full-screen con header sticky y safe-area, variantes ≤480px | `frontend/src/index.css` |
| 4 | **Reacciones suavizadas y recolocadas**: overlay centrado (`left: 50%`) estilo YouTube, keyframes nuevos con pop-in, balanceo horizontal suave y fade largo (3s); respeta `prefers-reduced-motion` | `frontend/src/index.css` |
| 5 | **Header unificado**: se eliminó el pill "Host" (redundante); código de sala + link ahora viven en **un solo botón "Compartir"** con menú desplegable que muestra ambos con su botón de copiar y toast de confirmación | `frontend/src/components/RoomHeader.tsx`, `frontend/src/index.css` |
| 6 | **FAB "Cambiar" móvil reparado**: ahora es idéntico al botón de la topbar (misma píldora translúcida, tipografía y padding) y está en la fila del título (top 0.65rem / right 0.85rem); la topbar reserva 5.75rem a la derecha para no pisar el pill de "volumen duck" del micrófono | `frontend/src/index.css` |
| 7 | **Bottom sheet del modal "Cambiar video" en móvil** (≤768px): sube desde abajo estilo "menú de teléfono" con handle, safe-area y slide-up (`sheetSlideUp`). El menú "⋯" **se dejó como estaba** (dropdown sobre el botón, sin backdrop), a petición del usuario | `frontend/src/index.css` |
| 8 | **Empty-state del picker (sala sin video) como bottom sheet en móvil** (≤768px): se abre solo con handle, X y backdrop igual que "Cambiar video"; al cerrarlo queda la píldora "Subir video o pegar enlace" en el placeholder para reabrirlo. En escritorio sigue siendo la tarjeta inline de siempre (estado `showEmptyPicker` solo aplica en móvil) | `frontend/src/components/VideoPlayer.tsx`, `frontend/src/index.css` |
| 9 | **Gesto "deslizar hacia abajo" para cerrar sheets en móvil** (hook nuevo `useSwipeDown`, solo touch, arranca solo cuando el contenido está scrolleado arriba): drawer de Chat/Participantes, bottom sheets de "Cambiar video" y picker vacío, modal Ajustes de sala, modal Salida del anfitrión y modales Crear/Unirse del Home | `frontend/src/hooks/useSwipeDown.ts`, `Room.tsx`, `VideoPlayer.tsx`, `RoomSettingsModal.tsx`, `HostExitModal.tsx`, `Home.tsx` |
| 10 | **Temporizador de cierre automático de sala**: el host elige duración en Ajustes (`timerMinutes`/`timerEndsAt` en `settings`); el backend valida el rango (≤7 días, ISO) y barre las salas vencidas cada 15s → emite `room-closed` (reason `timer`) y la sala se borra; en la sala aparece toast de confirmación | `types/room.ts`, `types/room.types.ts`, `RoomSettingsModal.tsx`, `Room.tsx`, `backend/.../room.service.ts`, `backend/.../room.socket.ts` |
| 11 | **Fixes de tipos/build**: `useSwipeDown` devuelve `RefObject<T>`, `RoomHeader` sin prop sin usar, casts de `settings` en `Room.tsx`, ref del drawer tipado `HTMLElement` | varios |
| 12 | **Tarjeta "Salas recientes" rediseñada y sin emojis**: se quitaron 🕐 / 👑 / 👤 (badge de texto `Anfitrión`/`Invitado` con colores ámbar/gris), avatar circular con la inicial del anfitrión, hora relativa ("hace 5 min"), header con separador y título en mayúsculas, filas con hover elevado, botón "Quitar" ahora es un icono `×` con `aria-label`, scrollbar fino de la lista y variante ≤480px | `frontend/src/pages/Home.tsx`, `frontend/src/index.css` |
| 13 | **Home renovado**: (a) iconos de `lucide-react` en features, highlights, FAQ (`Plus`/`Minus`), badges de rol (`Crown`/`User`) y título de recientes (`History`); (b) rejilla de features pasó de 6 a 8 tarjetas reflejando las funciones nuevas (aprobación de entrada, salas temporales/persistentes, control del anfitrión + temporizador); (c) **lenguaje legal**: se eliminó "película/cine/función" de Home, `VideoPlayer` y `RoomSettingsModal` → ahora "archivo(s) multimedia"/"video"/"sesión"; (d) **sección de donaciones** (`#donaciones`) con botón de Patreon y enlace en el footer, condicionado a `VITE_PATREON_URL` | `Home.tsx`, `index.css`, `VideoPlayer.tsx`, `RoomSettingsModal.tsx`, `frontend/.env.example` |
| 14 | **Home: navegación, secciones nuevas y footer**: (a) **nav sticky** tipo píldora con logo, enlaces internos (Funciones / Cómo funciona / Tecnologías / Lo que viene / Donaciones / FAQ) y CTAs "Unirse" y "Crear sala" (los enlaces se ocultan ≤1080px); (b) sección **Tecnologías** (`#tecnologias`, 9 tarjetas: React, TS, Vite, Express, Socket.IO, WebRTC, MongoDB, hls.js, Multer); (c) sección **Roadmap "Lo que viene"** (`#roadmap`, 5 ítems con badge Planeado/En estudio); (d) **Donaciones rediseñada**: 3 tarjetas independientes — Patreon (`VITE_PATREON_URL`), PayPal (`VITE_PAYPAL_URL`) y "Lo que queremos construir" (ancla a `#roadmap`); si la URL está vacía la tarjeta queda "Próximamente" sin clic; (e) **footer de 4 columnas** (marca + redes/donaciones, Producto, Comunidad, Acceso rápido) con barra inferior legal: "Watch Party no provee contenido…" | `frontend/src/pages/Home.tsx`, `frontend/src/index.css`, `frontend/.env.example` |
| 15 | **"Salas recientes" fija bajo la imagen + estado vacío**: la tarjeta se movió de la columna izquierda a la **derecha, debajo del showcase** (`Home.tsx`), siempre visible; sin historial muestra "No hay salas recientes / Crea una sala o únete con un código…"; **sin animaciones** en esa tarjeta (se quitaron `transition`, `translateY` de hover, botón Entrar y Quitar); **altura fija del cuerpo** con la variable `--recent-body-h: 200px` (lista y estado vacío ocupan exactamente lo mismo, la lista hace scroll) y **sin gradientes** en la tarjeta, avatar ni botón (colores planos) | `frontend/src/pages/Home.tsx`, `frontend/src/index.css` |
| 16 | **Roadmap en tabla + línea de tiempo + sin gradientes en botones**: (a) "Lo que viene" ahora es una **tabla** (Función / Estado / Descripción) con scroll horizontal ≤640px; (b) nueva sección **"Línea de tiempo"** (`#timeline`) vertical con 5 hitos y badges `Completado`/`En curso`, enlazada desde el footer; (c) **botones sin degradado**: `btn--primary`, `btn--accent`, `home-nav__btn--primary` y `home-reconnect-card__enter-btn` ahora color plano; (d) el hero usa `align-items: start` (texto subido a la parte superior); (e) nota en Donaciones: "A futuro se agregarán planes de apoyo…"; (f) **`frontend/.env` creado** con `VITE_PATREON_URL=` y `VITE_PAYPAL_URL=` (rellenar para activar las tarjetas) | `frontend/src/pages/Home.tsx`, `frontend/src/index.css`, `frontend/.env` |
| 17 | **Hero reordenado + línea de tiempo invertida**: (a) la tarjeta **"Salas recientes" sale de la columna derecha y va a ancho completo debajo del texto y de la imagen** (fin del `.home-hero-grid`, `margin-top: 2rem`); (b) se **eliminó la píldora "VÍDEOS • MULTIMEDIA • EN TIEMPO REAL"** (`.home-hero-badge`); (c) la **línea de tiempo va de lo más reciente a lo más antiguo** ("Ahora" arriba) y los hitos completados quedan con `opacity: 0.5` (`.home-timeline__item--past`) mientras `--now` se mantiene al 100% con título y fecha destacados | `frontend/src/pages/Home.tsx`, `frontend/src/index.css` |

**Dónde va el link de Patreon / PayPal:** variables `VITE_PATREON_URL` y `VITE_PAYPAL_URL` en `frontend/.env` (ver `frontend/.env.example`). Vacías ⇒ tarjeta "Próximamente". Alternativa: editar las constantes `PATREON_URL` / `PAYPAL_URL` al inicio de `frontend/src/pages/Home.tsx`.

Verificado: `npm run build` (tsc + vite) OK y `npx tsc --noEmit` en backend OK. E2E del temporizador OK (crear sala → join host → timer +3s → `room-closed` con `reason: "timer"`).

---

## 2. Pendiente alto — reparar / verificar

- [ ] **Probar en dispositivo real los cambios de esta ronda**: auto-ocultado de la topbar en
      touch, FAB "Cambiar" en móvil (alineado con la topbar; ¿no tapa los controles nativos
      del video ni el pill de volumen?), menú "Compartir" en pantallas pequeñas, panel de
      Participantes en un teléfono real, **bottom sheet del modal "Cambiar video"** y
      **bottom sheet del picker vacío (sala sin video)** (≤768px), incluido el botón de
      reabrir tras cerrarlo. El menú "⋯" queda como dropdown original.
- [ ] **Gesto `useSwipeDown` en dispositivo real**: cerrar el drawer de Chat/Participantes,
      los bottom sheets, Ajustes y Salida del anfitrión deslizando hacia abajo; verificar
      que no se dispare al hacer scroll normal ni con el ratón.
- [ ] **Temporizador de cierre automático en dispositivo real**: elegir duración en
      Ajustes, esperar el cierre (la barra del backend corre cada 15s) y comprobar el
      toast `room-closed` en todos los clientes.
- [ ] **Reacciones**: confirmar que en fullscreen también se ven centradas (el overlay está
      dentro de `player-container`); si el video es muy bajo, el overlay puede quedar sobre
      los controles nativos — ajustar `bottom` si hace falta.
- [ ] **Participantes en tablet (601–900px)**: el drawer `--wide` de 720px + layout en columna
      aún no se ha revisado en ese rango.
- [ ] **Backup del pill "Host" en el header**: si se necesita indicador de anfitrión, mejor
      ubicación = junto al avatar en la lista de participantes (ya existe `part-badge-host`)
      o en el menú "⋯"; **no** volver a ponerlo en el header.

## 3. Pendiente medio — mejorar

- [ ] **Header en móvil ≤600px**: el label "Compartir" se oculta (solo icono). Verificar que
      el menú se abra apuntando bien (actualmente `right: 0`; en pantalla angosta podría
      necesitar centrarse o anclarse a la izquierda).
- [ ] **Bundle size**: JS ~898 kB (warning de Vite). Acciones sugeridas: `manualChunks`
      (separar `hls.js` y `socket.io`), `React.lazy` para `Home`/`Room`.
- [ ] **Lint**: no hay ESLint configurado. Agregar `eslint` + `typescript-eslint` +
      `eslint-plugin-react-hooks` y script `"lint"` en ambos `package.json`.
- [ ] **Tests**: no existen. Mínimo viable: `vitest` para la lógica del backend
      (room.controller, aprobación de entrada) y componentes UI críticos
      (`WaitingApproval`, `notifications`).
- [ ] **Notificaciones**: unificar los dos sistemas de toast que coexisten
      (`NotificationProvider` de `services/notifications.tsx` y los `meet-toast` de
      `Room.tsx`). Queda uno solo.
- [ ] **Permisos de media en la pantalla de espera**: si el usuario cancela con la cámara
      encendida, asegurar que `WaitingApproval` libere el stream (`track.stop()`) al
      desmontarse (revisar que el cleanup exista).
- [ ] **Reacciones – moderación**: ¿el host debe poder desactivar reacciones en la sala?
      (evento nuevo `disable-reactions` + toggle en "Restricciones" del panel Participantes).

## 4. Pendiente bajo — agregar (features)

- [ ] **Teclado**: atajos (M = mic, C = cámara, R = reacciones, Esc = cerrar drawer).
- [ ] **Chat**: mensajes con hora, contador de no leídos ya existe — falta scroll
      automático al final y "escribiendo…".
- [ ] **Anfitrión**: promover/co-host desde la ficha de detalle (el prop `onToggleCoHost`
      ya está cableado en `Room.tsx` pero **no tiene botón** en `Participants.tsx`).
- [ ] **Sala persistente**: lista "Mis salas guardadas" en el Home.
- [ ] **Capacidad**: límite de participantes visible para el host (hay límite en backend,
      falta mostrarlo en la UI).
- [ ] **Donaciones**: configurar `VITE_PATREON_URL` en `frontend/.env` (producción) y valorar
      añadir más métodos (PayPal, Buymeacoffee) — el array `donationLinks` de `Home.tsx`
      admite nuevas entradas sin tocar el JSX.

## 5. Backend / seguridad — pendiente

- [ ] **Rate limiting**: no está instalado (`express-rate-limit`). Aplicar a
      `POST /api/rooms` y `POST /upload`.
- [ ] **Límite de subida**: actualmente 4 GB (`upload.middleware.ts`). Dejar configurable
      por variable de entorno (`MAX_UPLOAD_MB`).
- [ ] **Tests de la puerta de aprobación**: cubrir el fix de `join` (no añadir participante
      si `requireApproval`) con tests de integración.
- [ ] **Validación de join requests**: expiración de solicitudes pendientes más allá del
      cleanup por `disconnect` (p. ej. TTL de 10 min).

---

## Reglas rápidas para quien continúe

1. **Build siempre verde**: ejecutar `npm run build` en `frontend/` y
   `npx tsc --noEmit` en `backend/` después de cada cambio.
2. **Sin `alert()`/`confirm()`**: usar `notify()` y `confirmAction()` de
   `frontend/src/services/notifications.tsx`.
3. **`noUnusedLocals` activo**: cualquier import o prop sin usar rompe el build.
4. **UI en español**; respuestas al usuario en español.
5. Al terminar una tarea de este documento: moverla a la sección 1 con fecha.
