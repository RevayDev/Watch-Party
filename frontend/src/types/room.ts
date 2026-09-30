export type ParticipantRole = 'host' | 'cohost' | 'member';

export interface IParticipant {
  socketId?: string;
  name: string;
  isHost: boolean;
  role?: ParticipantRole;
  joinedAt: string;
  device?: string;
}

export interface IJoinRequest {
  socketId: string;
  name: string;
  requestedAt: string;
  device?: string;
}

export interface IKickedParticipant {
  name: string;
  kickedAt: string;
  kickedBy: string;
}

export interface IRoomSettings {
  muteOnEntry: boolean;
  cameraOffOnEntry: boolean;
  allowMicReactivation: boolean;
  allowCamReactivation: boolean;
  isTemporary?: boolean;
}

export interface IVideoMetadata {
  originalName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
}

export interface IRoomData {
  roomId: string;
  hostName: string;
  hostSecret?: string;
  status: 'waiting' | 'active' | 'closed';
  isTemporary?: boolean;
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

