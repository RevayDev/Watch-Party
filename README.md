# 🎬 Watch Party

Mira videos **sincronizados** con amigos en tiempo real: todos ven lo mismo al mismo tiempo, con chat, reacciones, voz y cámaras. Sin compartir pantalla: cada navegador reproduce su propia copia del video y el servidor los mantiene sincronizados.

> **Si eres junior y es tu primera vez aquí:** lee en orden: §1 (qué es) → §2 (pruébalo en 2 min) → §3 (cómo funciona, con dibujo) → §4 (dónde está cada cosa) → §5 (arquitectura hexagonal explicada simple). Con eso puedes escalar el proyecto.

---

## 1. Qué es (en 30 segundos)

- **Salas con código de 6 letras** (ej. `KX7Q2P`). El anfitrión crea, comparte el código o el link `?room=KX7Q2P`, los demás se unen con su nombre.
- **Video sincronizado:** play, pausa y saltos los ve todo el mundo igual (tolerancia de 2 s + compensación de latencia).
- **Tiempo real:** chat, reacciones flotantes ✨, "está escribiendo…", voz y video por WebRTC (P2P, sin pasar por el servidor).
- **Anfitrión manda:** aprueba entradas, silencia/apaga cámaras, expulsa, pone nombre y temporizador a la sala.
- **Demo gratuita:** 5 salas vivas, 5 personas por sala, videos por enlace (Drive/HLS). Sin registros ni pagos.

---

## 2. Pruébalo en 2 minutos (local)

Requisitos: **Node.js 18+**. MongoDB es opcional (sin él, las salas viven en memoria).

```bash
# Instalar (una vez): raíz + backend + frontend
npm install
npm --prefix backend install
npm --prefix frontend install

# UNA sola terminal: backend + frontend juntos,
# logs etiquetados [backend] / [frontend]
npm run dev
```
Backend en `http://localhost:4000`, frontend en `http://localhost:5173`.
(Ctrl+C apaga los dos. Si prefieres dos terminales: `npm run dev:backend` y `npm run dev:frontend`.)

1. Abre `http://localhost:5173`, crea una sala con tu nombre.
2. Copia el código, abre otra ventana en incógnito, únete con otro nombre.
3. Pega un enlace de video (Drive o `.m3u8`) y dale play: ambas ventanas van juntas.

Variables útiles (ver `backend/.env.example` y `frontend/.env.example`):

| Variable | Dónde | Para qué |
|---|---|---|
| `MONGODB_URI` | backend | Si no se pone, usa memoria (se pierde al reiniciar) |
| `CLIENT_URL` | backend | URL del frontend (CORS) |
| `VITE_API_URL` | frontend | URL del backend (en local se deja vacía) |
| `VITE_DEMO_MODE` | frontend | `false` restaura subida de archivos y quita límites demo |
| `ROOM_STORE` | backend | `auto` (Mongoose/memoria) o `prisma` (Prisma ORM, misma Mongo; antes corre `npm run db:push` una vez para crear el índice único) |
| `DATABASE_URL` | backend | Solo para Prisma; si no está, usa `MONGODB_URI` |

---

## 3. Cómo funciona (el flujo completo)

```text
CREAR                                    UNIRSE                                  VER JUNTOS
┌──────┐  POST /api/rooms   ┌─────────┐  POST /api/rooms/:id/join  ┌─────────┐  Socket.IO + REST
│ Home │ ─────────────────► │ Backend │ ────────────────────────► │  Sala   │ ─────────────────►
│      │ ◄───────────────── │ crea    │ ◄──────────────────────── │         │ ◄─────────────────
└──────┘  { roomId,          └─────────┘  { room, video,            └─────────┘  play/pausa/seek,
           hostSecret }                   participantes }                      chat, reacciones,
                                                                               voz/cámaras (WebRTC)
```

1. **Crear:** `Home.tsx` → `ApiService.createRoom()` → el backend genera código + `hostSecret` (contraseña del anfitrión, se guarda en el navegador).
2. **Unirse:** con código + nombre → `joinRoom()` → socket `join-room` → el servidor manda `room-state` (video, participantes, ajustes, posición actual).
3. **Ver juntos:** el reproductor emite `sync-video` (play/pausa/seek) y `playback-heartbeat` (posición cada 2.5 s). Los demás aplican el cambio con compensación de latencia. Si alguien llega tarde, el servidor le dice en qué segundo ponerse (consenso).
4. **Si se cae internet:** gracia de 20 s + re-join automático; el video local NO se corta, solo sale "Reconectando…".

---

## 4. Dónde está cada cosa (estructura real)

```text
Watch Party/
├── backend/                  # Node + Express + Socket.IO + TypeScript
│   └── src/
│       ├── domain/           # 🧠 Reglas PURAS (sin Express/Mongo: auth, settings, playback)
│       ├── ports/            # 🔌 Interfaces (ej. RoomRepository: "qué necesito guardar")
│       ├── application/      # 📋 Casos de uso (approve-join, sync-playback, moderate-user)
│       ├── adapters/         # 🔧 Implementaciones (Mongo, memoria, Prisma, routing)
│       ├── routes/           # 🛣️ Endpoints REST (rooms, demo, proxy, docs)
│       ├── controllers/      # 🎮 Traducen HTTP ↔ casos de uso/servicios
│       ├── sockets/          # ⚡ Tiempo real (handlers: join, sync, chat, moderation…)
│       ├── services/         # RoomService (lógica de salas) + proxy + metrics
│       ├── models/           # Esquema Mongoose de sala
│       ├── middleware/       # upload (multer), rate-limit, errores
│       ├── config/           # CORS, base de datos, demo-mode
│       ├── app.ts            # Crea el servidor Express (rutas + middlewares)
│       └── server.ts         # Arranca HTTP + Socket.IO
│
├── frontend/                 # React + Vite + TypeScript (organizado por features)
│   └── src/
│       ├── features/         # room/ player/ chat/ participants/ waiting/ home/
│       ├── components/       # Header, cámaras, reacciones, modales (reusables)
│       ├── hooks/            # useWebRTC (voz/video P2P), usePresence
│       ├── services/         # api.ts (REST), socket.ts, notificaciones
│       ├── shared/           # utils, constants, demo, BottomSheet, hooks
│       ├── App.tsx           # Vistas: home ↔ room (sin router)
│       └── index.css         # Diseño propio BEM (sin Tailwind)
│
└── docs/
    ├── PROJECT_LEARNING_GUIDE.md  # 📖 Guía profunda del código actual
    └── architecture/              # 🗺️ Diagramas, eventos socket, guía hexagonal
```

---

## 5. Arquitectura hexagonal (explicada para aprenderla)

La idea en una frase: **la lógica del negocio no conoce Express, Mongo ni Socket.IO.** Habla con el mundo exterior solo a través de interfaces (puertos). Así puedes cambiar la base de datos o el framework sin reescribir las reglas.

```text
        ┌──────────────────────────────────────────────┐
        │  ADAPTADORES (lo que se puede cambiar)        │
        │  Express · Mongoose · memoria · Socket.IO     │
        └───────────────┬──────────────────────────────┘
                        │ usan (implementan interfaces)
        ┌───────────────▼──────────────────────────────┐
        │  APPLICATION (casos de uso: QUÉ hace la app)  │
        │  approve-join · sync-playback · moderate-user │
        └───────────────┬──────────────────────────────┘
                        │ usan
        ┌───────────────▼──────────────────────────────┐
        │  DOMAIN (reglas PURAS: no importan nada       │
        │  de fuera) auth · settings · playback · room  │
        └──────────────────────────────────────────────┘
  Regla de oro: las flechas solo apuntan HACIA ADENTRO.
```

**Cómo se ve en este repo hoy:**

| Capa | Carpeta | Ejemplo real |
|---|---|---|
| Domain | `backend/src/domain/` | `playback-policy.ts`: decide si un salto de video se aplica (puro, testeable sin servidor) |
| Ports | `backend/src/ports/` | `room.repository.ts`: interfaz `findById/save/count` (promesa, sin Mongo) |
| Application | `backend/src/application/` | `approve-join.usecase.ts`: "admitir a alguien" paso a paso |
| Adapters | `backend/src/adapters/` | `mongo-room.repository.ts`, `memory-room.repository.ts` y `prisma-room.repository.ts` (intercambiables vía `ROOM_STORE`) |

**Estado honesto:** el esqueleto hexagonal existe, pero `RoomService` y algunos handlers todavía mezclan lógica (es el siguiente refactor). Guía paso a paso para aprenderlo y continuarlo: **`docs/architecture/HEXAGONAL.md`**.

---

## 6. Cómo añadir una feature (receta)

Ejemplo: "botón de aplausos que suene para todos".

1. **Regla** en `domain/` si hay decisión pura (¿quién puede aplaudir? ¿cada cuánto?).
2. **Caso de uso** en `application/` (ej. `applause.usecase.ts`): pasos con datos del puerto, sin Express.
3. **Puerto** en `ports/` solo si necesitas guardar/leer algo nuevo.
4. **Cablear** en `sockets/handlers/` o `routes/` + `controllers/`: traducir evento/HTTP → caso de uso → emitir resultado.
5. **Frontend** en `features/`: hook + componente + test en `frontend/tests/`.
6. **Tests:** `npm run test` en ambas carpetas. Si tocas cuota demo, revisa `demo-limits`/`demo-integration`.

Antes de refactorizar, lee `docs/architecture/IMPACT_MAP.md` (qué se rompe si tocas cada módulo) y `SOCKET_EVENTS.md` (contrato de eventos).

---

## 7. Verificación y deploy

```bash
# En backend/ y en frontend/:
npx tsc --noEmit   # tipos
npm run test       # vitest (326 backend + 207 frontend)
npm run build      # build de producción
```

- **Backend →** Render/Railway (necesita WebSockets siempre activos): Root `backend`, build `npm install && npm run build`, start `npm start`, env `MONGODB_URI` (+ `PORT`, `CLIENT_URL`).
- **Frontend →** Vercel: Root `frontend`, preset Vite, env `VITE_API_URL` (URL pública del backend).
- **Salud:** `GET /api/health` → `{ ok: true }` (para probes, sin datos sensibles).
- **Documentación interactiva:** con el backend corriendo abre `http://localhost:4000/api/docs` (Swagger UI: ves y pruebas cada endpoint desde el navegador) o `/api/docs/json` (spec crudo para Postman/Insomnia). El spec vive en `backend/src/docs/openapi.ts`: si cambias un endpoint, actualízalo en el mismo commit (hay un test que verifica que cada path documentado responde de verdad).

---

## 8. Glosario junior (palabras que verás en el código)

- **Puerto:** interfaz TypeScript que dice "necesito guardar salas" sin decir cómo (`ports/`).
- **Adaptador:** la implementación concreta (Mongo o memoria) que cumple el puerto (`adapters/`).
- **Caso de uso:** una acción completa de la app ("aprobar entrada") paso a paso (`application/`).
- **Consenso de playback:** la posición oficial del video que el servidor calcula con los heartbeats; los que llegan tarde saltan ahí.
- **Heartbeat:** aviso periódico "voy en el segundo X" (cada 2.5 s, 15 s en ahorro de datos).
- **Gracia de desconexión:** 20 s en los que el servidor guarda tu sitio si se cae tu internet.
- **`hostSecret`:** contraseña del anfitrión generada al crear la sala; viaja en header `x-host-secret`.
- **Room-state:** foto completa de la sala que el servidor envía al entrar (video, gente, ajustes, posición).
- **`hostOnlySync`:** ajuste que deja la reproducción solo en manos de host/cohost (apagado = todos controlan).
- **Transferir sala:** el host puede pasarle la corona a otro (baja a cohost, el secreto rota).
