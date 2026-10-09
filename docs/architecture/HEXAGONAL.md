# Hexagonal simple (puertos y adaptadores) — guía para aprenderla aquí

> Para quién: junior que ya leyó el `README.md` §3–§5. Objetivo: entender la
> arquitectura en 15 minutos y saber dónde poner código nuevo.

## 1. La idea en 1 minuto

Tu lógica de negocio (las reglas de las salas) **no debe saber** si los datos
vienen de Mongo o de memoria, ni si la petición llegó por REST o por
WebSocket. Para lograrlo:

- La lógica define **puertos** = interfaces ("necesito guardar salas", con
  métodos `findById`, `save`, `count`, sin mencionar Mongo).
- El mundo exterior provee **adaptadores** = clases que cumplen esas
  interfaces (una para Mongo, otra para memoria).
- Los **casos de uso** orquestan: "aprobar entrada" = buscar sala → validar
  regla → guardar → devolver resultado.

Si mañana cambias Mongo por Postgres, solo escribes un adaptador nuevo. Las
reglas y los casos de uso no se tocan. Eso es todo lo que la arquitectura
promete; el resto es disciplina.

## 2. Las 3 capas y la única regla

```text
  ADAPTADORES  →  APPLICATION  →  DOMAIN
  (Express,        (casos de       (reglas puras,
   Mongoose,        uso)            sin imports
   memoria,                         de frameworks)
   Socket.IO)
```

**Regla de oro (regla de dependencia):** las flechas solo apuntan hacia
adentro. `domain/` no importa NADA de fuera (ni Express, ni Mongoose, ni
sockets). `application/` solo conoce `domain/` + `ports/`. Los adaptadores
conocen a todos, nadie los conoce a ellos.

Cómo comprobarlo en 10 segundos: abre cualquier archivo de `domain/` y mira
sus `import` — solo deben ser de `domain/` o de `types/`. Si ves `express` o
`mongoose` ahí, algo está mal.

## 3. Mapa real de este repo

| Capa | Carpeta | Archivo ejemplo | Qué contiene |
|---|---|---|---|
| Domain | `backend/src/domain/` | `playback-policy.ts` | "¿Este salto de video se aplica?" (función pura, testeable sin servidor) |
| Domain | `backend/src/domain/` | `settings-policy.ts` | Qué ajustes son válidos (whitelist + saneado) |
| Domain | `backend/src/domain/` | `auth-policy.ts` | Quién puede hacer qué (host/cohost/miembro) |
| Domain | `backend/src/domain/` | `room.entity.ts` | La sala como dato + invariantes |
| Ports | `backend/src/ports/` | `room.repository.ts` | Interfaz `RoomRepository`: `findById/save/count…` |
| Application | `backend/src/application/` | `approve-join.usecase.ts` | Pasos de "admitir a alguien" |
| Application | `backend/src/application/` | `sync-playback.usecase.ts` | Pasos de "aplicar play/pausa/seek" |
| Application | `backend/src/application/` | `moderate-user.usecase.ts` | Pasos de "silenciar/expulsar" |
| Adapters | `backend/src/adapters/` | `mongo-room.repository.ts` | Guarda en Mongo (cumple el puerto) |
| Adapters | `backend/src/adapters/` | `memory-room.repository.ts` | Guarda en memoria (mismo puerto) |
| Adapters | `backend/src/adapters/` | `room-repository.routing.ts` | Elige Prisma/Mongo/memoria según `ROOM_STORE` y conexión |
| Adapters | `backend/src/adapters/` | `prisma-room.repository.ts` | Guarda con Prisma ORM (mismo puerto; `ROOM_STORE=prisma`) |
| Entrada | `backend/src/routes/` + `controllers/` | `room.routes.ts` | HTTP → traduce y llama hacia adentro |
| Entrada | `backend/src/sockets/handlers/` | `join-approval.handler.ts` | Socket → traduce y llama hacia adentro |

Los adaptadores de *entrada* (routes/controllers/handlers) traducen el mundo
exterior al lenguaje de los casos de uso; los de *salida* (repositorios)
guardan datos. Ambos lados dependen de las interfaces, no al revés.

## 4. Ejemplo guiado: aprobar una entrada

Flujo real (`join-approval.handler.ts` → `approve-join.usecase.ts`):

```text
1. Socket recibe `approve-join { roomId, target }`
2. Handler: verifica permiso con auth-policy (¿es host/cohost?) → si no,
   emite `action-denied` y PARA (la regla vive en domain, no en el handler).
3. Caso de uso: busca la sala (puerto), comprueba cupo demo (5), saca la
   solicitud de la lista, añade al participante, guarda (puerto).
4. Handler: emite `room-state` a la sala + `join-approved` al admitido.
```

Nota de diseño: el handler sabe de sockets; el caso de uso no. Si mañana la
aprobación llegara por REST en vez de socket, el caso de uso se reutiliza tal
cual.

## 5. Receta: añadir una feature sin romper nada

1. **¿Hay una decisión?** → función pura en `domain/` (ej. "un aplauso vale si
   pasaron >3 s desde el anterior"). Test directo, sin servidor.
2. **¿Necesitas datos nuevos?** → añade el método al puerto en `ports/`,
   impleméntalo en **ambos** adaptadores (mongo + memoria).
3. **¿Es una acción completa?** → nuevo `*.usecase.ts` en `application/`
   que orqueste domain + puertos. Sin `req`, `res`, `socket` ni `io`.
4. **Cablea la entrada** (routes/controllers o sockets/handlers): valida
   permiso con `auth-policy`, llama al caso de uso, emite/responde.
5. **Frontend** en `features/`: hook + componente + test.
6. **Verifica:** `npx tsc --noEmit` + `npm run test` en `backend/` y
   `frontend/`. Si tocas cupos, corre los tests `demo-*`.

## 6. Errores típicos (y cómo olerlos)

- **Importar `mongoose`/`express` en `domain/`** → la regla deja de ser
  testeable sin servidor. Mueve el acceso a datos al caso de uso.
- **Lógica de permiso en el handler** (`if (isHost) …` repetido) → muévela a
  `auth-policy.ts` para que todos los handlers compartan la misma regla.
- **Caso de uso que emite sockets** → ya no es reutilizable. Devuelve un
  resultado y que el handler emita.
- **Confiar en el payload del cliente** (nombres, roles, flags) → el handler
  verifica contra el estado del servidor (`activeUsers`, `auth-policy`) antes
  de llamar al caso de uso. Ejemplo: el chat usa el nombre del servidor, no
  el que envía el cliente (anti-suplantación).
- **Añadir un adaptador sin actualizar los otros** (mongo sí, memoria no) →
  el modo sin-DB se rompe. Siempre en conjunto (ver `prisma-room.repository.ts`:
  así se añadió Prisma sin tocar ni una regla).
- **Cambiar el schema Prisma** (`prisma/schema.prisma`) sin correr
  `npm run prisma:generate` → el cliente queda desactualizado. El
  `postinstall` lo regenera solo en cada `npm install`.

## 7. Qué falta en este repo (trabajo futuro, honesto)

- `services/room.service.ts` aún concentra lógica que debería vivir en
  casos de uso + políticas (es el siguiente refactor, ver
  `IMPACT_MAP.md` antes de tocarlo).
- Algunos handlers llaman al servicio directamente en vez de a
  `application/`. Migrar de uno en uno, con su test, sin cambiar eventos.
- `models/room.model.ts` es el esquema Mongoose (detalle del adaptador
  Mongo, no del dominio): no importarlo fuera de `adapters/`.

Cuando muevas un bloque a su capa, actualiza este archivo y el diagrama de
`ARCHITECTURE.md` (regla: nada entra al diagrama sin verificar el import).
