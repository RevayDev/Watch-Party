import React from 'react';
import { X } from 'lucide-react';
import { BottomSheet } from '../../../shared/components/BottomSheet';
import { Chat } from '../../chat/Chat';
import { Participants } from '../../participants/Participants';
import type { IRoomData, IMusicQueueEntry, IMusicNowPlaying, IMusicTrack, IRoomSettings, ChatMessage } from '../../../types/room';
import { buildSocketAuth } from '../../../shared/utils';

/**
 * Drawer lateral chat/participantes/música (con barra de pestañas siempre visible).
 */
interface RoomDrawerProps {
  activeSideTab: 'chat' | 'participants' | 'music' | null;
  sideTabView: 'chat' | 'participants' | 'music';
  setActiveSideTab: React.Dispatch<React.SetStateAction<'chat' | 'participants' | 'music' | null>>;
  messages: ChatMessage[];
  handleSendMessage: (
    text: string,
    replyTo?: { id: string; user: string; text: string } | null
  ) => void;
  handleEditMessage: (id: string, text: string) => void;
  typingUsers: string[];
  /** No leídos acumulados (insignia de la flecha para bajar). */
  unreadCount?: number;
  onTyping: () => void;
  myName: string;
  roomData: IRoomData;
  userId: string;
  isLeader: boolean;
  canManageParticipants?: boolean;
  peerMediaStates: Record<string, { isCameraOn: boolean; isMicOn: boolean; userName?: string }>;
  isMicOn: boolean;
  isCameraOn: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
  socket: { emit: (event: string, data: unknown) => unknown };
  roomId: string;
  musicQueue?: IMusicQueueEntry[];
  musicNowPlaying?: IMusicNowPlaying | null;
  musicSettings?: IRoomSettings;
  musicIsModerator?: boolean;
  onAddMusicUrl?: (url: string) => Promise<boolean>;
  onMusicAdd?: (t: IMusicTrack) => void;
  onMusicRemove?: (id: string) => void;
  onMusicReorder?: (ids: string[]) => void;
  onMusicApprove?: (id: string) => void;
  onMusicNext?: () => void;
  onMusicAutoNext?: () => void;
  onMusicStop?: () => void;
  onExpandToMain?: (url: string, title: string, currentTime?: number) => void;
}

export const RoomDrawer: React.FC<RoomDrawerProps> = ({
  activeSideTab,
  sideTabView,
  setActiveSideTab,
  messages,
  handleSendMessage,
  handleEditMessage,
  typingUsers,
  unreadCount = 0,
  onTyping,
  myName,
  roomData,
  userId,
  isLeader,
  canManageParticipants = true,
  peerMediaStates,
  isMicOn,
  isCameraOn,
  toggleMic,
  toggleCamera,
  socket,
  roomId,
}) => {
  const auth = () => buildSocketAuth(roomId, myName);
  const currentTab = activeSideTab ?? sideTabView;

  return (
    <BottomSheet
      open={!!activeSideTab}
      onClose={() => setActiveSideTab(null)}
      variant="inline"
      desktopClassName={`meet-drawer ${currentTab === 'participants' || currentTab === 'music' ? 'meet-drawer--wide' : ''}`}
      height={85}
      label={currentTab === 'participants' ? 'Participantes' : currentTab === 'music' ? 'Música' : 'Chat'}
    >
      <div className="meet-drawer__body">
        {/* Solo el título de la sección + cerrar (sin pestañas) */}
        <div className="meet-drawer__tab-header">
          <span className="meet-drawer__title">
            {currentTab === 'participants'
              ? `Participantes (${roomData.participants.length})`
              : currentTab === 'music'
                ? 'Música'
                : 'Chat'}
          </span>
          <button
            type="button"
            className="drawer-close-btn"
            onClick={() => setActiveSideTab(null)}
            title="Cerrar panel"
            aria-label="Cerrar panel"
          >
            <X size={18} />
          </button>
        </div>

        {currentTab === 'chat' && (
          <Chat
            isOpen={activeSideTab === 'chat'}
            messages={messages}
            onSendMessage={handleSendMessage}
            onEditMessage={handleEditMessage}
            currentUserName={myName}
            typingUsers={typingUsers}
            onTyping={onTyping}
            unreadCount={unreadCount}
          />
        )}
        {currentTab === 'participants' && (
          <Participants
            participants={roomData.participants}
            currentUserName={myName}
            currentUserId={userId}
            isLeader={isLeader && canManageParticipants}
            isCoLeader={canManageParticipants && roomData.participants.some(
              (p) =>
                (p.userId ? p.userId === userId : p.name.toLowerCase() === myName.toLowerCase()) &&
                p.role === 'coleader'
            )}
            kickedUsers={roomData.kickedUsers}
            joinRequests={roomData.joinRequests}
            settings={roomData.settings}
            peerMediaStates={peerMediaStates}
            isMicOn={isMicOn}
            isCameraOn={isCameraOn}
            onToggleMyMic={toggleMic}
            onToggleMyCamera={toggleCamera}
            onMuteUser={(targetUserName, targetSocketId) => {
              socket.emit('moderate-mute-user', { roomId, targetUserName, targetSocketId, ...auth() });
            }}
            onDisableCamUser={(targetUserName, targetSocketId) => {
              socket.emit('moderate-disable-camera', { roomId, targetUserName, targetSocketId, ...auth() });
            }}
            onMuteAll={() => {
              socket.emit('moderate-mute-all', { roomId, ...auth() });
            }}
            onDisableAllCameras={() => {
              socket.emit('moderate-disable-all-cameras', { roomId, ...auth() });
            }}
            onKickUser={(targetUserName, targetUserId) => {
              socket.emit('kick-user', { roomId, targetUserName, targetUserId, kickedBy: myName, ban: false, ...auth() });
            }}
            onBanUser={(targetUserName, targetUserId) => {
              socket.emit('kick-user', { roomId, targetUserName, targetUserId, kickedBy: myName, ban: true, ...auth() });
            }}
            onUnbanUser={(targetUserName, targetUserId) => {
              socket.emit('unban-user', { roomId, targetUserName, targetUserId, ...auth() });
            }}
            onToggleCoLeader={(targetUserName, makeCoLeader) => {
              socket.emit('set-role', {
                roomId,
                targetUserName,
                role: makeCoLeader ? 'coleader' : 'member',
                ...auth(),
              });
            }}
            onTransferHost={(targetUserName, targetUserId) => {
              socket.emit('transfer-leader', {
                roomId,
                targetUserName,
                targetUserId,
                ...auth(),
              });
            }}
            onRenameUser={(oldName, newName, targetUserId) => {
              socket.emit('rename-participant', { roomId, oldName, newName, targetUserId, ...auth() });
            }}
            onApproveJoin={(reqUserId, reqName) => {
              socket.emit('approve-join', { roomId, userId: reqUserId, name: reqName, ...auth() });
            }}
            onRejectJoin={(reqUserId, reqName, ban) => {
              socket.emit('reject-join', {
                roomId,
                userId: reqUserId,
                name: reqName,
                ban,
                requestedBy: myName,
                ...auth(),
              });
            }}
            onUpdateSettings={(settings) => {
              socket.emit('update-room-settings', { roomId, settings, ...auth() });
            }}
          />
        )}
      </div>
    </BottomSheet>
  );
};

export default RoomDrawer;
