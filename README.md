# 🎬 Watch Party

Plataforma web en tiempo real para reproducir videos de forma sincronizada con amigos, chat y reacciones, sin necesidad de compartir pantalla.

---

## 🏗️ Arquitectura del Proyecto

```text
Watch Party/
├── backend/            # API REST + WebSocket Server
│   ├── src/
│   │   ├── config/     # Conexión a base de datos (MongoDB)
│   │   ├── controllers/# Controladores HTTP
│   │   ├── models/     # Esquemas Mongoose (Room, Video, Participants)
│   │   ├── routes/     # Endpoints de Express
│   │   ├── services/   # Lógica de negocio y generación de Room IDs
│   │   ├── types/      # Tipos e interfaces TypeScript
│   │   ├── app.ts      # Configuración de Express y middlewares
│   │   └── server.ts   # Inicialización de HTTP + Socket.IO
│   └── uploads/        # Directorio de almacenamiento temporal de videos
│
├── frontend/           # Aplicación React + Vite + TypeScript
│   ├── src/
│   │   ├── components/ # Componentes modulares con metodología BEM
│   │   ├── pages/      # Home, CreateRoom, Room
│   │   ├── services/   # Cliente API para comunicación HTTP
│   │   ├── types/      # Tipos compartidos
│   │   ├── App.tsx     # Enrutamiento de vistas y estado
│   │   └── index.css   # Sistema de diseño y clases BEM
│
└── docs/               # Documentación y plan del proyecto
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
   - `CLIENT_URL`: La URL de tu frontend en Vercel (ej. `https://tu-app.vercel.app`).

---

### 3. Frontend (Vercel)
1. Importa tu repositorio en [Vercel](https://vercel.com).
2. Selecciona como **Root Directory**: `frontend`
3. Framework Preset: **Vite** (detectado automáticamente).
4. En **Environment Variables**, agrega:
   - `VITE_API_URL`: La URL pública de tu backend desplegado (ej. `https://tu-backend.onrender.com`).
5. Haz clic en **Deploy**.

---

## 🎨 Metodología CSS
El frontend utiliza **BEM (Block Element Modifier)** con variables CSS nativas para un mantenimiento limpio y escalable sin dependencias complejas.

