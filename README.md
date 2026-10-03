# 🎬 Watch Party

Plataforma web en tiempo real para reproducir videos de forma sincronizada con amigos, chat y reacciones, sin necesidad de compartir pantalla.

---

## 🏗️ Arquitectura del Proyecto

```text
Watch Party/
├── backend/            # API REST + WebSocket Server (arquitectura hexagonal)
│   ├── src/
│   │   ├── domain/       # Entidades y reglas puras (auth, settings, playback-consensus)
│   │   ├── ports/        # Interfaces (RoomRepository, EventBus)
│   │   ├── application/  # Casos de uso (approve-join, sync-playback, moderate-user…)
│   │   ├── adapters/     # Repositorios mongo/memoria + routing
│   │   ├── sockets/      # Estado + handlers por dominio (join, sync, chat, moderation…)
│   │   ├── controllers/  # Controladores HTTP
│   │   ├── services/     # RoomService + proxy.service
│   │   ├── routes/       # Endpoints de Express (+ proxy.routes)
│   │   ├── models/       # Esquemas Mongoose
│   │   ├── middleware/   # upload (multer) + error handler
│   │   ├── types/        # Tipos e interfaces TypeScript
│   │   ├── tests/        # Tests vitest (117)
│   │   ├── app.ts        # Configuración de Express y middlewares
│   │   └── server.ts     # Inicialización de HTTP + Socket.IO
│   └── uploads/        # Directorio de almacenamiento temporal de videos
│
├── frontend/           # Aplicación React + Vite + TypeScript (por features)
│   ├── src/
│   │   ├── features/   # room/ participants/ player/ chat/ waiting/ home/
│   │   ├── shared/     # BottomSheet, botones, hooks, utils, constants
│   │   ├── styles/     # variables.css, globals.css, animations.css
│   │   ├── services/   # Cliente API + socket + notificaciones + recientes
│   │   ├── types/      # Tipos compartidos
│   │   ├── tests/      # Tests vitest (63)
│   │   ├── App.tsx     # Enrutamiento de vistas y estado
│   │   └── index.css   # Agregador del sistema de diseño BEM
│
└── docs/               # PROJECT_LEARNING_GUIDE.md, REFACTORING_PLAN.md, status.md
```

---

## 🚀 Cómo ejecutar localmente

### 1. Requisitos previos
- **Node.js**: v18 o superior (verificado con v24)
- **MongoDB**: Instancia local (`mongodb://127.0.0.1:27017`) o MongoDB Atlas.

### 2. Iniciar el Backend
```bash
cd backend
npm run dev
```
El servidor backend arrancará en: `http://localhost:4000`

### 3. Iniciar el Frontend
En otra terminal:
```bash
cd frontend
npm run dev
```
El frontend abrirá en: `http://localhost:5173`

---

## ✅ Verificación (TypeScript + tests + build)

En `backend/` y en `frontend/`:
```bash
npx tsc --noEmit   # tipos
npm run test       # vitest (117 backend + 63 frontend)
npm run build      # build de producción
```

---

## 🔐 Autorización (resumen)

- Al crear la sala se genera un `hostSecret` que el frontend guarda y envía en acciones privilegiadas (payloads socket y headers REST `x-host-secret`).
- Moderación (mute/cam/kick/ban/roles/aprobar) exige host o cohost **según el estado del servidor**; ajustes y cierre exigen host; renombrar a otros exige moderador.
- Sin permiso el servidor responde `action-denied` (socket) o `403` (REST) sin aplicar cambios.
- Settings inválidos → `400` con mensaje (REST) o evento `settings-error` (socket).

---

## 🌐 Guía de Despliegue en Producción

### 1. Base de Datos (MongoDB Atlas)
1. Crea una cuenta en [MongoDB Atlas](https://www.mongodb.com/atlas).
2. Crea un clúster gratuito (Shared M0).
3. En **Database Access**, crea un usuario y contraseña.
4. En **Network Access**, agrega la IP `0.0.0.0/0` (permitir acceso desde cualquier lugar).
5. Copia tu cadena de conexión URI:
   ```text
   mongodb+srv://<usuario>:<password>@cluster0.abcde.mongodb.net/watch_party?retryWrites=true&w=majority
   ```

---

### 2. Servidor Backend (Render / Railway / VPS)
El backend requiere un entorno con soporte para WebSockets activos continuos (como [Render](https://render.com) Web Service o [Railway](https://railway.app)).

1. Conecta tu repositorio de GitHub.
2. Configura el **Root Directory**: `backend`
3. **Build Command**: `npm install && npm run build`
4. **Start Command**: `npm start`
5. Configura las variables de entorno en el panel:
   - `PORT`: `4000` (o el asignado por el hosting)
   - `MONGODB_URI`: Tu cadena de conexión de MongoDB Atlas.
   - `CLIENT_URL`: La URL de tu frontend en Vercel (ej. `https://tu-app.vercel.app`). Nota: hoy no se usa como allowlist (CORS abierto); pendiente restringirlo.

---

### 3. Frontend (Vercel)
1. Importa tu repositorio en [Vercel](https://vercel.com).
2. Selecciona como **Root Directory**: `frontend`
3. Framework Preset: **Vite** (detectado automáticamente).
4. En **Environment Variables**, agrega:
   - `VITE_API_URL`: La URL pública de tu backend desplegado (ej. `https://tu-backend.onrender.com`).
   - `VITE_SOCKET_URL`: (opcional) URL de Socket.IO si difiere de la API.
5. Haz clic en **Deploy**.

---

## 🎨 Metodología CSS
El frontend utiliza **BEM (Block Element Modifier)** con variables CSS nativas para un mantenimiento limpio y escalable sin dependencias complejas.

