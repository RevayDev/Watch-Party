import mongoose, { Schema, Document } from 'mongoose';
import { IRoom, IParticipant, IVideoMetadata, IJoinRequest, IKickedParticipant } from '../types/room.types.js';

export interface RoomDocument extends IRoom, Document {}

const ParticipantSchema = new Schema<IParticipant>(
  {
    socketId: { type: String },
    userId: { type: String },
    name: { type: String, required: true },
    isLeader: { type: Boolean, default: false },
    role: { type: String, enum: ['leader', 'coleader', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
    device: { type: String, default: 'Web Browser' },
  },
  { _id: false }
);

const JoinRequestSchema = new Schema<IJoinRequest>(
  {
    socketId: { type: String, required: true },
    userId: { type: String },
    name: { type: String, required: true },
    requestedAt: { type: Date, default: Date.now },
    device: { type: String, default: 'Web Browser' },
  },
  { _id: false }
);

const KickedUserSchema = new Schema<IKickedParticipant>(
  {
    name: { type: String, required: true },
    userId: { type: String },
    kickedAt: { type: Date, default: Date.now },
    kickedBy: { type: String, default: 'Afitrión' },
    banned: { type: Boolean, default: false },
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
    sourceType: { type: String, enum: ['file', 'url', 'hls'], default: 'file' },
    directUrl: { type: String, default: null },
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
    leaderName: {
      type: String,
      required: true,
      trim: true,
    },
    leaderSecret: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['waiting', 'active', 'closed'],
      default: 'waiting',
    },
    isTemporary: {
      type: Boolean,
      default: true,
    },
    plan: {
      type: String,
      enum: ['free'],
      default: 'free',
    },
    video: {
      type: VideoMetadataSchema,
      default: null,
    },
    participants: {
      type: [ParticipantSchema],
      default: [],
    },
    joinRequests: {
      type: [JoinRequestSchema],
      default: [],
    },
    kickedUsers: {
      type: [KickedUserSchema],
      default: [],
    },
    settings: {
      type: Object,
      default: {
        muteOnEntry: false,
        cameraOffOnEntry: false,
        allowMicReactivation: true,
        allowCamReactivation: true,
      },
    },
  },
  {
    timestamps: true,
  }
);

export const RoomModel = mongoose.model<RoomDocument>('Room', RoomSchema);
