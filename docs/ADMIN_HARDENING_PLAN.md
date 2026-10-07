# Plan de endurecimiento del `/api/admin` — IMPLEMENTADO 2026-10-06

> Verificación: `tsc` limpio, `lint` 0 errores, `tests/admin-hardening.test.ts`
> 8/8 en verde. Login del frontend sin cambios (ya mapea 503/401 a mensajes
> genéricos en `adminApi.ts`).

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

## Tareas (todas aplicadas)

1. **Límite estricto propio para `/api/admin`** ✅ — `adminLimiter`
   (60 req/min/IP, `ADMIN_RATE_MAX`/`ADMIN_RATE_WINDOW_MS`) + `adminRateLimit`
   (bloqueo ~15 min tras ~10 `401` de la misma IP, `ADMIN_AUTH_MAX_FAILS`/
   `ADMIN_AUTH_BLOCK_MINUTES`; login válido limpia). Montado en `app.ts`
   antes de `globalLimiter`.
2. **Auditoría de intentos fallidos** ✅ — cada `401` registra
   `admin.auth-failed` (IP, método, ruta) vía `logAudit`, visible en la
   pestaña de auditoría.
3. **Secreto fuerte al arrancar** ✅ — `checkAdminTokenStrength()` en
   `requireAdmin.ts`; `server.ts` rechaza el arranque en producción con
   token < 32 caracteres, avisa en desarrollo; sin token arranca (admin 503).
4. **HTTPS en producción** ✅ — Render/Vercel lo dan por defecto; sin acción
   de código (documentado en `server.ts`).

## Verificación al implementar

- `npx tsc --noEmit` + `npm run lint` + `npm run test` en `backend/`.
- Tests nuevos: ráfaga de 11 tokens malos → 429/bloqueo; token débil →
  aviso/rechazo al arrancar; fallos visibles en auditoría.
- El login del frontend solo necesita mensaje de error genérico (sin cambios
  de protocolo: sigue `x-admin-token`).
