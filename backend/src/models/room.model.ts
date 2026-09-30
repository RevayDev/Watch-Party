import mongoose, { Schema, Document } from 'mongoose';
import { IRoom, IParticipant, IVideoMetadata } from '../types/room.types.js';

export interface RoomDocument extends IRoom, Document {}

const ParticipantSchema = new Schema<IParticipant>(
  {
    socketId: { type: String },
    name: { type: String, required: true },
    isHost: { type: Boolean, default: false },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const VideoMetadataSchema = new Schema<IVideoMetadata>(
  {
    originalName: { type: String, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    durationSeconds: { type: Number, default: 0 },
  },
  { _id: false }
);

const RoomSchema = new Schema<RoomDocument>(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    hostName: {
      type: String,
      required: true,
      trim: true,
    },
    hostSecret: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['waiting', 'active', 'closed'],
      default: 'waiting',
    },
    video: {
      type: VideoMetadataSchema,
      default: null,
    },
    participants: {
      type: [ParticipantSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

export const RoomModel = mongoose.model<RoomDocument>('Room', RoomSchema);
