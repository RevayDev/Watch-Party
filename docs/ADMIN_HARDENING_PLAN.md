# Plan de endurecimiento del `/api/admin` (pendiente)

> Estado actual (rama `demo-free`, verificado 2026-10-06): el admin usa
> `ADMIN_TOKEN` en env + `requireAdmin` con `timingSafeEqual` sobre SHA-256
> (`backend/src/middleware/requireAdmin.ts`), token en frontend solo en memoria
> (`frontend/src/features/admin/AdminPage.tsx`). Comparte `globalLimiter`
> (600 req/min por IP, `backend/src/app.ts:60`): **sin freno real a la
> adivinación online ni auditoría de fallos**.

Decisión: **no** migrar a usuario+contraseña con bcrypt/sesiones (para un
solo admin es el mismo secreto compartido con más complejidad; solo compensa
con múltiples administradores, y el actor ya se distingue con `x-admin-actor`).
Endurecer el token en su lugar.

## Tareas

1. **Límite estricto propio para `/api/admin`** (`middleware/rate-limit.middleware.ts`, `app.ts`)
   - Ej.: 60 req/min general por IP + bloqueo temporal (~15 min) tras ~10
     `401` consecutivos de la misma IP.
   - No debe molestar el uso legítimo (el panel hace pocas peticiones).

2. **Auditoría de intentos fallidos** (`payments/audit.service.ts`)
   - Registrar cada `401` de `requireAdmin` (IP, hora, ruta). Verlos en la
     pestaña de auditoría del panel.

3. **Exigir secreto fuerte al arrancar** (`config/` o `server.ts`)
   - Si `ADMIN_TOKEN` tiene menos de 32 caracteres: aviso en desarrollo,
     negarse a arrancar (o 503 permanente) en producción.

4. **HTTPS en producción**
   - Render/Vercel lo dan por defecto; documentar que el token/contraseña sin
     TLS viaja legible igual. Sin acción de código.

## Verificación al implementar

- `npx tsc --noEmit` + `npm run lint` + `npm run test` en `backend/`.
- Tests nuevos: ráfaga de 11 tokens malos → 429/bloqueo; token débil →
  aviso/rechazo al arrancar; fallos visibles en auditoría.
- El login del frontend solo necesita mensaje de error genérico (sin cambios
  de protocolo: sigue `x-admin-token`).
