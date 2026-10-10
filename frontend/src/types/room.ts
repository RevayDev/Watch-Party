export type ParticipantRole = 'leader' | 'coleader' | 'member';

export interface IParticipant {
  socketId?: string;
  userId?: string;
  name: string;
  isLeader: boolean;
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
  /** Solo el anfitrión (y co-anfitriones) controlan el vídeo: el servidor niega `sync-video` a no-moderadores. */
  hostOnlySync?: boolean;
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
  /** Música/Spotify (whitelist del servidor). */
  musicEnabled?: boolean;
  musicAllowSearch?: boolean;
  musicCanAdd?: 'anyone' | 'moderator';
  musicQueueMode?: 'fifo' | 'votes';
  musicCanRemove?: 'proposer' | 'moderator';
  musicAllowReorder?: boolean;
  musicRequireApproval?: boolean;
  /** Máx. propuestas por usuario (1–20). */
  musicMaxPerUser?: number;
}

export interface IVideoMetadata {
  originalName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  sourceType?: 'file' | 'url' | 'hls' | 'spotify';
  directUrl?: string;
}

export interface IRoomData {
  roomId: string;
  leaderName: string;
  leaderSecret?: string;
  status: 'waiting' | 'active' | 'closed';
  isTemporary?: boolean;
  /** Plan de la sala (siempre 'free': compatibilidad con salas antiguas). */
  plan?: 'free';
  video?: IVideoMetadata | null;
  participants: IParticipant[];
  joinRequests?: IJoinRequest[];
  kickedUsers?: IKickedParticipant[];
  settings?: IRoomSettings;
  createdAt: string;
  /** Cola musical colaborativa (Spotify). */
  musicQueue?: IMusicQueueEntry[];
  musicNowPlaying?: IMusicNowPlaying | null;
}

/** Pista de Spotify (búsqueda / propuestas). */
export interface IMusicTrack {
  id: string;
  name: string;
  artists: string;
  albumArt?: string;
  durationMs?: number;
  uri?: string;
  openUrl?: string;
}

/** Entrada de la cola musical. */
export interface IMusicQueueEntry {
  id: string;
  trackId: string;
  name: string;
  artists: string;
  albumArt?: string;
  durationMs?: number;
  proposedBy: string;
  votes: string[];
  status: 'queued' | 'pending';
}

/** Lo que suena ahora (cola musical). */
export interface IMusicNowPlaying {
  id: string;
  trackId: string;
  name: string;
  artists: string;
  albumArt?: string;
  durationMs?: number;
  proposedBy: string;
  votes: string[];
  status: 'queued' | 'pending';
  startedAt: string;
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
  floatDuration?: number;
}

/** Indicador "está escribiendo": efímero, sin persistencia (expira a los 4 s). */
export interface TypingPayload {
  user: string;
  timestamp: number;
}

