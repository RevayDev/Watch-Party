export interface IParticipant {
  socketId?: string;
  name: string;
  isHost: boolean;
  joinedAt: string;
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
  video?: IVideoMetadata | null;
  participants: IParticipant[];
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
