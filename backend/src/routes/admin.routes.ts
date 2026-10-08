/**
 * SUBAGENTE 3 (pagos): router de administración.
 *
 * SOLO SE EXPORTA — no se monta aquí (lo monta el coordinador en `app.ts`).
 * Todo va tras el `requireAdmin` canónico (`src/middleware/requireAdmin.ts`,
 * contra `ADMIN_TOKEN`: 503 sin configurar, 401 sin token válido).
 *
 * - GET   /summary                  → conteos (salas, pagos, códigos, accesos)
 * - GET   /rooms?roomId=XXX         → detalle SANITIZADO de una sala (jamás hostSecret)
 * - GET   /rooms/:roomId            → ídem por path
 * - GET   /payments                 → pagos con filtros ?status=&provider=&search=&limit=
 * - POST  /payments/:paymentId/refund → reembolso local (auditado; no mueve dinero real)
 * - GET   /gift-codes               → lista códigos
 * - POST  /gift-codes               → crea código { type, durationDays?, maxUses?, expiresInDays? }
 * - PATCH /gift-codes/:code/disable → desactiva código
 * - DELETE /gift-codes/:code        → borra código sin usos
 * - GET   /audit                    → auditoría ?action=&actor=&since=&limit=
 * - GET   /metrics                  → métricas del sistema (reutiliza RoomService + activeUsers)
 */

import { Router, type Request, type Response } from 'express';
import { RoomService } from '../services/room.service.js';
import { activeUsers } from '../sockets/socket-state.js';
import { getMetricsSnapshot, getSystemMetrics } from '../services/metrics.service.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { PaymentService } from '../payments/payment.service.js';
import { GiftCodeService } from '../payments/gift-code.service.js';
import { listAuditLogs } from '../payments/audit.service.js';
import { entitlementStore } from '../payments/payment.store.js';
import { toServiceError } from '../payments/errors.js';
import type { IRoom } from '../types/room.types.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

/** Actor para auditoría (header opcional `x-admin-actor`, por defecto `admin`). */
function adminActorOf(req: Request): string {
  const raw = req.headers['x-admin-actor'];
  const picked = Array.isArray(raw) ? raw[0] : raw;
  return typeof picked === 'string' && picked.trim() !== '' ? picked.trim().slice(0, 80) : 'admin';
}

function sendError(res: Response, err: unknown): void {
  const svc = toServiceError(err);
  res.status(svc.statusCode).json({ error: svc.message, code: svc.code });
}

/**
 * Vista sanitizada de sala: detalle útil sin nada sensible-innecesario.
 * Excluye SIEMPRE: hostSecret, socketIds, userIds, joinRequests crudas,
 * rutas/filenames internos de video.
 */
function sanitizeRoom(room: IRoom): Record<string, unknown> {
  return {
    roomId: room.roomId,
    hostName: room.hostName,
    status: room.status,
    isTemporary: room.isTemporary !== false,
    participantCount: (room.participants || []).length,
    participants: (room.participants || []).map((p) => ({
      name: p.name,
      role: p.role,
      isHost: p.isHost,
      device: p.device,
      joinedAt: p.joinedAt,
    })),
    pendingRequests: (room.joinRequests || []).length,
    video: room.video
      ? {
          title: room.video.originalName,
          mimeType: room.video.mimeType,
          sourceType: room.video.sourceType,
        }
      : null,
    settings: room.settings,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

async function roomDetail(roomId: string, res: Response): Promise<void> {
  const room = await RoomService.getRoomById(roomId);
  if (!room) {
    res.status(404).json({ error: 'Sala no encontrada.' });
    return;
  }
  res.json({ room: sanitizeRoom(room) });
}

adminRouter.get('/summary', (_req, res) => {
  Promise.all([
    RoomService.countLiveRooms(),
    PaymentService.paymentsSummary(),
    GiftCodeService.listGiftCodes(),
    entitlementStore.countActive(),
  ])
    .then(([liveRooms, payments, codes, activeEntitlements]) => {
      res.json({
        rooms: { live: liveRooms },
        payments,
        giftCodes: {
          total: codes.length,
          active: codes.filter((c) => c.status === 'active').length,
        },
        entitlements: { active: activeEntitlements },
      });
    })
    .catch((err: unknown) => sendError(res, err));
});

adminRouter.get('/rooms', (req, res) => {
  const roomId = typeof req.query.roomId === 'string' ? req.query.roomId : undefined;
  if (!roomId || roomId.trim() === '') {
    // Sin listado masivo a propósito (privacidad, igual que /api/demo):
    // conteo + lookup puntual por código.
    RoomService.countLiveRooms()
      .then((liveRooms) =>
        res.json({ liveRooms, rooms: [], note: 'Escribe el código de la sala abajo para ver su detalle.' })
      )
      .catch((err: unknown) => sendError(res, err));
    return;
  }
  roomDetail(roomId, res).catch((err: unknown) => sendError(res, err));
});

adminRouter.get('/rooms/:roomId', (req, res) => {
  roomDetail(req.params.roomId ?? '', res).catch((err: unknown) => sendError(res, err));
});

adminRouter.get('/payments', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const allowed = ['pending', 'completed', 'failed', 'cancelled', 'refunded'] as const;
  const limit = Number(req.query.limit ?? 50);
  PaymentService.listPayments({
    status: allowed.includes(status as (typeof allowed)[number])
      ? (status as (typeof allowed)[number])
      : undefined,
    provider: typeof req.query.provider === 'string' ? req.query.provider : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 200) : 50,
  })
    .then((payments) => res.json({ payments }))
    .catch((err: unknown) => sendError(res, err));
});

adminRouter.post('/payments/:paymentId/refund', (req: Request, res: Response) => {
  PaymentService.refundPayment(req.params.paymentId ?? '', adminActorOf(req))
    .then((payment) => res.json({ payment }))
    .catch((err: unknown) => sendError(res, err));
});

adminRouter.get('/gift-codes', (_req, res) => {
  GiftCodeService.listGiftCodes()
    .then((codes) => res.json({ codes }))
    .catch((err: unknown) => sendError(res, err));
});

adminRouter.post('/gift-codes', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    type?: unknown;
    durationDays?: unknown;
    maxUses?: unknown;
    expiresInDays?: unknown;
  };
  GiftCodeService.createGiftCode({
    type: typeof body.type === 'string' ? body.type : '',
    durationDays: typeof body.durationDays === 'number' ? body.durationDays : undefined,
    maxUses: typeof body.maxUses === 'number' ? body.maxUses : undefined,
    expiresInDays: typeof body.expiresInDays === 'number' ? body.expiresInDays : undefined,
    createdBy: adminActorOf(req),
  })
    .then((code) => res.status(201).json({ code }))
    .catch((err: unknown) => sendError(res, err));
});

adminRouter.patch('/gift-codes/:code/disable', (req: Request, res: Response) => {
  GiftCodeService.disableGiftCode(req.params.code ?? '', adminActorOf(req))
    .then((code) => res.json({ code }))
    .catch((err: unknown) => sendError(res, err));
});

adminRouter.delete('/gift-codes/:code', (req: Request, res: Response) => {
  GiftCodeService.deleteGiftCode(req.params.code ?? '', adminActorOf(req))
    .then(() => res.json({ deleted: true, code: (req.params.code ?? '').toUpperCase().trim() }))
    .catch((err: unknown) => sendError(res, err));
});

adminRouter.get('/audit', (req, res) => {
  const sinceRaw = typeof req.query.since === 'string' ? req.query.since : undefined;
  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  const limit = Number(req.query.limit ?? 50);
  listAuditLogs({
    action: typeof req.query.action === 'string' ? req.query.action : undefined,
    actor: typeof req.query.actor === 'string' ? req.query.actor : undefined,
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 200) : 50,
  })
    .then((entries) => res.json({ entries }))
    .catch((err: unknown) => sendError(res, err));
});

adminRouter.get('/metrics', (_req, res) => {
  Promise.all([
    RoomService.countLiveRooms(),
    PaymentService.paymentsSummary(),
    entitlementStore.countActive(),
    GiftCodeService.listGiftCodes(),
  ])
    .then(([liveRooms, payments, activeEntitlements, codes]) => {
      res.json({
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        rooms: { live: liveRooms },
        sockets: { online: activeUsers.size },
        payments,
        entitlements: { active: activeEntitlements },
        giftCodes: {
          total: codes.length,
          active: codes.filter((c) => c.status === 'active').length,
          redeemedUses: codes.reduce((a, c) => a + c.uses, 0),
        },
        // Observabilidad del SUBAGENTE 1 (reutilizada, no duplicada).
        system: getSystemMetrics(),
        traffic: getMetricsSnapshot(),
      });
    })
    .catch((err: unknown) => sendError(res, err));
});

export default adminRouter;
