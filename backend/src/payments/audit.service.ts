/**
 * SUBAGENTE 3 (pagos): AdminAuditLog.
 * Registra creación/desactivación de códigos, reembolsos y acciones de
 * pagos (actor, acción, detalle, fecha). Best-effort: un fallo de auditoría
 * jamás rompe la operación principal (se avisa por consola).
 */

import { auditStore, type AuditRecord } from './payment.store.js';

export const AUDIT_ACTIONS = [
  'gift-codes.created',
  'gift-codes.disabled',
  'gift-codes.deleted',
  'gift-codes.redeemed',
  'payments.checkout',
  'payments.confirmed',
  'payments.webhook-rejected',
  'payments.refunded',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number] | string;

export async function logAudit(actor: string, action: AuditAction, detail?: string): Promise<AuditRecord | null> {
  try {
    return await auditStore.create({
      actor: (actor ?? '').trim() || 'unknown',
      action,
      detail,
    });
  } catch (err) {
    console.warn('⚠️ No se pudo registrar la auditoría:', err);
    return null;
  }
}

export async function listAuditLogs(filters: {
  action?: string;
  actor?: string;
  since?: Date;
  limit?: number;
}): Promise<AuditRecord[]> {
  return auditStore.list(filters);
}
