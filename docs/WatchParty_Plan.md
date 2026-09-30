# Watch Party — Plan del proyecto

## 1. Idea

**Watch Party** será una plataforma web para ver un video con amigos, pareja o un grupo pequeño sin compartir pantalla.

El anfitrión crea una sala temporal y sube un video. Los demás entran mediante un código o enlace y reproducen el mismo video directamente desde el servidor, cada uno en su propio dispositivo.

La reproducción se mantiene sincronizada:

- Play / pausa
- Adelantar
- Retroceder
- Sincronización de posición
- Chat en tiempo real
- Reacciones
- Lista de participantes
- Chat de voz
- Cámara web
- Activar/desactivar micrófono
- Activar/desactivar cámara
- Indicador de quién está hablando
- Vista de participantes con cámara

Cuando la sesión termina, la sala y el archivo temporal se eliminan.

> El proyecto debe utilizarse con videos propios, con permiso o cuyo uso/distribución sea legal.

---

# 2. Concepto principal

La plataforma **no comparte la pantalla del anfitrión**.

El modelo será:

```text
                    SERVIDOR
                       │
              ┌────────┴────────┐
              │                 │
          Video temporal     Socket.IO
              │                 │
       ┌──────┼──────┐          │
       ▼      ▼      ▼          │
    Host    Amigo1 Amigo2 ◄─────┘
   Player   Player Player
```

Cada navegador reproduce el video por separado.

El servidor:

- Sirve el archivo de video.
- Mantiene información de la sala.
- Sincroniza eventos mediante WebSockets.

**No se transmite la pantalla del host.**

---

# 3. Tecnologías

## Frontend

- React
- Vite
- TypeScript
- Tailwind CSS
- Socket.IO Client

Responsabilidades:

- Interfaz
- Reproductor de video
- Controles
- Chat
- Participantes
- Reacciones
- Comunicación con el backend
- Sincronización del reproductor

## Backend

- Node.js
- Express
- TypeScript
- Socket.IO
- MongoDB
- Mongoose
- Multer para el primer sistema de subida

Responsabilidades:

- Crear salas
- Unirse a salas
- Gestionar participantes
- Gestionar WebSockets
- Sincronizar reproducción
- Gestionar chat
- Gestionar archivos temporales
- Limpiar salas abandonadas

## Base de datos

MongoDB guardará **los datos de la sala**, no el archivo de video.

Ejemplo:

```text
Room
├── roomId
├── hostId
├── status
├── createdAt
├── expiresAt
├── video
│   ├── originalName
│   ├── mimeType
│   └── path
└── participants
```

---

# 4. Estructura del proyecto

```text
watch-party/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoPlayer.tsx
│   │   │   ├── VideoControls.tsx
│   │   │   ├── Chat.tsx
│   │   │   ├── Participants.tsx
│   │   │   ├── Reactions.tsx
│   │   │   └── RoomHeader.tsx
│   │   │
│   │   ├── pages/
│   │   │   ├── Home.tsx
│   │   │   ├── CreateRoom.tsx
│   │   │   └── Room.tsx
│   │   │
│   │   ├── hooks/
│   │   │   ├── useSocket.ts
│   │   │   └── useRoom.ts
│   │   │
│   │   ├── services/
│   │   │   └── api.ts
│   │   │
│   │   ├── types/
│   │   │   └── room.ts
│   │   │
│   │   ├── App.tsx
│   │   └── main.tsx
│   │
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── database.ts
│   │   │
│   │   ├── controllers/
│   │   │   ├── room.controller.ts
│   │   │   └── upload.controller.ts
│   │   │
│   │   ├── models/
│   │   │   └── room.model.ts
│   │   │
│   │   ├── routes/
│   │   │   ├── room.routes.ts
│   │   │   └── upload.routes.ts
│   │   │
│   │   ├── sockets/
│   │   │   ├── room.socket.ts
│   │   │   └── chat.socket.ts
│   │   │
│   │   ├── services/
│   │   │   ├── room.service.ts
│   │   │   ├── sync.service.ts
│   │   │   └── file.service.ts
│   │   │
│   │   ├── middleware/
│   │   │   └── error.middleware.ts
│   │   │
│   │   ├── types/
│   │   │   └── room.types.ts
│   │   │
│   │   ├── app.ts
│   │   └── server.ts
│   │
│   ├── uploads/
│   │   └── .gitkeep
│   │
│   └── package.json
│
├── .gitignore
├── README.md
└── package.json
```

---

# 5. Flujo del usuario

```text
                         HOME
                           │
              ┌────────────┴────────────┐
              │                         │
         Crear sala                Unirse a sala
              │                         │
              ▼                         │
       Seleccionar video                │
              │                         │
              ▼                         │
       Crear Room en MongoDB            │
              │                         │
              ▼                         │
       Subir video temporal             │
              │                         │
              ▼                         │
       Obtener Room ID                  │
              │                         │
              ▼                         │
       Compartir enlace ────────────────┘
                           │
                           ▼
                     SALA ACTIVA
                           │
              ┌────────────┼────────────┐
              │            │            │
            Video         Chat       Reacciones
              │
              ▼
       Sincronización Socket.IO
              │
              ▼
          FIN DE SESIÓN
              │
              ▼
           CLEANUP
              ├── Eliminar Room
              └── Eliminar video
```

---

# 6. API inicial

## Crear sala

```http
POST /api/rooms
```

Respuesta:

```json
{
  "roomId": "8FK29X",
  "hostId": "abc123"
}
```

## Obtener información de sala

```http
GET /api/rooms/:roomId
```

## Subir video

```http
POST /api/rooms/:roomId/video
```

## Unirse

```http
POST /api/rooms/:roomId/join
```

## Eliminar

```http
DELETE /api/rooms/:roomId
```

---

# 7. Socket.IO

Cuando alguien entra a una sala:

```javascript
socket.join(roomId);
```

Ejemplo:

```text
Sala: 8FK29X

├── Roberto
├── Ana
├── Carlos
└── Pedro
```

Si Roberto pausa:

```text
Roberto
   │
   │ pause
   ▼
Socket.IO
   │
   ├──► Ana
   ├──► Carlos
   └──► Pedro
```

Eventos iniciales:

```text
join-room
leave-room

play
pause
seek

chat-message
reaction

user-joined
user-left

room-state
```

---

# 8. Cómo funciona la sincronización

Supongamos que el video está en:

```text
01:25:32
```

Roberto pulsa pausa.

El frontend envía:

```json
{
  "action": "pause",
  "currentTime": 5132
}
```

El servidor distribuye el evento a los demás participantes.

Cada navegador ejecuta algo equivalente a:

```javascript
video.currentTime = currentTime;
video.pause();
```

Para reproducir:

```json
{
  "action": "play",
  "currentTime": 5132
}
```

Para adelantar:

```json
{
  "action": "seek",
  "currentTime": 5200
}
```

---

# 9. Sincronización avanzada

Más adelante podemos añadir un timestamp:

```json
{
  "action": "play",
  "currentTime": 125.43,
  "timestamp": 1727380000000
}
```

Esto permite compensar parte del retraso de red.

Una estrategia posible:

```text
Diferencia < 0.3 segundos
→ No corregir

0.3–2 segundos
→ Ajustar suavemente

> 2 segundos
→ Saltar directamente a la posición correcta
```

Esto **no será parte de la primera versión**.

---

# 10. Host y participantes

Primera versión:

```text
HOST
├── Crea sala
├── Sube video
├── Controla reproducción
└── Puede cerrar la sala

PARTICIPANTES
├── Ven el video
├── Chat
└── Reacciones
```

Después podemos permitir que todos controlen:

```text
Ana → pausa
Carlos → play
Pedro → adelanta
```

Primero implementaremos solo el host para reducir la complejidad.

---

# 11. Video y almacenamiento

MongoDB **no debe guardar el archivo de video**.

Para el MVP podemos utilizar:

```text
backend/uploads/
```

El navegador accederá al video mediante HTTP.

Conceptualmente:

```text
Servidor
   │
   ├──── HTTP ────► Roberto
   │
   ├──── HTTP ────► Ana
   │
   └──── HTTP ────► Carlos
```

Cada dispositivo reproduce el archivo de manera independiente.

Más adelante podemos migrar el almacenamiento a:

- Cloudflare R2
- Amazon S3
- Azure Blob Storage

---

# 12. Chat

El chat funcionará mediante Socket.IO.

```text
Ana
 │
 │ send-message
 ▼
Servidor
 │
 │ chat-message
 ├────────► Roberto
 ├────────► Carlos
 └────────► Pedro
```

Ejemplo:

```json
{
  "user": "Ana",
  "message": "JAJAJA",
  "createdAt": 1727380000000
}
```

El chat puede ser temporal y desaparecer con la sala.

---

# 13. Reacciones

Inicialmente:

```text
❤️
😂
😮
👏
🔥
```

Ejemplo:

```text
Ana → 😂
```

Todos reciben la reacción y el frontend puede mostrarla como una animación sobre el reproductor.

---

# 14. Ciclo de vida de una sala

```text
CREAR
  │
  ▼
SUBIR VIDEO
  │
  ▼
SALA ACTIVA
  │
  ├── Usuarios entran
  ├── Video sincronizado
  ├── Chat
  └── Reacciones
  │
  ▼
SALA VACÍA
  │
  ▼
Esperar algunos minutos
  │
  ▼
CLEANUP
  ├── MongoDB → eliminar Room
  └── Storage → eliminar video
```

También habrá que contemplar salas abandonadas si alguien cierra el navegador sin salir correctamente.

---

# 15. Seguridad mínima

Desde el comienzo:

- Room IDs aleatorios.
- Límite de tamaño del video.
- Validación del tipo MIME.
- Lista de extensiones permitidas.
- Límite de participantes.
- Expiración de salas.
- Limpieza de archivos abandonados.
- Validación de eventos WebSocket.
- No confiar en datos enviados por el navegador.
- No exponer rutas internas del servidor.

---

# 16. Diseño de la interfaz

## Home

```text
┌──────────────────────────────┐
│         WATCH PARTY          │
│                              │
│   Ver juntos. Desde donde sea.│
│                              │
│       [ Crear sala ]         │
│                              │
│       [ Unirse a sala ]      │
│                              │
│   Código: [__________]       │
└──────────────────────────────┘
```

## Crear sala

```text
┌──────────────────────────────┐
│        CREAR SALA            │
│                              │
│  Nombre: [ Roberto ]         │
│                              │
│  Video:                     │
│  ┌────────────────────────┐  │
│  │ Arrastra tu video aquí │  │
│  │       o selecciónalo   │  │
│  └────────────────────────┘  │
│                              │
│       [ Crear sala ]         │
└──────────────────────────────┘
```

## Sala en escritorio

```text
┌──────────────────────────────────────────────┐
│ WATCH PARTY                    ROOM: 8FK29X │
├────────────────────────────────┬─────────────┤
│                                │             │
│                                │ PARTICIPANTES│
│                                │             │
│             VIDEO              │ Roberto     │
│                                │ Ana         │
│                                │ Carlos      │
│                                │             │
│ ▶ ━━━━━━━━━━━━━━━ 42:31        │             │
├────────────────────────────────┤             │
│ CHAT                           │             │
│                                │             │
│ Ana: 😂😂                      │             │
│ Roberto: mira eso              │             │
│                                │             │
│ [ Escribe un mensaje... ]      │             │
└────────────────────────────────┴─────────────┘
```

## Sala móvil

```text
┌────────────────────┐
│ WATCH PARTY        │
│ ROOM: 8FK29X       │
├────────────────────┤
│                    │
│       VIDEO        │
│                    │
│ ▶ ━━━━━━━━━━━━━    │
├────────────────────┤
│ 👤 4 participantes │
├────────────────────┤
│ CHAT               │
│                    │
│ Ana: 😂            │
│ Roberto: jajaja    │
│                    │
│ [Escribir...]      │
└────────────────────┘
```

---

# 17. Fases de desarrollo

## Fase 1 — Fundamentos

```text
React
Express
TypeScript
MongoDB
```

Objetivo:

```text
Frontend → Backend → MongoDB
```

Aprender:

- HTTP
- REST
- Express
- MongoDB
- Mongoose
- Routes
- Controllers
- Models
- Variables de entorno

---

## Fase 2 — Sistema de salas

Implementar:

```text
Crear sala
Obtener sala
Unirse
Salir
Eliminar
```

Resultado:

```text
Usuario
   ↓
Crear sala
   ↓
Room ID
   ↓
Compartir
```

---

## Fase 3 — Video

Implementar:

```text
Upload
Storage
Video endpoint
HTML <video>
```

Resultado:

```text
Host
 ↓
Sube video
 ↓
Servidor
 ↓
Participantes reproducen
```

---

## Fase 4 — Socket.IO

Primero:

```text
join-room
user-joined
user-left
```

Después:

```text
play
pause
seek
```

---

## Fase 5 — Sincronización

Mejorar:

```text
currentTime
timestamp
latencia
corrección de desincronización
```

---

## Fase 6 — Chat

```text
Mensajes
Usuarios
Notificaciones
```

---

## Fase 7 — Reacciones

```text
❤️
😂
🔥
👏
😮
```

---

## Fase 8 — Limpieza automática

```text
room expiration
file deletion
cleanup
```

---

## Fase 9 — Seguridad y optimización

- Validación
- Rate limiting
- Límites de archivos
- Control de acceso
- Optimización móvil
- Manejo de errores

---

## Fase 10 — Deploy

Primero local.

Después servidor.

---

# 18. Arquitectura

```text
                    INTERNET
                       │
          ┌────────────┴────────────┐
          │                         │
       FRONTEND                  BACKEND
       React                    Express
       Vite                     Socket.IO
          │                         │
          │ HTTP                    │
          ├────────────────────────►│
          │                         │
          │ WebSocket               │
          ├────────────────────────►│
          │                         │
          │                         ├── MongoDB
          │                         │
          │                         └── Video Storage
          │
          ▼
       VIDEO PLAYER
```

Responsabilidad de cada tecnología:

```text
MongoDB
→ Datos

Express
→ API

Socket.IO
→ Tiempo real

Storage
→ Video

React
→ Interfaz
```

---

# 19. Metodología de aprendizaje

La meta es que el proyecto también sirva para aprender backend.

No queremos:

```text
ChatGPT da código
       ↓
Copiar
       ↓
Funciona
       ↓
No sé por qué
```

La metodología será:

```text
1. Entender el problema
2. Diseñar
3. Crear una pequeña parte
4. Explicar qué hace
5. Implementar
6. Probar
7. Romperlo
8. Corregirlo
9. Continuar
```

Cada concepto nuevo se aprenderá cuando el proyecto lo necesite.

---

# 20. Orden de aprendizaje

```text
HTTP
 ↓
REST API
 ↓
Express
 ↓
MongoDB
 ↓
Mongoose
 ↓
Arquitectura backend
 ↓
Upload de archivos
 ↓
WebSockets
 ↓
Socket.IO
 ↓
Sincronización
```

---

# 21. Primera meta de programación

**No comenzar todavía con chat, reacciones ni sincronización.**

La primera meta será:

```text
React
   ↓
POST /api/rooms
   ↓
Express
   ↓
MongoDB
   ↓
roomId
   ↓
React
```

Cuando esto funcione tendremos nuestra primera sala real.

Después construiremos encima de ella.

---

# 22. Checklist

```text
[ ] Crear repositorio
[ ] Crear frontend React + TypeScript
[ ] Crear backend Express + TypeScript
[ ] Configurar MongoDB
[ ] Crear modelo Room
[ ] Crear POST /api/rooms
[ ] Crear GET /api/rooms/:roomId
[ ] Crear página CreateRoom
[ ] Crear página Room
[ ] Implementar upload
[ ] Servir video
[ ] Instalar Socket.IO
[ ] Crear sistema de salas WebSocket
[ ] Sincronizar play
[ ] Sincronizar pause
[ ] Sincronizar seek
[ ] Implementar chat
[ ] Implementar reacciones
[ ] Implementar expiración
[ ] Eliminar archivos automáticamente
[ ] Optimizar móvil
[ ] Seguridad
[ ] Deploy
```

---

# 23. Objetivo final

El usuario podrá:

1. Entrar a la página.
2. Crear una sala.
3. Seleccionar un video.
4. Recibir un código/enlace.
5. Compartirlo.
6. Los amigos entran desde celular, tablet o PC.
7. Todos reproducen el mismo video.
8. La reproducción permanece sincronizada.
9. Pueden chatear.
10. Pueden reaccionar.
11. Pueden abandonar la sala.
12. La sala desaparece después de finalizar.
13. El archivo temporal se elimina.

---

# 24. Regla principal de arquitectura

> **MongoDB guarda información de la sala. Socket.IO sincroniza eventos. HTTP sirve el video. React muestra todo al usuario.**

Cada tecnología tiene una responsabilidad clara.

Esto evitará que el backend se convierta en un proyecto desordenado.

---

# 25. Primera misión

La primera implementación será solamente:

```text
Crear proyecto
    ↓
Configurar Express
    ↓
Conectar MongoDB
    ↓
Crear modelo Room
    ↓
POST /api/rooms
    ↓
Generar roomId
    ↓
Guardar sala
    ↓
Devolver roomId
```

Después pasaremos al frontend y construiremos la interfaz para crear y entrar a salas.

**No intentaremos construir el proyecto completo de una sola vez.**
