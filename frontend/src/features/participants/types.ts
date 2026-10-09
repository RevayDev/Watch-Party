import {
  IParticipant,
  IJoinRequest,
  IKickedParticipant,
  IRoomSettings,
} from '../../types/room';

export interface ParticipantsProps {
  participants: IParticipant[];
  currentUserName: string;
  currentUserId?: string;
  isHost: boolean;
  isCoHost?: boolean;
  kickedUsers?: IKickedParticipant[];
  joinRequests?: IJoinRequest[];
  settings?: IRoomSettings;
  peerMediaStates?: Record<
    string,
    { isCameraOn: boolean; isMicOn: boolean; userName?: string }
  >;
  isMicOn?: boolean;
  isCameraOn?: boolean;
  onToggleMyMic?: () => void;
  onToggleMyCamera?: () => void;
  onMuteUser?: (targetUserName: string, targetSocketId?: string) => void;
  onDisableCamUser?: (targetUserName: string, targetSocketId?: string) => void;
  onMuteAll?: () => void;
  onDisableAllCameras?: () => void;
  onKickUser?: (targetUserName: string, targetUserId?: string) => void;
  onBanUser?: (targetUserName: string, targetUserId?: string) => void;
  onUnbanUser?: (targetUserName: string, targetUserId?: string) => void;
  onToggleCoHost?: (targetUserName: string, makeCoHost: boolean) => void;
  onTransferHost?: (targetUserName: string, targetUserId?: string) => void;
  onRenameUser?: (
    oldName: string,
    newName: string,
    targetUserId?: string,
  ) => void;
  onApproveJoin?: (userId: string | undefined, name: string) => void;
  onRejectJoin?: (
    userId: string | undefined,
    name: string,
    ban: boolean,
  ) => void;
  onUpdateSettings?: (settings: Partial<IRoomSettings>) => void;
  onClose?: () => void;
}

export type ParticipantsTab = 'room' | 'requests' | 'kicked';
