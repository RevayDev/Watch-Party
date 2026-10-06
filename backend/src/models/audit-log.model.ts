import mongoose, { Schema, Document } from 'mongoose';

/** Auditoría admin: quién hizo qué, cuándo (actor, acción, detalle, fecha). */
export interface AuditLogDocument extends Document {
  auditId: string;
  actor: string;
  action: string;
  detail?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<AuditLogDocument>(
  {
    auditId: { type: String, required: true, unique: true, index: true },
    actor: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    detail: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ createdAt: -1 });

export const AuditLogModel =
  mongoose.models.AuditLog ?? mongoose.model<AuditLogDocument>('AuditLog', AuditLogSchema);
