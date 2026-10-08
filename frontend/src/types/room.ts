export type ParticipantRole = 'host' | 'cohost' | 'member';

export interface IParticipant {
  socketId?: string;
  userId?: string;
  name: string;
  isHost: boolean;
  role?: ParticipantRole;
  joinedAt: string;
  device?: string;
}

export interface IJoinRequest {
  socketId: string;
  userId?: string;
  name: string;
  requestedAt: string;
  device?: string;
}

export interface IKickedParticipant {
  name: string;
  userId?: string;
  kickedAt: string;
  kickedBy: string;
  banned?: boolean;
}

export interface IRoomSettings {
  muteOnEntry: boolean;
  cameraOffOnEntry: boolean;
  allowMicReactivation: boolean;
  allowCamReactivation: boolean;
  isTemporary?: boolean;
  requireApproval?: boolean;
  name?: string;
  description?: string;
  timerMinutes?: number | null;
  timerEndsAt?: string | null;
}

export interface IVideoMetadata {
  originalName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  sourceType?: 'file' | 'url' | 'hls';
  directUrl?: string;
}

export interface IRoomData {
  roomId: string;
  hostName: string;
  hostSecret?: string;
  status: 'waiting' | 'active' | 'closed';
  isTemporary?: boolean;
  /** Plan de la sala (ausente = 'free'). Las premium heredan el acceso del creador. */
  plan?: 'free' | 'premium';
  video?: IVideoMetadata | null;
  participants: IParticipant[];
  joinRequests?: IJoinRequest[];
  kickedUsers?: IKickedParticipant[];
  settings?: IRoomSettings;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  user: string;
  text: string;
  timestamp: string;
}

export interface ReactionItem {
  id: string;
  emoji: string;
  user: string;
  xOffset: number;
}

