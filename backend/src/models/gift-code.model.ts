import mongoose, { Schema, Document } from 'mongoose';

export interface GiftCodeDocument extends Document {
  code: string;
  type: string;
  durationDays: number;
  maxUses: number;
  uses: number;
  expiresAt?: Date;
  status: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const GiftCodeSchema = new Schema<GiftCodeDocument>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    type: { type: String, required: true, enum: ['FREE_ROOM', 'PREMIUM_ROOM'] },
    durationDays: { type: Number, required: true },
    maxUses: { type: Number, required: true },
    uses: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', index: true },
    createdBy: { type: String },
  },
  { timestamps: true }
);

export const GiftCodeModel =
  mongoose.models.GiftCode ?? mongoose.model<GiftCodeDocument>('GiftCode', GiftCodeSchema);
