/**
 * SUBAGENTE 3 (pagos): PaymentService.
 *
 * Flujo: intención de compra → validación de webhook (firma, evento, id,
 * monto, moneda, estado) → confirmación idempotente (índice único por
 * `providerTransactionId`: el doble webhook NO duplica acceso) → genera
 * acceso premium (entitlement ligado a `roomId` y/o usuario).
 *
 * REGLA DE ORO: jamás se confía en el frontend para confirmar pagos; solo
 * un webhook con firma válida confirma. La tarjeta está deshabilitada (501)
 * y cualquier campo de tarjeta en el body se rechaza (400).
 */

import { getPlan, amountsEqual } from './plans.js';
import { ServiceError, DuplicateKeyError } from './errors.js';
import {
  CARD_NOT_CONFIGURED_MESSAGE,
  PAYPAL_COMPLETED_EVENT,
  findForbiddenCardField,
  getProvider,
  type PaymentProviderName,
} from './payment-provider.js';
import {
  entitlementStore,
  newId,
  paymentStore,
  type EntitlementRecord,
  type PaymentRecord,
  type PaymentStatus,
} from './payment.store.js';
import { logAudit } from './audit.service.js';

export interface CreateIntentInput {
  provider: string;
  planId: string;
  roomId?: string;
  userId?: string;
  /** Cuerpo crudo para detectar campos de tarjeta prohibidos. */
  rawBody?: unknown;
  actor?: string;
}

export interface CreateIntentResult {
  paymentId: string;
  provider: PaymentProviderName;
  providerOrderId: string;
  approveUrl?: string;
  planId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  stub: boolean;
  message: string;
}

export interface ConfirmResult {
  payment: PaymentRecord;
  entitlement: EntitlementRecord | null;
  duplicate: boolean;
  ignored?: boolean;
  ignoredEvent?: string;
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

function expiryFromNow(durationDays: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + durationDays * 24 * 60 * 60 * 1000);
}

async function failPayment(paymentId: string, reason: string): Promise<void> {
  await paymentStore.setStatus(paymentId, 'failed', reason).catch(() => null);
}

export class PaymentService {
  /** Intención de compra: valida plan/proveedor y crea el pago `pending`. */
  static async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const forbidden = findForbiddenCardField(input.rawBody ?? {});
    if (forbidden) {
      throw new ServiceError(
        400,
        'CARD_DATA_FORBIDDEN',
        `Nunca envíes datos de tarjeta al servidor (campo detectado: ${forbidden}).`
      );
    }

    const plan = getPlan(input.planId ?? '');
    if (!plan) {
      throw new ServiceError(400, 'PLAN_UNKNOWN', `Plan desconocido: ${input.planId ?? '(vacío)'}.`);
    }

    const provider = getProvider(input.provider ?? '');
    if (!provider) {
      throw new ServiceError(400, 'PROVIDER_UNKNOWN', `Proveedor desconocido: ${input.provider ?? '(vacío)'}.`);
    }

    if (provider.name === 'card') {
      throw new ServiceError(501, 'CARD_NOT_CONFIGURED', CARD_NOT_CONFIGURED_MESSAGE);
    }

    const roomId = clean(input.roomId)?.toUpperCase();
    const userId = clean(input.userId);
    if (!roomId && !userId) {
      throw new ServiceError(400, 'SUBJECT_REQUIRED', 'Indica roomId y/o userId para ligar el acceso premium.');
    }

    const internalOrderId = newId('pay');
    const order = await provider.createOrder({
      internalOrderId,
      amount: plan.amount,
      currency: plan.currency,
      description: `${plan.name} — Watch Party`,
      roomId,
      userId,
    });

    const payment = await paymentStore.create({
      id: internalOrderId,
      provider: provider.name,
      providerOrderId: order.providerOrderId,
      providerTransactionId: null,
      planId: plan.id,
      amount: plan.amount,
      currency: plan.currency,
      roomId,
      userId,
      status: 'pending',
      stub: order.stub,
    });

    await logAudit(
      (input.actor ?? userId ?? roomId ?? 'checkout').trim() || 'checkout',
      'payments.checkout',
      `plan=${plan.id} provider=${provider.name} paymentId=${payment.id} stub=${order.stub}`
    );

    return {
      paymentId: payment.id,
      provider: provider.name,
      providerOrderId: order.providerOrderId,
      approveUrl: order.approveUrl,
      planId: plan.id,
      amount: plan.amount,
      currency: plan.currency,
      status: payment.status,
      stub: order.stub,
      message: order.message,
    };
  }

  /**
   * Confirmación desde webhook del proveedor. Idempotente: un segundo
   * webhook con el mismo `providerTransactionId` retorna el acceso ya
   * creado (`duplicate: true`) sin duplicar nada.
   */
  static async confirmFromWebhook(
    providerName: string,
    payload: unknown,
    signature: string | undefined
  ): Promise<ConfirmResult> {
    const provider = getProvider(providerName ?? '');
    if (!provider) {
      throw new ServiceError(400, 'PROVIDER_UNKNOWN', `Proveedor desconocido: ${providerName ?? '(vacío)'}.`);
    }
    if (provider.name === 'card') {
      throw new ServiceError(501, 'CARD_NOT_CONFIGURED', CARD_NOT_CONFIGURED_MESSAGE);
    }

    const verification = provider.verifyWebhook(payload, signature);
    if (!verification.valid) {
      // Intento best-effort de marcar el pago como fallido (si se identifica).
      const parsed = provider.parseWebhook(payload);
      const candidate = parsed?.orderId ? await paymentStore.findByOrderId(parsed.orderId).catch(() => null) : null;
      if (candidate && candidate.status === 'pending') {
        await failPayment(candidate.id, verification.reason ?? 'Firma inválida.');
      }
      await logAudit('webhook', 'payments.webhook-rejected', `${provider.name}: ${verification.reason ?? 'rechazado'}`);
      throw new ServiceError(
        verification.stub ? 502 : 401,
        'WEBHOOK_INVALID_SIGNATURE',
        verification.reason ?? 'Webhook rechazado.'
      );
    }

    const parsed = provider.parseWebhook(payload);
    if (!parsed) {
      throw new ServiceError(400, 'WEBHOOK_MALFORMED', 'Webhook con formato no reconocido.');
    }

    // Eventos que NO confirman fondos (ej. orden aprobada pero no capturada):
    // se acusan como ignorados sin tocar el pago.
    if (parsed.event !== PAYPAL_COMPLETED_EVENT) {
      return {
        payment: (await this.locatePayment(parsed.orderId)) as PaymentRecord,
        entitlement: null,
        duplicate: false,
        ignored: true,
        ignoredEvent: parsed.event,
      };
    }

    if (parsed.status.toUpperCase() !== 'COMPLETED') {
      const payment = await this.locatePaymentOrFail(parsed.orderId);
      await failPayment(payment.id, `Estado de captura no completado: ${parsed.status}.`);
      throw new ServiceError(400, 'WEBHOOK_NOT_COMPLETED', `La captura no está completada (${parsed.status}).`);
    }

    // 1) Idempotencia por transacción: ¿ya se confirmó este cobro?
    const already = await paymentStore.findByProviderTxId(parsed.providerTransactionId);
    if (already?.status === 'completed') {
      const entitlement = await entitlementStore.findByPaymentId(already.id);
      return { payment: already, entitlement, duplicate: true };
    }
    if (already) {
      throw new ServiceError(409, 'TX_CONFLICT', 'La transacción ya está asociada a otro pago.');
    }

    // 2) Localiza el pago por orden (jamás se inventa desde el frontend).
    const payment = await this.locatePaymentOrFail(parsed.orderId);
    if (payment.status === 'completed') {
      const entitlement = await entitlementStore.findByPaymentId(payment.id);
      return { payment, entitlement, duplicate: true };
    }
    if (payment.status !== 'pending') {
      throw new ServiceError(409, 'PAYMENT_NOT_PENDING', `El pago no está pendiente (estado: ${payment.status}).`);
    }

    // 3) Validación de monto, moneda (la firma ya se validó arriba).
    const plan = getPlan(payment.planId);
    if (!plan) {
      await failPayment(payment.id, `Plan del pago desconocido: ${payment.planId}.`);
      throw new ServiceError(500, 'PLAN_UNKNOWN', 'El plan del pago ya no existe.');
    }
    if (!amountsEqual(parsed.amount, payment.amount) || parsed.currency.toUpperCase() !== payment.currency.toUpperCase()) {
      await failPayment(
        payment.id,
        `Monto/moneda del webhook (${parsed.amount} ${parsed.currency}) != esperado (${payment.amount} ${payment.currency}).`
      );
      throw new ServiceError(400, 'WEBHOOK_AMOUNT_MISMATCH', 'El monto o la moneda no coinciden con la intención de compra.');
    }

    // 4) pending→completed atómico (pierde la carrera => es duplicado).
    const now = new Date();
    const completed = await paymentStore.completePending(payment.id, parsed.providerTransactionId, now);
    if (!completed) {
      const winner = await paymentStore.findByProviderTxId(parsed.providerTransactionId);
      if (winner?.status === 'completed') {
        const entitlement = await entitlementStore.findByPaymentId(winner.id);
        return { payment: winner, entitlement, duplicate: true };
      }
      throw new ServiceError(409, 'PAYMENT_NOT_PENDING', 'El pago cambió de estado durante la confirmación.');
    }

    // 5) Genera el acceso premium (un pago => un acceso; índice único).
    let entitlement: EntitlementRecord | null = null;
    try {
      entitlement = await entitlementStore.create({
        userId: completed.userId,
        roomId: completed.roomId,
        planId: plan.id,
        paymentId: completed.id,
        grantedAt: now,
        expiresAt: expiryFromNow(plan.durationDays, now),
        active: true,
      });
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        entitlement = await entitlementStore.findByPaymentId(completed.id);
        await logAudit('webhook', 'payments.confirmed', `paymentId=${completed.id} duplicate=true (carrera)`);
        return { payment: completed, entitlement, duplicate: true };
      }
      throw err;
    }

    await logAudit(
      'webhook',
      'payments.confirmed',
      `paymentId=${completed.id} tx=${parsed.providerTransactionId} plan=${plan.id} entitlementId=${entitlement.id}`
    );
    return { payment: completed, entitlement, duplicate: false };
  }

  private static async locatePayment(orderId?: string): Promise<PaymentRecord | null> {
    if (!orderId) return null;
    const byOrder = await paymentStore.findByOrderId(orderId).catch(() => null);
    if (byOrder) return byOrder;
    return paymentStore.findById(orderId).catch(() => null);
  }

  private static async locatePaymentOrFail(orderId?: string): Promise<PaymentRecord> {
    const payment = await this.locatePayment(orderId);
    if (!payment) {
      throw new ServiceError(404, 'PAYMENT_UNKNOWN_ORDER', 'La orden del webhook no corresponde a ningún pago.');
    }
    return payment;
  }

  static async getPaymentById(paymentId: string): Promise<PaymentRecord | null> {
    return paymentStore.findById(paymentId);
  }

  static async listPayments(filters: {
    status?: PaymentStatus;
    provider?: string;
    search?: string;
    limit?: number;
  }): Promise<PaymentRecord[]> {
    return paymentStore.list(filters);
  }

  static async paymentsSummary(): Promise<{ total: number; byStatus: Record<string, number> }> {
    const byStatus = await paymentStore.countByStatus();
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return { total, byStatus };
  }

  static async getEntitlements(filter: { userId?: string; roomId?: string }): Promise<EntitlementRecord[]> {
    const userId = clean(filter.userId);
    const roomId = clean(filter.roomId)?.toUpperCase();
    if (!userId && !roomId) {
      throw new ServiceError(400, 'SUBJECT_REQUIRED', 'Indica userId y/o roomId.');
    }
    return entitlementStore.findActive({ userId, roomId });
  }

  /**
   * Reembolso administrativo (marca local; NO mueve dinero real: sin
   * credenciales de captura no hay API de refunds). Queda auditado.
   */
  static async refundPayment(paymentId: string, actor: string): Promise<PaymentRecord> {
    const payment = await paymentStore.findById(paymentId);
    if (!payment) throw new ServiceError(404, 'PAYMENT_NOT_FOUND', 'Pago no encontrado.');
    if (payment.status !== 'completed') {
      throw new ServiceError(409, 'REFUND_NOT_ALLOWED', `Solo se reembolsan pagos completados (estado: ${payment.status}).`);
    }
    const updated = await paymentStore.setStatus(paymentId, 'refunded');
    if (!updated) throw new ServiceError(404, 'PAYMENT_NOT_FOUND', 'Pago no encontrado.');
    await logAudit(actor, 'payments.refunded', `paymentId=${paymentId} tx=${payment.providerTransactionId ?? '-'}`);
    return updated;
  }
}
