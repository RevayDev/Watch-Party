export type ParticipantRole = 'leader' | 'coleader' | 'member';

export interface IParticipant {
  socketId?: string;
  userId?: string;
  name: string;
  isLeader: boolean;
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
  /** Solo el anfitrión (leader/coleader) controla la reproducción vía `sync-video`. Default OFF (cualquiera sincroniza). */
  hostOnlySync?: boolean;
  /** Música Spotify: integración activada en la sala. Default OFF. */
  musicEnabled?: boolean;
  /** Permitir buscar en Spotify desde la sala. Default ON cuando musicEnabled. */
  musicAllowSearch?: boolean;
  /** Quién puede añadir temas: cualquiera o solo moderadores. Default 'anyone'. */
  musicCanAdd?: 'anyone' | 'moderator';
  /** Modo de cola: fifo (orden de llegada) o votes (más votada primero). Default 'fifo'. */
  musicQueueMode?: 'fifo' | 'votes';
  /** Quién puede quitar temas: el proponente o solo moderadores. Default 'proposer'. */
  musicCanRemove?: 'proposer' | 'moderator';
  /** Permitir reordenar la cola (solo moderadores). Default OFF. */
  musicAllowReorder?: boolean;
  /** Los temas entran como pendientes y requieren aprobación. Default OFF. */
  musicRequireApproval?: boolean;
  /** Máx. temas en cola por usuario (1–20, default 5). */
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

/** Entrada de la cola musical (tema propuesto desde Spotify). */
export interface IMusicQueueEntry {
  id: string;
  trackId: string;
  name: string;
  artists: string;
  albumArt?: string;
  durationMs?: number;
  uri?: string;
  openUrl?: string;
  /** Tipo de contenido (solo 'track' por ahora; futuro: playlist/album/episode). */
  kind?: 'track';
  proposedBy: string;
  proposedByUserId?: string;
  status: 'queued' | 'pending';
  votes: string[];
  createdAt: Date;
}

/** Tema sonando ahora en la sala (vía embed Spotify). */
export type IMusicNowPlaying = {
  entryId: string;
  trackId: string;
  name: string;
  artists: string;
  albumArt?: string;
  uri?: string;
  openUrl?: string;
  startedAt: Date;
  startedBy: string;
} | null;

export interface IRoom {
  roomId: string;
  leaderName: string;
  leaderSecret: string;
  status: 'waiting' | 'active' | 'closed';
  isTemporary?: boolean;
  /** Plan de la sala (siempre 'free': compatibilidad con salas antiguas). */
  plan?: 'free';
  video?: IVideoMetadata;
  participants: IParticipant[];
  joinRequests?: IJoinRequest[];
  kickedUsers?: IKickedParticipant[];
  settings?: IRoomSettings;
  /** Cola musical de Spotify (vacía por defecto). */
  musicQueue?: IMusicQueueEntry[];
  /** Tema sonando ahora (null = nada). */
  musicNowPlaying?: IMusicNowPlaying;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoomDTO {
  leaderName: string;
  isTemporary?: boolean;
  userId?: string;
}

export interface JoinRoomDTO {
  userName: string;
  userId?: string;
}

