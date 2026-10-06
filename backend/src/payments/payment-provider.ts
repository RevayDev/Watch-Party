/**
 * SUBAGENTE 3 (pagos): proveedores de pago.
 *
 * - `PaymentProvider`: interfaz hexagonal (crear orden + validar webhook).
 * - `PaypalProvider`: estructura sandbox-ready SIN credenciales reales. Si
 *   faltan `PAYPAL_CLIENT_ID/SECRET` opera en modo stub (lo indica en cada
 *   respuesta, nunca confirma pagos). La validación de webhook es HMAC-SHA256
 *   sobre `${event}|${providerTransactionId}|${amount}|${currency}` con
 *   `PAYPAL_WEBHOOK_SECRET`; si falta el secreto, el webhook se RECHAZA
 *   (modo stub que lo indica, jamás auto-confirma).
 * - `CardProvider`: stub "no configurado" (tarjeta futura para Colombia).
 *   JAMÁS se guardan tarjetas/CVV: el checkout rechaza cualquier campo de
 *   tarjeta (ver `FORBIDDEN_CARD_FIELDS` + PaymentService).
 */

import crypto from 'node:crypto';

export type PaymentProviderName = 'paypal' | 'card';

export interface CreateOrderInput {
  /** Id interno del pago (`pay_...`) para correlación (custom_id). */
  internalOrderId: string;
  amount: number;
  currency: string;
  description: string;
  roomId?: string;
  userId?: string;
}

export interface CreateOrderResult {
  provider: PaymentProviderName;
  providerOrderId: string;
  approveUrl?: string;
  stub: boolean;
  message: string;
}

export interface WebhookVerification {
  valid: boolean;
  stub: boolean;
  reason?: string;
}

/** Webhook ya normalizado (independiente del formato del proveedor). */
export interface NormalizedWebhook {
  event: string;
  providerTransactionId: string;
  orderId?: string;
  amount: number;
  currency: string;
  status: string;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** true cuando NO hay credenciales reales (solo stub informativo). */
  readonly isStub: boolean;
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  verifyWebhook(payload: unknown, signature: string | undefined): WebhookVerification;
  parseWebhook(payload: unknown): NormalizedWebhook | null;
}

/** Campos de tarjeta que JAMÁS deben llegar al servidor. */
export const FORBIDDEN_CARD_FIELDS = [
  'cardNumber',
  'card_number',
  'pan',
  'cvv',
  'cvc',
  'cvv2',
  'cvc2',
  'expiry',
  'cardExpiry',
  'expMonth',
  'expYear',
  'cardExp',
] as const;

export function findForbiddenCardField(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const keys = new Set(Object.keys(body as Record<string, unknown>).map((k) => k.toLowerCase()));
  for (const field of FORBIDDEN_CARD_FIELDS) {
    if (keys.has(field.toLowerCase())) return field;
  }
  return null;
}

/** Evento que confirma captura de fondos (único que genera acceso). */
export const PAYPAL_COMPLETED_EVENT = 'PAYMENT.CAPTURE.COMPLETED';

function paypalEnv(): { clientId?: string; clientSecret?: string; webhookSecret?: string; mode: 'sandbox' | 'live' } {
  const pick = (v: string | undefined): string | undefined => {
    const t = (v ?? '').trim();
    return t ? t : undefined;
  };
  return {
    clientId: pick(process.env.PAYPAL_CLIENT_ID),
    clientSecret: pick(process.env.PAYPAL_CLIENT_SECRET),
    webhookSecret: pick(process.env.PAYPAL_WEBHOOK_SECRET),
    mode: (process.env.PAYPAL_MODE ?? '').trim().toLowerCase() === 'live' ? 'live' : 'sandbox',
  };
}

function paypalApiBase(mode: 'sandbox' | 'live'): string {
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

/**
 * Firma HMAC-SHA256 del webhook (hex). Esquema simplificado y documentado
 * para sandbox: NO es la verificación oficial por cabeceras de transmisión
 * PayPal (esa exige cuerpo crudo + `verify-webhook-signature`); cuando se
 * activen credenciales reales, este método es el punto único a endurecer.
 */
export function computePaypalSignature(
  secret: string,
  parts: { event: string; providerTransactionId: string; amount: number; currency: string }
): string {
  const canonical = `${parts.event}|${parts.providerTransactionId}|${parts.amount}|${parts.currency}`;
  return crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : (value as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim();
  }
  return undefined;
}

export class PaypalProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'paypal';

  /** Stub si faltan client id/secret (se evalúa en cada llamada: testeable). */
  get isStub(): boolean {
    const { clientId, clientSecret } = paypalEnv();
    return !clientId || !clientSecret;
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const { clientId, clientSecret, mode } = paypalEnv();
    if (!clientId || !clientSecret) {
      return {
        provider: 'paypal',
        providerOrderId: `STUB-PP-${input.internalOrderId}`,
        stub: true,
        message:
          'PayPal no configurado (faltan PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET): orden local en modo stub. ' +
          'Configura las credenciales sandbox para emitir órdenes reales.',
      };
    }
    // ── Ruta real sandbox-ready (solo con credenciales) ──
    const token = await this.fetchAccessToken(clientId, clientSecret, mode);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(`${paypalApiBase(mode)}/v2/checkout/orders`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [
            {
              custom_id: input.internalOrderId,
              description: input.description,
              amount: {
                currency_code: input.currency,
                value: input.amount.toFixed(2),
              },
            },
          ],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`PayPal Orders API respondió HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as { id?: string; links?: Array<{ rel?: string; href?: string }> };
      if (!data?.id) throw new Error('PayPal no devolvió id de orden.');
      const approveUrl = data.links?.find((l) => l.rel === 'approve')?.href;
      return {
        provider: 'paypal',
        providerOrderId: data.id,
        approveUrl,
        stub: false,
        message: 'Orden PayPal creada (sandbox).',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchAccessToken(clientId: string, clientSecret: string, mode: 'sandbox' | 'live'): Promise<string> {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(`${paypalApiBase(mode)}/v1/oauth2/token`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) throw new Error(`PayPal OAuth respondió HTTP ${res.status}.`);
      const data = (await res.json()) as { access_token?: string };
      if (!data?.access_token) throw new Error('PayPal no devolvió access_token.');
      return data.access_token;
    } finally {
      clearTimeout(timer);
    }
  }

  verifyWebhook(payload: unknown, signature: string | undefined): WebhookVerification {
    const { webhookSecret } = paypalEnv();
    if (!webhookSecret) {
      return {
        valid: false,
        stub: true,
        reason:
          'PAYPAL_WEBHOOK_SECRET ausente: modo stub, webhook rechazado. ' +
          'Configura el secreto para validar firmas (jamás se auto-confirma).',
      };
    }
    const parsed = this.parseWebhook(payload);
    if (!parsed) {
      return { valid: false, stub: false, reason: 'Webhook con formato no reconocido.' };
    }
    if (!signature || signature.trim() === '') {
      return { valid: false, stub: false, reason: 'Falta la firma del webhook.' };
    }
    const expected = computePaypalSignature(webhookSecret, {
      event: parsed.event,
      providerTransactionId: parsed.providerTransactionId,
      amount: parsed.amount,
      currency: parsed.currency,
    });
    if (!safeEqualHex(signature.trim().toLowerCase(), expected.toLowerCase())) {
      return { valid: false, stub: false, reason: 'Firma del webhook inválida.' };
    }
    return { valid: true, stub: false };
  }

  /**
   * Acepta el formato real PayPal (`event_type` + `resource`) y un formato
   * plano de pruebas (`event`, `providerTransactionId`, `orderId`, `amount`,
   * `currency`, `status`). Retorna null si es irreconocible.
   */
  parseWebhook(payload: unknown): NormalizedWebhook | null {
    if (!payload || typeof payload !== 'object') return null;
    const body = payload as Record<string, unknown>;

    // Formato real PayPal.
    const eventType = body['event_type'];
    if (typeof eventType === 'string' && body['resource'] && typeof body['resource'] === 'object') {
      const resource = body['resource'] as Record<string, unknown>;
      const amountObj = resource['amount'] as { value?: unknown; currency_code?: unknown } | undefined;
      const amount = toFiniteNumber(amountObj?.value);
      const currency = typeof amountObj?.currency_code === 'string' ? amountObj.currency_code : undefined;
      const txId = pickString(resource['id']);
      const supplementary = resource['supplementary_data'] as { related_ids?: { order_id?: unknown } } | undefined;
      const orderId = pickString(
        resource['custom_id'],
        supplementary?.related_ids?.order_id,
        body['orderId'],
        body['orderID']
      );
      const status = pickString(resource['status'], 'UNKNOWN');
      if (!txId || amount === null || !currency || !status) return null;
      return { event: eventType, providerTransactionId: txId, orderId, amount, currency, status };
    }

    // Formato plano (tests / reenvíos internos controlados).
    const event = pickString(body['event']);
    const txId = pickString(body['providerTransactionId'], body['transactionId'], body['captureId']);
    const amount = toFiniteNumber(body['amount']);
    const currency = pickString(body['currency']);
    const status = pickString(body['status']) ?? 'UNKNOWN';
    const orderId = pickString(body['orderId'], body['orderID'], body['providerOrderId'], body['custom_id']);
    if (!event || !txId || amount === null || !currency) return null;
    return { event, providerTransactionId: txId, orderId, amount, currency, status };
  }
}

export const CARD_NOT_CONFIGURED_MESSAGE =
  'Pago con tarjeta no configurado (integración futura para Colombia). Usa PayPal o un código de regalo.';

/** Stub de tarjeta futura: nunca emite órdenes ni valida webhooks. */
export class CardProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'card';
  readonly isStub = true;

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    return {
      provider: 'card',
      providerOrderId: `STUB-CARD-${input.internalOrderId}`,
      stub: true,
      message: CARD_NOT_CONFIGURED_MESSAGE,
    };
  }

  verifyWebhook(_payload: unknown, _signature: string | undefined): WebhookVerification {
    return { valid: false, stub: true, reason: CARD_NOT_CONFIGURED_MESSAGE };
  }

  parseWebhook(_payload: unknown): NormalizedWebhook | null {
    return null;
  }
}

const paypalProvider = new PaypalProvider();
const cardProvider = new CardProvider();

export function getProvider(name: string): PaymentProvider | null {
  const normalized = (name ?? '').trim().toLowerCase();
  if (normalized === 'paypal') return paypalProvider;
  if (normalized === 'card') return cardProvider;
  return null;
}
