/**
 * SUBAGENTE 3 (pagos): persistencia con fallback en memoria.
 *
 * Sigue el patrón del repo (`room-repository.routing.ts`): un único punto de
 * acceso que delega en Mongo o en memoria según `getIsMongoConnected()`
 * (evaluado en cada llamada). Los tests corren en memoria (sin Mongo).
 */

import crypto from 'node:crypto';
import { getIsMongoConnected } from '../config/database.js';
import { PaymentModel, EntitlementModel } from '../models/payment.model.js';
import { GiftCodeModel } from '../models/gift-code.model.js';
import { AuditLogModel } from '../models/audit-log.model.js';
import { DuplicateKeyError } from './errors.js';

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded';

export interface PaymentRecord {
  id: string;
  provider: 'paypal' | 'card';
  providerOrderId: string;
  providerTransactionId?: string | null;
  planId: string;
  amount: number;
  currency: string;
  roomId?: string;
  userId?: string;
  status: PaymentStatus;
  failureReason?: string;
  stub: boolean;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntitlementRecord {
  id: string;
  userId?: string;
  roomId?: string;
  planId: string;
  paymentId?: string | null;
  giftCodeId?: string;
  grantedAt: Date;
  expiresAt: Date;
  active: boolean;
}

export type GiftCodeType = 'FREE_ROOM' | 'PREMIUM_ROOM';

export interface GiftCodeRecord {
  code: string;
  type: GiftCodeType;
  durationDays: number;
  maxUses: number;
  uses: number;
  expiresAt?: Date;
  status: 'active' | 'disabled';
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  detail?: string;
  createdAt: Date;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function toDate(value: unknown, fallback: Date = new Date()): Date {
  if (value instanceof Date) return value;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

// ── Puertos ────────────────────────────────────────────────────────────────

export interface PaymentStore {
  create(data: Omit<PaymentRecord, 'createdAt' | 'updatedAt'>): Promise<PaymentRecord>;
  findById(id: string): Promise<PaymentRecord | null>;
  findByOrderId(providerOrderId: string): Promise<PaymentRecord | null>;
  findByProviderTxId(txId: string): Promise<PaymentRecord | null>;
  /** Pasa pending→completed de forma atómica; null si ya no estaba pending. */
  completePending(id: string, txId: string, now: Date): Promise<PaymentRecord | null>;
  setStatus(id: string, status: PaymentStatus, failureReason?: string): Promise<PaymentRecord | null>;
  list(filters: { status?: PaymentStatus; provider?: string; search?: string; limit?: number }): Promise<PaymentRecord[]>;
  countByStatus(): Promise<Record<string, number>>;
}

export interface EntitlementStore {
  create(data: Omit<EntitlementRecord, 'id'> & { id?: string }): Promise<EntitlementRecord>;
  findById(id: string): Promise<EntitlementRecord | null>;
  findByPaymentId(paymentId: string): Promise<EntitlementRecord | null>;
  findByGiftAndSubject(giftCodeId: string, userId?: string, roomId?: string): Promise<EntitlementRecord | null>;
  findActive(filter: { userId?: string; roomId?: string }): Promise<EntitlementRecord[]>;
  countActive(): Promise<number>;
}

export interface GiftCodeStore {
  create(data: Omit<GiftCodeRecord, 'createdAt' | 'updatedAt' | 'uses'> & { uses?: number }): Promise<GiftCodeRecord>;
  findByCode(code: string): Promise<GiftCodeRecord | null>;
  /** Incrementa usos solo si active y uses<maxUses; null si no aplica. */
  incrementUsesIfAvailable(code: string): Promise<GiftCodeRecord | null>;
  decrementUses(code: string): Promise<GiftCodeRecord | null>;
  disable(code: string): Promise<GiftCodeRecord | null>;
  remove(code: string): Promise<boolean>;
  list(): Promise<GiftCodeRecord[]>;
}

export interface AuditStore {
  create(data: Omit<AuditRecord, 'id' | 'createdAt'> & { id?: string }): Promise<AuditRecord>;
  list(filters: { action?: string; actor?: string; since?: Date; limit?: number }): Promise<AuditRecord[]>;
}

// ── Adaptadores en memoria ─────────────────────────────────────────────────

function normalizeCode(code: string): string {
  return code.toUpperCase().trim();
}

class MemoryPaymentStore implements PaymentStore {
  private readonly byId = new Map<string, PaymentRecord>();
  private readonly byOrder = new Map<string, string>();
  private readonly byTx = new Map<string, string>();

  async create(data: Omit<PaymentRecord, 'createdAt' | 'updatedAt'>): Promise<PaymentRecord> {
    if (this.byId.has(data.id)) throw new DuplicateKeyError('Pago duplicado.');
    if (this.byOrder.has(data.providerOrderId)) throw new DuplicateKeyError('Orden duplicada.');
    const now = new Date();
    const record: PaymentRecord = { ...data, createdAt: now, updatedAt: now };
    this.byId.set(record.id, record);
    this.byOrder.set(record.providerOrderId, record.id);
    if (record.providerTransactionId) this.byTx.set(record.providerTransactionId, record.id);
    return { ...record };
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    const found = this.byId.get(id);
    return found ? { ...found } : null;
  }

  async findByOrderId(providerOrderId: string): Promise<PaymentRecord | null> {
    const id = this.byOrder.get(providerOrderId);
    return id ? this.findById(id) : null;
  }

  async findByProviderTxId(txId: string): Promise<PaymentRecord | null> {
    const id = this.byTx.get(txId);
    return id ? this.findById(id) : null;
  }

  async completePending(id: string, txId: string, now: Date): Promise<PaymentRecord | null> {
    const record = this.byId.get(id);
    if (!record || record.status !== 'pending') return null;
    if (this.byTx.has(txId)) return null; // tx ya usada por otro pago
    record.status = 'completed';
    record.providerTransactionId = txId;
    record.completedAt = now;
    record.updatedAt = now;
    this.byTx.set(txId, id);
    return { ...record };
  }

  async setStatus(id: string, status: PaymentStatus, failureReason?: string): Promise<PaymentRecord | null> {
    const record = this.byId.get(id);
    if (!record) return null;
    record.status = status;
    if (failureReason !== undefined) record.failureReason = failureReason;
    record.updatedAt = new Date();
    return { ...record };
  }

  async list(filters: { status?: PaymentStatus; provider?: string; search?: string; limit?: number }): Promise<PaymentRecord[]> {
    const q = (filters.search ?? '').trim().toLowerCase();
    let rows = [...this.byId.values()];
    if (filters.status) rows = rows.filter((r) => r.status === filters.status);
    if (filters.provider) rows = rows.filter((r) => r.provider === filters.provider);
    if (q) {
      rows = rows.filter((r) =>
        [r.id, r.providerOrderId, r.providerTransactionId ?? '', r.roomId ?? '', r.userId ?? '', r.planId]
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows.slice(0, Math.min(filters.limit ?? 50, 200)).map((r) => ({ ...r }));
  }

  async countByStatus(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const r of this.byId.values()) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }

  clear(): void {
    this.byId.clear();
    this.byOrder.clear();
    this.byTx.clear();
  }
}

class MemoryEntitlementStore implements EntitlementStore {
  private readonly byId = new Map<string, EntitlementRecord>();
  private readonly byPayment = new Map<string, string>();

  async create(data: Omit<EntitlementRecord, 'id'> & { id?: string }): Promise<EntitlementRecord> {
    if (data.paymentId && this.byPayment.has(data.paymentId)) {
      throw new DuplicateKeyError('El pago ya generó un acceso.');
    }
    const record: EntitlementRecord = { ...data, id: data.id ?? newId('ent') };
    this.byId.set(record.id, record);
    if (record.paymentId) this.byPayment.set(record.paymentId, record.id);
    return { ...record };
  }

  async findById(id: string): Promise<EntitlementRecord | null> {
    const found = this.byId.get(id);
    return found ? { ...found } : null;
  }

  async findByPaymentId(paymentId: string): Promise<EntitlementRecord | null> {
    const id = this.byPayment.get(paymentId);
    return id ? this.findById(id) : null;
  }

  async findByGiftAndSubject(giftCodeId: string, userId?: string, roomId?: string): Promise<EntitlementRecord | null> {
    for (const e of this.byId.values()) {
      if (e.giftCodeId !== giftCodeId) continue;
      if (userId && e.userId === userId) return { ...e };
      if (roomId && e.roomId === roomId) return { ...e };
    }
    return null;
  }

  async findActive(filter: { userId?: string; roomId?: string }): Promise<EntitlementRecord[]> {
    const now = Date.now();
    return [...this.byId.values()]
      .filter((e) => e.active && e.expiresAt.getTime() > now)
      .filter((e) => {
        if (filter.userId && e.userId === filter.userId) return true;
        if (filter.roomId && e.roomId === filter.roomId) return true;
        return !filter.userId && !filter.roomId;
      })
      .map((e) => ({ ...e }));
  }

  async countActive(): Promise<number> {
    const now = Date.now();
    let n = 0;
    for (const e of this.byId.values()) if (e.active && e.expiresAt.getTime() > now) n++;
    return n;
  }

  clear(): void {
    this.byId.clear();
    this.byPayment.clear();
  }
}

class MemoryGiftCodeStore implements GiftCodeStore {
  private readonly byCode = new Map<string, GiftCodeRecord>();

  async create(data: Omit<GiftCodeRecord, 'createdAt' | 'updatedAt' | 'uses'> & { uses?: number }): Promise<GiftCodeRecord> {
    const code = normalizeCode(data.code);
    if (this.byCode.has(code)) throw new DuplicateKeyError('Código duplicado.');
    const now = new Date();
    const record: GiftCodeRecord = { ...data, code, uses: data.uses ?? 0, createdAt: now, updatedAt: now };
    this.byCode.set(code, record);
    return { ...record };
  }

  async findByCode(code: string): Promise<GiftCodeRecord | null> {
    const found = this.byCode.get(normalizeCode(code));
    return found ? { ...found, expiresAt: found.expiresAt ? new Date(found.expiresAt) : undefined } : null;
  }

  async incrementUsesIfAvailable(code: string): Promise<GiftCodeRecord | null> {
    const record = this.byCode.get(normalizeCode(code));
    if (!record || record.status !== 'active' || record.uses >= record.maxUses) return null;
    record.uses += 1;
    record.updatedAt = new Date();
    return { ...record };
  }

  async decrementUses(code: string): Promise<GiftCodeRecord | null> {
    const record = this.byCode.get(normalizeCode(code));
    if (!record) return null;
    record.uses = Math.max(0, record.uses - 1);
    record.updatedAt = new Date();
    return { ...record };
  }

  async disable(code: string): Promise<GiftCodeRecord | null> {
    const record = this.byCode.get(normalizeCode(code));
    if (!record) return null;
    record.status = 'disabled';
    record.updatedAt = new Date();
    return { ...record };
  }

  async remove(code: string): Promise<boolean> {
    return this.byCode.delete(normalizeCode(code));
  }

  async list(): Promise<GiftCodeRecord[]> {
    return [...this.byCode.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  clear(): void {
    this.byCode.clear();
  }
}

class MemoryAuditStore implements AuditStore {
  private readonly rows: AuditRecord[] = [];

  async create(data: Omit<AuditRecord, 'id' | 'createdAt'> & { id?: string }): Promise<AuditRecord> {
    const record: AuditRecord = { ...data, id: data.id ?? newId('aud'), createdAt: new Date() };
    this.rows.push(record);
    return { ...record };
  }

  async list(filters: { action?: string; actor?: string; since?: Date; limit?: number }): Promise<AuditRecord[]> {
    let rows = [...this.rows];
    if (filters.action) rows = rows.filter((r) => r.action === filters.action);
    if (filters.actor) rows = rows.filter((r) => r.actor === filters.actor);
    if (filters.since) rows = rows.filter((r) => r.createdAt.getTime() >= (filters.since as Date).getTime());
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows.slice(0, Math.min(filters.limit ?? 50, 200)).map((r) => ({ ...r }));
  }

  clear(): void {
    this.rows.length = 0;
  }
}

export const memoryPaymentStore = new MemoryPaymentStore();
export const memoryEntitlementStore = new MemoryEntitlementStore();
export const memoryGiftCodeStore = new MemoryGiftCodeStore();
export const memoryAuditStore = new MemoryAuditStore();

/** Limpia los stores en memoria (tests). No toca Mongo. */
export function resetPaymentsMemoryStores(): void {
  memoryPaymentStore.clear();
  memoryEntitlementStore.clear();
  memoryGiftCodeStore.clear();
  memoryAuditStore.clear();
}

// ── Adaptadores Mongo ──────────────────────────────────────────────────────

function toPayment(doc: unknown): PaymentRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: d['paymentId'] as string,
    provider: d['provider'] as 'paypal' | 'card',
    providerOrderId: d['providerOrderId'] as string,
    providerTransactionId: (d['providerTransactionId'] as string | null) ?? null,
    planId: d['planId'] as string,
    amount: d['amount'] as number,
    currency: d['currency'] as string,
    roomId: d['roomId'] as string | undefined,
    userId: d['userId'] as string | undefined,
    status: d['status'] as PaymentStatus,
    failureReason: d['failureReason'] as string | undefined,
    stub: Boolean(d['stub']),
    completedAt: d['completedAt'] ? toDate(d['completedAt']) : undefined,
    createdAt: toDate(d['createdAt']),
    updatedAt: toDate(d['updatedAt']),
  };
}

function toEntitlement(doc: unknown): EntitlementRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: d['entitlementId'] as string,
    userId: d['userId'] as string | undefined,
    roomId: d['roomId'] as string | undefined,
    planId: d['planId'] as string,
    paymentId: (d['paymentId'] as string | null) ?? null,
    giftCodeId: d['giftCodeId'] as string | undefined,
    grantedAt: toDate(d['grantedAt']),
    expiresAt: toDate(d['expiresAt']),
    active: d['active'] !== false,
  };
}

function toGiftCode(doc: unknown): GiftCodeRecord {
  const d = doc as Record<string, unknown>;
  return {
    code: d['code'] as string,
    type: d['type'] as GiftCodeRecord['type'],
    durationDays: d['durationDays'] as number,
    maxUses: d['maxUses'] as number,
    uses: d['uses'] as number,
    expiresAt: d['expiresAt'] ? toDate(d['expiresAt']) : undefined,
    status: d['status'] as GiftCodeRecord['status'],
    createdBy: d['createdBy'] as string | undefined,
    createdAt: toDate(d['createdAt']),
    updatedAt: toDate(d['updatedAt']),
  };
}

function toAudit(doc: unknown): AuditRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: d['auditId'] as string,
    actor: d['actor'] as string,
    action: d['action'] as string,
    detail: d['detail'] as string | undefined,
    createdAt: toDate(d['createdAt']),
  };
}

function isDupKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

class MongoPaymentStore implements PaymentStore {
  async create(data: Omit<PaymentRecord, 'createdAt' | 'updatedAt'>): Promise<PaymentRecord> {
    try {
      const created = await PaymentModel.create({
        paymentId: data.id,
        provider: data.provider,
        providerOrderId: data.providerOrderId,
        providerTransactionId: data.providerTransactionId ?? null,
        planId: data.planId,
        amount: data.amount,
        currency: data.currency,
        roomId: data.roomId,
        userId: data.userId,
        status: data.status,
        failureReason: data.failureReason,
        stub: data.stub,
        completedAt: data.completedAt,
      });
      return toPayment(created.toObject());
    } catch (err) {
      if (isDupKey(err)) throw new DuplicateKeyError('Pago u orden duplicada.');
      throw err;
    }
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    const doc = await PaymentModel.findOne({ paymentId: id }).lean();
    return doc ? toPayment(doc) : null;
  }

  async findByOrderId(providerOrderId: string): Promise<PaymentRecord | null> {
    const doc = await PaymentModel.findOne({ providerOrderId }).lean();
    return doc ? toPayment(doc) : null;
  }

  async findByProviderTxId(txId: string): Promise<PaymentRecord | null> {
    const doc = await PaymentModel.findOne({ providerTransactionId: txId }).lean();
    return doc ? toPayment(doc) : null;
  }

  async completePending(id: string, txId: string, now: Date): Promise<PaymentRecord | null> {
    const doc = await PaymentModel.findOneAndUpdate(
      { paymentId: id, status: 'pending' },
      { $set: { providerTransactionId: txId, status: 'completed', completedAt: now, updatedAt: now } },
      { new: true }
    ).lean();
    return doc ? toPayment(doc) : null;
  }

  async setStatus(id: string, status: PaymentStatus, failureReason?: string): Promise<PaymentRecord | null> {
    const update: Record<string, unknown> = { $set: { status, updatedAt: new Date() } };
    if (failureReason !== undefined) (update['$set'] as Record<string, unknown>)['failureReason'] = failureReason;
    const doc = await PaymentModel.findOneAndUpdate({ paymentId: id }, update, { new: true }).lean();
    return doc ? toPayment(doc) : null;
  }

  async list(filters: { status?: PaymentStatus; provider?: string; search?: string; limit?: number }): Promise<PaymentRecord[]> {
    const query: Record<string, unknown> = {};
    if (filters.status) query['status'] = filters.status;
    if (filters.provider) query['provider'] = filters.provider;
    const q = (filters.search ?? '').trim();
    if (q) {
      query['$or'] = ['paymentId', 'providerOrderId', 'providerTransactionId', 'roomId', 'userId', 'planId'].map(
        (field) => ({ [field]: { $regex: q, $options: 'i' } })
      );
    }
    const docs = await PaymentModel.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(filters.limit ?? 50, 200))
      .lean();
    return docs.map(toPayment);
  }

  async countByStatus(): Promise<Record<string, number>> {
    const agg = await PaymentModel.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    const counts: Record<string, number> = {};
    for (const row of agg as Array<{ _id: string; n: number }>) counts[row._id] = row.n;
    return counts;
  }
}

class MongoEntitlementStore implements EntitlementStore {
  async create(data: Omit<EntitlementRecord, 'id'> & { id?: string }): Promise<EntitlementRecord> {
    const id = data.id ?? newId('ent');
    try {
      const created = await EntitlementModel.create({
        entitlementId: id,
        userId: data.userId,
        roomId: data.roomId,
        planId: data.planId,
        paymentId: data.paymentId ?? null,
        giftCodeId: data.giftCodeId,
        grantedAt: data.grantedAt,
        expiresAt: data.expiresAt,
        active: data.active,
      });
      return toEntitlement(created.toObject());
    } catch (err) {
      if (isDupKey(err)) throw new DuplicateKeyError('El pago ya generó un acceso.');
      throw err;
    }
  }

  async findById(id: string): Promise<EntitlementRecord | null> {
    const doc = await EntitlementModel.findOne({ entitlementId: id }).lean();
    return doc ? toEntitlement(doc) : null;
  }

  async findByPaymentId(paymentId: string): Promise<EntitlementRecord | null> {
    const doc = await EntitlementModel.findOne({ paymentId }).lean();
    return doc ? toEntitlement(doc) : null;
  }

  async findByGiftAndSubject(giftCodeId: string, userId?: string, roomId?: string): Promise<EntitlementRecord | null> {
    const or: Record<string, unknown>[] = [];
    if (userId) or.push({ userId });
    if (roomId) or.push({ roomId });
    if (or.length === 0) return null;
    const doc = await EntitlementModel.findOne({ giftCodeId, $or: or }).sort({ grantedAt: -1 }).lean();
    return doc ? toEntitlement(doc) : null;
  }

  async findActive(filter: { userId?: string; roomId?: string }): Promise<EntitlementRecord[]> {
    const or: Record<string, unknown>[] = [];
    if (filter.userId) or.push({ userId: filter.userId });
    if (filter.roomId) or.push({ roomId: filter.roomId });
    const query: Record<string, unknown> = { active: true, expiresAt: { $gt: new Date() } };
    if (or.length > 0) query['$or'] = or;
    else if (!filter.userId && !filter.roomId) {
      // Sin sujeto no se lista nada (privacidad): el llamador exige userId/roomId.
      return [];
    }
    const docs = await EntitlementModel.find(query).lean();
    return docs.map(toEntitlement);
  }

  async countActive(): Promise<number> {
    return EntitlementModel.countDocuments({ active: true, expiresAt: { $gt: new Date() } });
  }
}

class MongoGiftCodeStore implements GiftCodeStore {
  async create(data: Omit<GiftCodeRecord, 'createdAt' | 'updatedAt' | 'uses'> & { uses?: number }): Promise<GiftCodeRecord> {
    try {
      const created = await GiftCodeModel.create({
        code: normalizeCode(data.code),
        type: data.type,
        durationDays: data.durationDays,
        maxUses: data.maxUses,
        uses: data.uses ?? 0,
        expiresAt: data.expiresAt,
        status: data.status,
        createdBy: data.createdBy,
      });
      return toGiftCode(created.toObject());
    } catch (err) {
      if (isDupKey(err)) throw new DuplicateKeyError('Código duplicado.');
      throw err;
    }
  }

  async findByCode(code: string): Promise<GiftCodeRecord | null> {
    const doc = await GiftCodeModel.findOne({ code: normalizeCode(code) }).lean();
    return doc ? toGiftCode(doc) : null;
  }

  async incrementUsesIfAvailable(code: string): Promise<GiftCodeRecord | null> {
    const doc = await GiftCodeModel.findOneAndUpdate(
      { code: normalizeCode(code), status: 'active', $expr: { $lt: ['$uses', '$maxUses'] } },
      { $inc: { uses: 1 }, $set: { updatedAt: new Date() } },
      { new: true }
    ).lean();
    return doc ? toGiftCode(doc) : null;
  }

  async decrementUses(code: string): Promise<GiftCodeRecord | null> {
    const doc = await GiftCodeModel.findOneAndUpdate(
      { code: normalizeCode(code) },
      { $inc: { uses: -1 }, $set: { updatedAt: new Date() } },
      { new: true }
    ).lean();
    if (!doc) return null;
    const record = toGiftCode(doc);
    if (record.uses < 0) {
      await GiftCodeModel.updateOne({ code: record.code }, { $set: { uses: 0 } });
      record.uses = 0;
    }
    return record;
  }

  async disable(code: string): Promise<GiftCodeRecord | null> {
    const doc = await GiftCodeModel.findOneAndUpdate(
      { code: normalizeCode(code) },
      { $set: { status: 'disabled', updatedAt: new Date() } },
      { new: true }
    ).lean();
    return doc ? toGiftCode(doc) : null;
  }

  async remove(code: string): Promise<boolean> {
    const result = await GiftCodeModel.deleteOne({ code: normalizeCode(code) });
    return result.deletedCount > 0;
  }

  async list(): Promise<GiftCodeRecord[]> {
    const docs = await GiftCodeModel.find({}).sort({ createdAt: -1 }).lean();
    return docs.map(toGiftCode);
  }
}

class MongoAuditStore implements AuditStore {
  async create(data: Omit<AuditRecord, 'id' | 'createdAt'> & { id?: string }): Promise<AuditRecord> {
    const created = await AuditLogModel.create({
      auditId: data.id ?? newId('aud'),
      actor: data.actor,
      action: data.action,
      detail: data.detail,
    });
    return toAudit(created.toObject());
  }

  async list(filters: { action?: string; actor?: string; since?: Date; limit?: number }): Promise<AuditRecord[]> {
    const query: Record<string, unknown> = {};
    if (filters.action) query['action'] = filters.action;
    if (filters.actor) query['actor'] = filters.actor;
    if (filters.since) query['createdAt'] = { $gte: filters.since };
    const docs = await AuditLogModel.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(filters.limit ?? 50, 200))
      .lean();
    return docs.map(toAudit);
  }
}

const mongoPaymentStore = new MongoPaymentStore();
const mongoEntitlementStore = new MongoEntitlementStore();
const mongoGiftCodeStore = new MongoGiftCodeStore();
const mongoAuditStore = new MongoAuditStore();

// ── Enrutado (igual que RoutingRoomRepository) ─────────────────────────────

class RoutingPaymentStore implements PaymentStore {
  private active(): PaymentStore {
    return getIsMongoConnected() ? mongoPaymentStore : memoryPaymentStore;
  }
  create(data: Omit<PaymentRecord, 'createdAt' | 'updatedAt'>): Promise<PaymentRecord> {
    return this.active().create(data);
  }
  findById(id: string): Promise<PaymentRecord | null> {
    return this.active().findById(id);
  }
  findByOrderId(providerOrderId: string): Promise<PaymentRecord | null> {
    return this.active().findByOrderId(providerOrderId);
  }
  findByProviderTxId(txId: string): Promise<PaymentRecord | null> {
    return this.active().findByProviderTxId(txId);
  }
  completePending(id: string, txId: string, now: Date): Promise<PaymentRecord | null> {
    return this.active().completePending(id, txId, now);
  }
  setStatus(id: string, status: PaymentStatus, failureReason?: string): Promise<PaymentRecord | null> {
    return this.active().setStatus(id, status, failureReason);
  }
  list(filters: { status?: PaymentStatus; provider?: string; search?: string; limit?: number }): Promise<PaymentRecord[]> {
    return this.active().list(filters);
  }
  countByStatus(): Promise<Record<string, number>> {
    return this.active().countByStatus();
  }
}

class RoutingEntitlementStore implements EntitlementStore {
  private active(): EntitlementStore {
    return getIsMongoConnected() ? mongoEntitlementStore : memoryEntitlementStore;
  }
  create(data: Omit<EntitlementRecord, 'id'> & { id?: string }): Promise<EntitlementRecord> {
    return this.active().create(data);
  }
  findById(id: string): Promise<EntitlementRecord | null> {
    return this.active().findById(id);
  }
  findByPaymentId(paymentId: string): Promise<EntitlementRecord | null> {
    return this.active().findByPaymentId(paymentId);
  }
  findByGiftAndSubject(giftCodeId: string, userId?: string, roomId?: string): Promise<EntitlementRecord | null> {
    return this.active().findByGiftAndSubject(giftCodeId, userId, roomId);
  }
  findActive(filter: { userId?: string; roomId?: string }): Promise<EntitlementRecord[]> {
    return this.active().findActive(filter);
  }
  countActive(): Promise<number> {
    return this.active().countActive();
  }
}

class RoutingGiftCodeStore implements GiftCodeStore {
  private active(): GiftCodeStore {
    return getIsMongoConnected() ? mongoGiftCodeStore : memoryGiftCodeStore;
  }
  create(data: Omit<GiftCodeRecord, 'createdAt' | 'updatedAt' | 'uses'> & { uses?: number }): Promise<GiftCodeRecord> {
    return this.active().create(data);
  }
  findByCode(code: string): Promise<GiftCodeRecord | null> {
    return this.active().findByCode(code);
  }
  incrementUsesIfAvailable(code: string): Promise<GiftCodeRecord | null> {
    return this.active().incrementUsesIfAvailable(code);
  }
  decrementUses(code: string): Promise<GiftCodeRecord | null> {
    return this.active().decrementUses(code);
  }
  disable(code: string): Promise<GiftCodeRecord | null> {
    return this.active().disable(code);
  }
  remove(code: string): Promise<boolean> {
    return this.active().remove(code);
  }
  list(): Promise<GiftCodeRecord[]> {
    return this.active().list();
  }
}

class RoutingAuditStore implements AuditStore {
  private active(): AuditStore {
    return getIsMongoConnected() ? mongoAuditStore : memoryAuditStore;
  }
  create(data: Omit<AuditRecord, 'id' | 'createdAt'> & { id?: string }): Promise<AuditRecord> {
    return this.active().create(data);
  }
  list(filters: { action?: string; actor?: string; since?: Date; limit?: number }): Promise<AuditRecord[]> {
    return this.active().list(filters);
  }
}

/** Singletons usados por los servicios de pagos. */
export const paymentStore: PaymentStore = new RoutingPaymentStore();
export const entitlementStore: EntitlementStore = new RoutingEntitlementStore();
export const giftCodeStore: GiftCodeStore = new RoutingGiftCodeStore();
export const auditStore: AuditStore = new RoutingAuditStore();
