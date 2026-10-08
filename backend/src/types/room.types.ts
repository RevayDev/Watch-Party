export type ParticipantRole = 'host' | 'cohost' | 'member';

export interface IParticipant {
  socketId?: string;
  userId?: string;
  name: string;
  isHost: boolean;
  role: ParticipantRole;
  joinedAt: Date;
  device?: string;
}

export interface IJoinRequest {
  socketId: string;
  userId?: string;
  name: string;
  requestedAt: Date;
  device?: string;
}

export interface IKickedParticipant {
  name: string;
  userId?: string;
  kickedAt: Date;
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
  /** Rol B (rendimiento, persistidos en ajustes de sala). */
  /** Modo ahorro de datos: remotos a audio-only + heartbeat 15 s. */
  dataSaver?: boolean;
  /** Mostrar avisos (toasts) dentro del player en pantalla completa. Default ON. */
  fullscreenToasts?: boolean;
  /** Mostrar reacciones flotantes sobre el vídeo. Default ON. */
  reactionsEnabled?: boolean;
  /** Efectos visuales: combo Interestellar + animaciones largas. Default ON. */
  visualEffects?: boolean;
  /** Atenuación del vídeo mientras el micro está activo. Default ON. */
  duckingEnabled?: boolean;
  /** Nivel de atenuación en % (10–60, default 30). */
  duckingLevel?: number;
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

export interface IRoom {
  roomId: string;
  hostName: string;
  hostSecret: string;
  status: 'waiting' | 'active' | 'closed';
  isTemporary?: boolean;
  /** Plan de la sala: las premium heredan el acceso del creador (ausente = 'free'). */
  plan?: 'free' | 'premium';
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
  userId?: string;
}

export interface JoinRoomDTO {
  userName: string;
  userId?: string;
}

