/**
 * SUBAGENTE 3 (pagos): GiftCodeService.
 *
 * Formato `WATCH-XXXX-XXXX`, tipos (FREE_ROOM, PREMIUM_ROOM, días),
 * expiración, maxUsos/usos, estado, activación; canje idempotente (el mismo
 * sujeto que re-canjea recibe el MISMO acceso sin consumir otro uso).
 */

import crypto from 'node:crypto';
import { ServiceError } from './errors.js';
import {
  entitlementStore,
  giftCodeStore,
  type EntitlementRecord,
  type GiftCodeRecord,
  type GiftCodeType,
} from './payment.store.js';
import { logAudit } from './audit.service.js';

export const GIFT_CODE_PREFIX = 'WATCH';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I (legibilidad)

const GIFT_TYPES: GiftCodeType[] = ['FREE_ROOM', 'PREMIUM_ROOM'];

const DEFAULT_DURATION_DAYS: Record<GiftCodeType, number> = {
  FREE_ROOM: 7,
  PREMIUM_ROOM: 30,
};

function randomSegment(length = 4): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function formatGiftCode(a: string, b: string): string {
  return `${GIFT_CODE_PREFIX}-${a}-${b}`;
}

export function isGiftCodeFormat(code: string): boolean {
  return /^WATCH-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test((code ?? '').toUpperCase().trim());
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

export interface CreateGiftCodeInput {
  type: string;
  durationDays?: number;
  maxUses?: number;
  /** Días desde hoy hasta la expiración (omitido = sin expiración). */
  expiresInDays?: number;
  createdBy?: string;
}

export interface RedeemInput {
  code: string;
  userId?: string;
  roomId?: string;
}

export interface RedeemResult {
  entitlement: EntitlementRecord;
  code: GiftCodeRecord;
  duplicate: boolean;
}

export class GiftCodeService {
  /** Genera un código único con reintentos ante colisión. */
  static async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = formatGiftCode(randomSegment(), randomSegment());
      const exists = await giftCodeStore.findByCode(code).catch(() => null);
      if (!exists) return code;
    }
    throw new ServiceError(500, 'CODE_GENERATION_FAILED', 'No se pudo generar un código único.');
  }

  static async createGiftCode(input: CreateGiftCodeInput): Promise<GiftCodeRecord> {
    const type = (input.type ?? '').trim().toUpperCase() as GiftCodeType;
    if (!GIFT_TYPES.includes(type)) {
      throw new ServiceError(400, 'GIFT_TYPE_UNKNOWN', `Tipo desconocido: ${input.type ?? '(vacío)'}.`);
    }
    const durationDays = input.durationDays ?? DEFAULT_DURATION_DAYS[type];
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
      throw new ServiceError(400, 'GIFT_DURATION_INVALID', 'durationDays debe ser entero entre 1 y 365.');
    }
    const maxUses = input.maxUses ?? 1;
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) {
      throw new ServiceError(400, 'GIFT_MAXUSES_INVALID', 'maxUses debe ser entero entre 1 y 1000.');
    }
    let expiresAt: Date | undefined;
    if (input.expiresInDays !== undefined) {
      if (!Number.isFinite(input.expiresInDays) || input.expiresInDays < 0 || input.expiresInDays > 730) {
        throw new ServiceError(400, 'GIFT_EXPIRY_INVALID', 'expiresInDays debe estar entre 0 y 730.');
      }
      expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    }

    const actor = clean(input.createdBy) ?? 'admin';
    const code = await this.generateUniqueCode();
    const record = await giftCodeStore.create({
      code,
      type,
      durationDays,
      maxUses,
      expiresAt,
      status: 'active',
      createdBy: actor,
    });
    await logAudit(actor, 'gift-codes.created', `code=${code} type=${type} days=${durationDays} maxUses=${maxUses}`);
    return record;
  }

  static async getGiftCode(code: string): Promise<GiftCodeRecord | null> {
    return giftCodeStore.findByCode(code);
  }

  static async listGiftCodes(): Promise<GiftCodeRecord[]> {
    return giftCodeStore.list();
  }

  static async disableGiftCode(code: string, actor: string): Promise<GiftCodeRecord> {
    const record = await giftCodeStore.findByCode(code);
    if (!record) throw new ServiceError(404, 'GIFT_UNKNOWN', 'Código no encontrado.');
    const updated = await giftCodeStore.disable(code);
    if (!updated) throw new ServiceError(404, 'GIFT_UNKNOWN', 'Código no encontrado.');
    await logAudit(actor, 'gift-codes.disabled', `code=${updated.code} uses=${updated.uses}/${updated.maxUses}`);
    return updated;
  }

  static async deleteGiftCode(code: string, actor: string): Promise<void> {
    const record = await giftCodeStore.findByCode(code);
    if (!record) throw new ServiceError(404, 'GIFT_UNKNOWN', 'Código no encontrado.');
    if (record.uses > 0) {
      throw new ServiceError(409, 'GIFT_DELETE_USED', 'No se puede borrar un código ya usado (desactívalo).');
    }
    await giftCodeStore.remove(code);
    await logAudit(actor, 'gift-codes.deleted', `code=${record.code}`);
  }

  /**
   * Canje idempotente: si el mismo sujeto (userId o roomId) ya canjeó este
   * código, retorna el MISMO acceso sin consumir otro uso.
   */
  static async redeem(input: RedeemInput): Promise<RedeemResult> {
    const code = (input.code ?? '').toUpperCase().trim();
    if (!isGiftCodeFormat(code)) {
      throw new ServiceError(400, 'GIFT_FORMAT_INVALID', 'Formato inválido (esperado WATCH-XXXX-XXXX).');
    }
    const userId = clean(input.userId);
    const roomId = clean(input.roomId)?.toUpperCase();
    if (!userId && !roomId) {
      throw new ServiceError(400, 'SUBJECT_REQUIRED', 'Indica userId y/o roomId para ligar el acceso.');
    }

    const record = await giftCodeStore.findByCode(code);
    if (!record) throw new ServiceError(404, 'GIFT_UNKNOWN', 'Código no encontrado.');
    if (record.status !== 'active') {
      throw new ServiceError(410, 'GIFT_DISABLED', 'El código está desactivado.');
    }
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw new ServiceError(410, 'GIFT_EXPIRED', 'El código expiró.');
    }

    // Idempotencia por sujeto: re-canje => mismo acceso, sin consumir uso.
    const existing = await entitlementStore.findByGiftAndSubject(code, userId, roomId);
    if (existing) {
      const fresh = await giftCodeStore.findByCode(code);
      return { entitlement: existing, code: fresh ?? record, duplicate: true };
    }

    // Reserva atómica del uso (falla si se agotó entre la lectura y el canje).
    const after = await giftCodeStore.incrementUsesIfAvailable(code);
    if (!after) {
      throw new ServiceError(409, 'GIFT_EXHAUSTED', 'El código agotó sus usos.');
    }
    // Expiró entre la lectura y la reserva: se revierte el uso.
    if (after.expiresAt && after.expiresAt.getTime() <= Date.now()) {
      await giftCodeStore.decrementUses(code).catch(() => null);
      throw new ServiceError(410, 'GIFT_EXPIRED', 'El código expiró.');
    }

    const now = new Date();
    const entitlement = await entitlementStore.create({
      userId,
      roomId,
      planId: after.type,
      giftCodeId: code,
      grantedAt: now,
      expiresAt: new Date(now.getTime() + after.durationDays * 24 * 60 * 60 * 1000),
      active: true,
    });
    await logAudit(
      userId ?? roomId ?? 'redeem',
      'gift-codes.redeemed',
      `code=${code} entitlementId=${entitlement.id} uses=${after.uses}/${after.maxUses}`
    );
    return { entitlement, code: after, duplicate: false };
  }
}
