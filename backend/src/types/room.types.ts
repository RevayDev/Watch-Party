export type ParticipantRole = 'host' | 'cohost' | 'member';

export interface IParticipant {
  socketId?: string;
  name: string;
  isHost: boolean;
  role: ParticipantRole;
  joinedAt: Date;
  device?: string;
}

export interface IJoinRequest {
  socketId: string;
  name: string;
  requestedAt: Date;
  device?: string;
}

export interface IKickedParticipant {
  name: string;
  kickedAt: Date;
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

export interface IRoom {
  roomId: string;
  hostName: string;
  hostSecret: string;
  status: 'waiting' | 'active' | 'closed';
  isTemporary?: boolean;
  video?: IVideoMetadata;
  participants: IParticipant[];
  joinRequests?: IJoinRequest[];
  kickedUsers?: IKickedParticipant[];
  settings?: IRoomSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoomDTO {
  hostName: string;
  isTemporary?: boolean;
}

export interface JoinRoomDTO {
  userName: string;
}

