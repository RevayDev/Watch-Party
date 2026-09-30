export interface IParticipant {
  socketId?: string;
  name: string;
  isHost: boolean;
  joinedAt: Date;
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
  video?: IVideoMetadata;
  participants: IParticipant[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoomDTO {
  hostName: string;
}

export interface JoinRoomDTO {
  userName: string;
}
