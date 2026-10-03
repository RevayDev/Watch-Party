# Registro de Decisiones de Arquitectura (ADR) — Watch Party

Este documento registra las decisiones técnicas clave, su justificación, alternativas evaluadas y consecuencias para garantizar la coherencia del proyecto.

---

## ADR 01: Sincronización P2P / Cliente con Mediación de Posición (Servidor Árbitro)
* **Fecha:** 2026-10-03
* **Estado:** Aceptado
* **Contexto:** En una watch party, retransmitir video desde un servidor central (SFU/MCU) consume enormes anchos de banda y CPU. Cada cliente debe reproducir el video localmente o desde su enlace original.
* **Decisión:** El servidor actúa únicamente como árbitro de eventos de sincronización (`play`, `pause`, `seek`, `playback-heartbeat`) con cálculo de compensación por latencia (`sentAt`) y algoritmo de consenso mayoritario (`resolveRoomTime`).
* **Consecuencias:** Costos de infraestructura mínimos, escalabilidad de reproducción y tolerancia a latencias individuales sin degradar a otros espectadores.

---

## ADR 02: Control y Permisos de Reproducción Global
* **Fecha:** 2026-10-03
* **Estado:** Aceptado
* **Contexto:** Cualquier usuario conectado podía disparar `sync-video` interrumpiendo la reproducción del grupo.
* **Decisión:** La modificación global de playback (`play`, `pause`, `seek`) requiere rol de Anfitrión o Co-Anfitrión en el servidor (`requireModerator`). Si un miembro no autorizado emite un evento, el servidor responde con `action-denied` sin propagar el cambio al resto de la sala. Los miembros legítimos solo emiten `playback-heartbeat` para alimentar el consenso de sala.
* **Consecuencias:** Se evitan guerras de control y troleos, manteniendo la estabilidad de la experiencia compartida.

---

## ADR 03: Política CORS Unificada y Centralizada
* **Fecha:** 2026-10-03
* **Estado:** Aceptado
* **Contexto:** Express y Socket.IO tenían configuraciones divergentes (`cors()` por defecto y `origin: '*'`).
* **Decisión:** Centralizar la validación de orígenes en `config/cors.ts`. En producción se respeta `CLIENT_URL` y `ALLOWED_ORIGINS`. En desarrollo se permiten URLs locales y rangos de red LAN (192.168.x.x, 10.x.x.x) para pruebas en dispositivos móviles.
* **Consecuencias:** Seguridad contra accesos no autorizados y llamadas maliciosas sin romper el flujo de desarrollo ni pruebas locales.

---

## ADR 04: Abstracción de Repositorio Dual (Mongo / Memoria) con Routing Dinámico
* **Fecha:** 2026-10-03
* **Estado:** Aceptado
* **Contexto:** Se requiere soporte tanto con MongoDB activo como en modo sin base de datos (desarrollo rápido / fallback local).
* **Decisión:** Implementar `RoomRepository` con implementaciones `MongoRoomRepository` y `MemoryRoomRepository` (con snapshot en `data/rooms.json`). El enrutador `RoutingRoomRepository` consulta `getIsMongoConnected()` dinámicamente en cada operación.
* **Consecuencias:** Cero duplicación de lógica de negocio en `RoomService`. Transición transparente entre MongoDB y almacenamiento en memoria.

---

## ADR 05: Rate Limiting Ligero en Memoria sin Infraestructura Adicional
* **Fecha:** 2026-10-03
* **Estado:** Aceptado
* **Contexto:** Proteger endpoints sensibles (`/api/rooms`, `/upload`, `/api/proxy`) contra abuso sin introducir Redis ni componentes externos complejos.
* **Decisión:** Implementar un middleware ligero basado en ventana deslizante en memoria (`rate-limit.middleware.ts`) que devuelve HTTP 429 con cabecera `Retry-After`.
* **Consecuencias:** Protección efectiva contra DoS y ráfagas manteniendo la arquitectura simple y fácil de desplegar.

---

## ADR 06: Identidad Estable de Participantes (userId)
* **Fecha:** 2026-10-03
* **Estado:** Aceptado
* **Contexto:** Los participantes que cambian de nombre o refrescan la página no deben duplicarse ni perder su rol ni fusionarse con otros que compartan el mismo nombre.
* **Decisión:** Asignar un `userId` UUID persistido en `localStorage`. Las consultas de sala, reconexiones (gracia de 20s) y moderación priorizan `userId` sobre el nombre visible.
* **Consecuencias:** No hay colisiones de nombre, los renombres son seguros y las reconexiones son fluidas.
