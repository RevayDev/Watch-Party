/**
 * SUBAGENTE 3 (pagos): idempotencia, validación de webhook, canje y audit.
 * Corre en memoria (sin Mongo): `resetPaymentsMemoryStores()` aísla cada test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { PaymentService } from '../src/payments/payment.service.js';
import { GiftCodeService, isGiftCodeFormat } from '../src/payments/gift-code.service.js';
import { getPremiumPlan } from '../src/config/plans.js';
import { listAuditLogs } from '../src/payments/audit.service.js';
import { resetPaymentsMemoryStores } from '../src/payments/payment.store.js';
import { computePaypalSignature } from '../src/payments/payment-provider.js';
import { paymentsRouter } from '../src/routes/payments.routes.js';
import { adminRouter } from '../src/routes/admin.routes.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

process.env.PAYPAL_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.ADMIN_TOKEN = 'test-admin-token';

const ADMIN_HEADERS = { 'x-admin-token': 'test-admin-token', 'Content-Type': 'application/json' };

function sign(event: string, tx: string, amount: number, currency: string): string {
  return computePaypalSignature(process.env.PAYPAL_WEBHOOK_SECRET as string, {
    event,
    providerTransactionId: tx,
    amount,
    currency,
  });
}

function webhookBody(orderId: string, tx: string, amount?: number, currency?: string, status = 'COMPLETED') {
  const premium = getPremiumPlan();
  return {
    event: 'PAYMENT.CAPTURE.COMPLETED',
    providerTransactionId: tx,
    orderId,
    amount: amount ?? premium.priceCop,
    currency: currency ?? premium.currency,
    status,
  };
}

async function checkout(userId = 'user-1', roomId = 'ABC123') {
  return PaymentService.createIntent({ provider: 'paypal', planId: 'PREMIUM_ROOM', userId, roomId });
}

beforeEach(() => {
  resetPaymentsMemoryStores();
  backupRoomsFile();
});

afterAll(async () => {
  await restoreRoomsFile();
});

describe('checkout', () => {
  it('crea intención pending en modo stub (sin credenciales PayPal)', async () => {
    const intent = await checkout();
    const premium = getPremiumPlan();
    expect(intent.status).toBe('pending');
    expect(intent.stub).toBe(true);
    expect(intent.providerOrderId).toContain('STUB-PP-');
    expect(intent.amount).toBe(premium.priceCop);
    expect(intent.currency).toBe(premium.currency);
  });

  it('rechaza plan desconocido y proveedor desconocido', async () => {
    await expect(checkout('u', 'R1').then(() => PaymentService.createIntent({
      provider: 'paypal', planId: 'NOPE', userId: 'u',
    }))).rejects.toMatchObject({ statusCode: 400, code: 'PLAN_UNKNOWN' });
    await expect(PaymentService.createIntent({ provider: 'nope', planId: 'PREMIUM_ROOM', userId: 'u' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'PROVIDER_UNKNOWN' });
  });

  it('tarjeta: 501 sin crear pagos + rechaza campos de tarjeta', async () => {
    await expect(PaymentService.createIntent({ provider: 'card', planId: 'PREMIUM_ROOM', userId: 'u' }))
      .rejects.toMatchObject({ statusCode: 501, code: 'CARD_NOT_CONFIGURED' });
    await expect(PaymentService.createIntent({
      provider: 'paypal', planId: 'PREMIUM_ROOM', userId: 'u', rawBody: { cardNumber: '4111', cvv: '123' },
    })).rejects.toMatchObject({ statusCode: 400, code: 'CARD_DATA_FORBIDDEN' });
  });
});

describe('webhook paypal', () => {
  it('firma válida confirma y genera UN acceso premium', async () => {
    const intent = await checkout('user-7', 'ROOM7A');
    const body = webhookBody(intent.providerOrderId, 'TX-1');
    const result = await PaymentService.confirmFromWebhook('paypal', body, sign(body.event, body.providerTransactionId, body.amount, body.currency));
    expect(result.payment.status).toBe('completed');
    expect(result.duplicate).toBe(false);
    expect(result.entitlement?.roomId).toBe('ROOM7A');
    expect(result.entitlement?.planId).toBe('PREMIUM_ROOM');
    expect(new Date(result.entitlement?.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('doble webhook NO duplica acceso (idempotencia por providerTransactionId)', async () => {
    const intent = await checkout('user-8', 'ROOM8A');
    const body = webhookBody(intent.providerOrderId, 'TX-DUP');
    const sig = sign(body.event, body.providerTransactionId, body.amount, body.currency);
    const first = await PaymentService.confirmFromWebhook('paypal', body, sig);
    const second = await PaymentService.confirmFromWebhook('paypal', body, sig);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    expect(second.entitlement?.id).toBe(first.entitlement?.id);
    const mine = await PaymentService.getEntitlements({ userId: 'user-8' });
    expect(mine).toHaveLength(1);
  });

  it('firma inválida se rechaza y NO genera acceso', async () => {
    const intent = await checkout('user-9', 'ROOM9A');
    const body = webhookBody(intent.providerOrderId, 'TX-BAD');
    await expect(PaymentService.confirmFromWebhook('paypal', body, 'firma-falsa'))
      .rejects.toMatchObject({ statusCode: 401, code: 'WEBHOOK_INVALID_SIGNATURE' });
    const mine = await PaymentService.getEntitlements({ userId: 'user-9' });
    expect(mine).toHaveLength(0);
  });

  it('monto distinto al esperado se rechaza (400) y marca failed', async () => {
    const intent = await checkout('user-10', 'ROOM10');
    const body = webhookBody(intent.providerOrderId, 'TX-AMT', 1, 'COP');
    await expect(
      PaymentService.confirmFromWebhook('paypal', body, sign(body.event, body.providerTransactionId, body.amount, body.currency))
    ).rejects.toMatchObject({ statusCode: 400, code: 'WEBHOOK_AMOUNT_MISMATCH' });
    const payment = await PaymentService.getPaymentById(intent.paymentId);
    expect(payment?.status).toBe('failed');
    expect(await PaymentService.getEntitlements({ userId: 'user-10' })).toHaveLength(0);
  });

  it('evento no-completado se ignora sin confirmar', async () => {
    const intent = await checkout('user-11', 'ROOM11');
    const body = { ...webhookBody(intent.providerOrderId, 'TX-IGN'), event: 'CHECKOUT.ORDER.APPROVED' };
    const result = await PaymentService.confirmFromWebhook(
      'paypal', body, sign(body.event, body.providerTransactionId, body.amount, body.currency)
    );
    expect(result.ignored).toBe(true);
    const payment = await PaymentService.getPaymentById(intent.paymentId);
    expect(payment?.status).toBe('pending');
  });

  it('orden desconocida → 404 (jamás se inventa desde el frontend)', async () => {
    const body = webhookBody('STUB-PP-pay_fantasma', 'TX-GHOST');
    await expect(
      PaymentService.confirmFromWebhook('paypal', body, sign(body.event, body.providerTransactionId, body.amount, body.currency))
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_UNKNOWN_ORDER' });
  });
});

describe('gift codes', () => {
  it('crea con formato WATCH-XXXX-XXXX y canjea idempotente por sujeto', async () => {
    const code = await GiftCodeService.createGiftCode({ type: 'PREMIUM_ROOM', maxUses: 2, createdBy: 'admin-test' });
    expect(isGiftCodeFormat(code.code)).toBe(true);

    const first = await GiftCodeService.redeem({ code: code.code, userId: 'g-user-1' });
    expect(first.duplicate).toBe(false);
    expect(first.entitlement.planId).toBe('PREMIUM_ROOM');

    const again = await GiftCodeService.redeem({ code: code.code, userId: 'g-user-1' });
    expect(again.duplicate).toBe(true);
    expect(again.entitlement.id).toBe(first.entitlement.id);
    expect((await GiftCodeService.getGiftCode(code.code))?.uses).toBe(1);

    await GiftCodeService.redeem({ code: code.code, userId: 'g-user-2' });
    expect((await GiftCodeService.getGiftCode(code.code))?.uses).toBe(2);
    await expect(GiftCodeService.redeem({ code: code.code, userId: 'g-user-3' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'GIFT_EXHAUSTED' });
  });

  it('código desactivado o con formato malo se rechaza', async () => {
    const code = await GiftCodeService.createGiftCode({ type: 'FREE_ROOM', createdBy: 'admin-test' });
    await GiftCodeService.disableGiftCode(code.code, 'admin-test');
    await expect(GiftCodeService.redeem({ code: code.code, userId: 'x' }))
      .rejects.toMatchObject({ statusCode: 410, code: 'GIFT_DISABLED' });
    await expect(GiftCodeService.redeem({ code: 'MALO', userId: 'x' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'GIFT_FORMAT_INVALID' });
  });

  it('borrar código usado → 409; sin usos se borra', async () => {
    const used = await GiftCodeService.createGiftCode({ type: 'FREE_ROOM', createdBy: 'admin-test' });
    await GiftCodeService.redeem({ code: used.code, userId: 'del-user' });
    await expect(GiftCodeService.deleteGiftCode(used.code, 'admin-test'))
      .rejects.toMatchObject({ statusCode: 409, code: 'GIFT_DELETE_USED' });
    const fresh = await GiftCodeService.createGiftCode({ type: 'FREE_ROOM', createdBy: 'admin-test' });
    await GiftCodeService.deleteGiftCode(fresh.code, 'admin-test');
    expect(await GiftCodeService.getGiftCode(fresh.code)).toBeNull();
  });
});

describe('audit + refund', () => {
  it('registra checkout, confirmación, canje y reembolso', async () => {
    const intent = await checkout('audit-u', 'AUDIT1');
    const body = webhookBody(intent.providerOrderId, 'TX-AUD');
    await PaymentService.confirmFromWebhook('paypal', body, sign(body.event, body.providerTransactionId, body.amount, body.currency));
    const code = await GiftCodeService.createGiftCode({ type: 'FREE_ROOM', createdBy: 'audit-admin' });
    await GiftCodeService.redeem({ code: code.code, userId: 'audit-u' });
    await PaymentService.refundPayment(intent.paymentId, 'audit-admin');

    const confirmed = await listAuditLogs({ action: 'payments.confirmed' });
    const redeemed = await listAuditLogs({ action: 'gift-codes.redeemed' });
    const refunded = await listAuditLogs({ action: 'payments.refunded' });
    expect(confirmed.length).toBeGreaterThanOrEqual(1);
    expect(redeemed.length).toBeGreaterThanOrEqual(1);
    expect(refunded).toHaveLength(1);
    expect(refunded[0]?.actor).toBe('audit-admin');
    expect(refunded[0]?.createdAt instanceof Date).toBe(true);
  });

  it('reembolsar dos veces o sin completar → 409', async () => {
    const intent = await checkout('audit-u2', 'AUDIT2');
    await expect(PaymentService.refundPayment(intent.paymentId, 'admin'))
      .rejects.toMatchObject({ statusCode: 409, code: 'REFUND_NOT_ALLOWED' });
    const body = webhookBody(intent.providerOrderId, 'TX-AUD2');
    await PaymentService.confirmFromWebhook('paypal', body, sign(body.event, body.providerTransactionId, body.amount, body.currency));
    await PaymentService.refundPayment(intent.paymentId, 'admin');
    await expect(PaymentService.refundPayment(intent.paymentId, 'admin'))
      .rejects.toMatchObject({ statusCode: 409, code: 'REFUND_NOT_ALLOWED' });
  });
});

describe('routers HTTP (payloads exactos)', () => {
  async function startApp(): Promise<{ base: string; close: () => Promise<void> }> {
    const app = express();
    app.use(express.json());
    app.use('/api/payments', paymentsRouter);
    app.use('/api/admin', adminRouter);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return {
      base: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
    };
  }

  it('checkout → webhook → my-entitlements + admin con/sin token', async () => {
    const { base, close } = await startApp();
    try {
      const checkoutRes = await fetch(`${base}/api/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'paypal', plan: 'PREMIUM_ROOM', roomId: 'HTTP1', userId: 'http-u' }),
      });
      expect(checkoutRes.status).toBe(201);
      const intent = (await checkoutRes.json()) as { providerOrderId: string; paymentId: string; stub: boolean };
      expect(intent.stub).toBe(true);

      const body = webhookBody(intent.providerOrderId, 'TX-HTTP');
      const hookRes = await fetch(`${base}/api/payments/paypal/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sign(body.event, body.providerTransactionId, body.amount, body.currency) },
        body: JSON.stringify(body),
      });
      expect(hookRes.status).toBe(200);

      const entRes = await fetch(`${base}/api/payments/my-entitlements?userId=http-u`);
      expect(entRes.status).toBe(200);
      expect(((await entRes.json()) as { entitlements: unknown[] }).entitlements).toHaveLength(1);

      const noAuth = await fetch(`${base}/api/admin/summary`);
      expect(noAuth.status).toBe(401);

      const summary = await fetch(`${base}/api/admin/summary`, { headers: ADMIN_HEADERS });
      expect(summary.status).toBe(200);
      const summaryJson = (await summary.json()) as { payments: { byStatus: Record<string, number> } };
      expect(summaryJson.payments.byStatus.completed).toBeGreaterThanOrEqual(1);

      const roomsAnon = await fetch(`${base}/api/admin/rooms`, { headers: ADMIN_HEADERS });
      expect(roomsAnon.status).toBe(200);

      const cardHook = await fetch(`${base}/api/payments/card/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(cardHook.status).toBe(501);
    } finally {
      await close();
    }
  });

  it('admin gift-codes CRUD por HTTP', async () => {
    const { base, close } = await startApp();
    try {
      const created = await fetch(`${base}/api/admin/gift-codes`, {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ type: 'FREE_ROOM', maxUses: 1 }),
      });
      expect(created.status).toBe(201);
      const { code } = (await created.json()) as { code: { code: string } };

      const redeem = await fetch(`${base}/api/payments/gift-codes/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.code, userId: 'http-gift-u' }),
      });
      expect(redeem.status).toBe(200);

      const disable = await fetch(`${base}/api/admin/gift-codes/${code.code}/disable`, {
        method: 'PATCH',
        headers: ADMIN_HEADERS,
      });
      expect(disable.status).toBe(200);

      const audit = await fetch(`${base}/api/admin/audit?action=gift-codes.created`, { headers: ADMIN_HEADERS });
      expect(audit.status).toBe(200);
      expect(((await audit.json()) as { entries: unknown[] }).entries.length).toBeGreaterThanOrEqual(1);
    } finally {
      await close();
    }
  });
});
