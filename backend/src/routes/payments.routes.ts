/**
 * SUBAGENTE 3 (pagos): router público de pagos.
 *
 * SOLO SE EXPORTA — no se monta aquí (lo monta el coordinador en `app.ts`).
 *
 * - POST /checkout            → intención de compra { provider, plan, roomId?, userId? }
 * - POST /paypal/webhook      → confirmación solo por webhook firmado
 * - POST /card/webhook        → 501 (tarjeta no configurada)
 * - POST /gift-codes/redeem   → canje { code, userId?, roomId? }
 * - GET  /my-entitlements     → accesos activos ?userId=&roomId=
 */

import { Router, type Request, type Response } from 'express';
import { PaymentService } from '../payments/payment.service.js';
import { GiftCodeService } from '../payments/gift-code.service.js';
import { toServiceError } from '../payments/errors.js';
import { listPlans } from '../payments/plans.js';
import {
  checkoutLimiter,
  redeemLimiter,
  webhookLimiter,
} from '../middleware/rate-limit.middleware.js';

export const paymentsRouter = Router();

function sendError(res: Response, err: unknown): void {
  const svc = toServiceError(err);
  res.status(svc.statusCode).json({ error: svc.message, code: svc.code });
}

function webhookSignature(req: Request): string | undefined {
  const pick = (name: string): string | undefined => {
    const raw = req.headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };
  const fromHeader =
    pick('x-webhook-signature') ?? pick('x-paypal-signature') ?? pick('x-paypal-transmission-sig');
  if (fromHeader) return fromHeader;
  const body = (req.body ?? {}) as { signature?: unknown };
  return typeof body.signature === 'string' && body.signature.trim() !== '' ? body.signature.trim() : undefined;
}

/** Intención de compra. NUNCA confirma pagos (solo crea el `pending`). */
paymentsRouter.post('/checkout', checkoutLimiter, (req, res) => {
  const body = (req.body ?? {}) as {
    provider?: unknown;
    plan?: unknown;
    roomId?: unknown;
    userId?: unknown;
  };
  PaymentService.createIntent({
    provider: typeof body.provider === 'string' ? body.provider : 'paypal',
    planId: typeof body.plan === 'string' ? body.plan : '',
    roomId: typeof body.roomId === 'string' ? body.roomId : undefined,
    userId: typeof body.userId === 'string' ? body.userId : undefined,
    rawBody: req.body,
  })
    .then((intent) => res.status(201).json(intent))
    .catch((err: unknown) => sendError(res, err));
});

/** Webhook PayPal: la ÚNICA vía de confirmación (firma obligatoria). */
paymentsRouter.post('/paypal/webhook', webhookLimiter, (req, res) => {
  PaymentService.confirmFromWebhook('paypal', req.body, webhookSignature(req))
    .then((result) => {
      if (result.ignored) {
        res.json({ ok: true, ignored: true, event: result.ignoredEvent ?? null });
        return;
      }
      res.json({
        ok: true,
        paymentId: result.payment.id,
        status: result.payment.status,
        duplicate: result.duplicate,
        entitlementId: result.entitlement?.id ?? null,
      });
    })
    .catch((err: unknown) => sendError(res, err));
});

/** Webhook de tarjeta: integración futura (siempre 501, sin guardar nada). */
paymentsRouter.post('/card/webhook', (_req, res) => {
  res.status(501).json({
    error: 'Pago con tarjeta no configurado (integración futura para Colombia).',
    code: 'CARD_NOT_CONFIGURED',
  });
});

/** Canje de código de regalo (idempotente por sujeto). */
paymentsRouter.post('/gift-codes/redeem', redeemLimiter, (req, res) => {
  const body = (req.body ?? {}) as { code?: unknown; userId?: unknown; roomId?: unknown };
  GiftCodeService.redeem({
    code: typeof body.code === 'string' ? body.code : '',
    userId: typeof body.userId === 'string' ? body.userId : undefined,
    roomId: typeof body.roomId === 'string' ? body.roomId : undefined,
  })
    .then(({ entitlement, duplicate }) => res.json({ entitlement, duplicate }))
    .catch((err: unknown) => sendError(res, err));
});

/** Accesos premium activos del sujeto. */
paymentsRouter.get('/my-entitlements', (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const roomId = typeof req.query.roomId === 'string' ? req.query.roomId : undefined;
  PaymentService.getEntitlements({ userId, roomId })
    .then((entitlements) => res.json({ entitlements }))
    .catch((err: unknown) => sendError(res, err));
});

/** Catálogo público de planes (precios y duración, sin secretos). */
paymentsRouter.get('/plans', (_req, res) => {
  res.json({ plans: listPlans() });
});

export default paymentsRouter;
