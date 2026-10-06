import mongoose, { Schema, Document } from 'mongoose';

/** Pago con estados pending/completed/failed/cancelled/refunded. */
export interface PaymentDocument extends Document {
  paymentId: string;
  provider: string;
  providerOrderId: string;
  providerTransactionId?: string | null;
  planId: string;
  amount: number;
  currency: string;
  roomId?: string;
  userId?: string;
  status: string;
  failureReason?: string;
  stub: boolean;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<PaymentDocument>(
  {
    paymentId: { type: String, required: true, unique: true, index: true },
    provider: { type: String, required: true, enum: ['paypal', 'card'] },
    providerOrderId: { type: String, required: true, unique: true, index: true },
    // Índice único (sparse): la idempotencia del doble webhook vive aquí.
    providerTransactionId: { type: String, unique: true, sparse: true, index: true, default: null },
    planId: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    roomId: { type: String },
    userId: { type: String },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled', 'refunded'],
      default: 'pending',
      index: true,
    },
    failureReason: { type: String },
    stub: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

export const PaymentModel = mongoose.models.Payment ?? mongoose.model<PaymentDocument>('Payment', PaymentSchema);

/** Acceso premium (entitlement) ligado a roomId y/o usuario+código. */
export interface EntitlementDocument extends Document {
  entitlementId: string;
  userId?: string;
  roomId?: string;
  planId: string;
  paymentId?: string | null;
  giftCodeId?: string;
  grantedAt: Date;
  expiresAt: Date;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EntitlementSchema = new Schema<EntitlementDocument>(
  {
    entitlementId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, index: true },
    roomId: { type: String, index: true },
    planId: { type: String, required: true },
    // Un pago genera UN solo acceso (idempotencia ante doble webhook).
    paymentId: { type: String, unique: true, sparse: true, default: null },
    giftCodeId: { type: String, index: true },
    grantedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const EntitlementModel =
  mongoose.models.Entitlement ?? mongoose.model<EntitlementDocument>('Entitlement', EntitlementSchema);
