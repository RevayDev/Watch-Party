import React from 'react';
import { MessageSquare, Users, Music, X } from 'lucide-react';
import { BottomSheet } from '../../../shared/components/BottomSheet';
import { Chat } from '../../chat/Chat';
import { Participants } from '../../participants/Participants';
import { MusicPanel } from './MusicPanel';
import type { IRoomData, IMusicQueueEntry, IMusicNowPlaying, IMusicTrack, IRoomSettings, ChatMessage } from '../../../types/room';
import type { Socket } from 'socket.io-client';
import { buildSocketAuth } from '../../../shared/utils';

/**
 * Drawer lateral chat/participantes/música (con barra de pestañas siempre visible).
 */
interface RoomDrawerProps {
  activeSideTab: 'chat' | 'participants' | 'music' | null;
  sideTabView: 'chat' | 'participants' | 'music';
  setActiveSideTab: React.Dispatch<React.SetStateAction<'chat' | 'participants' | 'music' | null>>;
  messages: ChatMessage[];
  handleSendMessage: (text: string) => void;
  typingUsers: string[];
  onTyping: () => void;
  myName: string;
  roomData: IRoomData;
  userId: string;
  isLeader: boolean;
  peerMediaStates: Record<string, { isCameraOn: boolean; isMicOn: boolean; userName?: string }>;
  isMicOn: boolean;
  isCameraOn: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
  socket: Socket;
  roomId: string;
  musicOpen?: boolean;
  onOpenMusic?: () => void;
  musicQueue?: IMusicQueueEntry[];
  musicNowPlaying?: IMusicNowPlaying | null;
  musicSettings?: IRoomSettings;
  musicIsModerator?: boolean;
  onAddMusicUrl?: (url: string) => Promise<boolean>;
  onMusicAdd?: (t: IMusicTrack) => void;
  onMusicVote?: (id: string) => void;
  onMusicRemove?: (id: string) => void;
  onMusicReorder?: (ids: string[]) => void;
  onMusicApprove?: (id: string) => void;
  onMusicNext?: () => void;
  onMusicStop?: () => void;
}

export const RoomDrawer: React.FC<RoomDrawerProps> = ({
  activeSideTab,
  sideTabView,
  setActiveSideTab,
  messages,
  handleSendMessage,
  typingUsers,
  onTyping,
  myName,
  roomData,
  userId,
  isLeader,
  peerMediaStates,
  isMicOn,
  isCameraOn,
  toggleMic,
  toggleCamera,
  socket,
  roomId,
  musicOpen = false,
  onOpenMusic = () => undefined,
  musicQueue = [],
  musicNowPlaying = null,
  musicSettings,
  musicIsModerator = false,
  onAddMusicUrl,
  onMusicAdd = () => undefined,
  onMusicVote = () => undefined,
  onMusicRemove = () => undefined,
  onMusicReorder = () => undefined,
  onMusicApprove = () => undefined,
  onMusicNext = () => undefined,
  onMusicStop = () => undefined,
}) => {
  const auth = () => buildSocketAuth(roomId, myName);
  const currentTab = activeSideTab ?? sideTabView;

  return (
    <BottomSheet
      open={!!activeSideTab}
      onClose={() => setActiveSideTab(null)}
      variant="inline"
      desktopClassName={`meet-drawer ${currentTab === 'participants' ? 'meet-drawer--wide' : ''}`}
      height={85}
      label={currentTab === 'participants' ? 'Participantes' : currentTab === 'music' ? 'Música' : 'Chat'}
    >
      <div className="meet-drawer__body">
        {/* Header con pestañas integradas SIEMPRE visible en el drawer */}
        <div className="meet-drawer__tab-header">
          <div className="meet-drawer__tab-group" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={currentTab === 'chat'}
              className={`meet-drawer__tab-btn ${currentTab === 'chat' ? 'meet-drawer__tab-btn--active' : ''}`}
              onClick={() => setActiveSideTab('chat')}
            >
              <MessageSquare size={16} />
              <span>Chat</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={currentTab === 'participants'}
              className={`meet-drawer__tab-btn ${currentTab === 'participants' ? 'meet-drawer__tab-btn--active' : ''}`}
              onClick={() => setActiveSideTab('participants')}
            >
              <Users size={16} />
              <span>Participantes ({roomData.participants.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={currentTab === 'music'}
              className={`meet-drawer__tab-btn ${currentTab === 'music' ? 'meet-drawer__tab-btn--active' : ''}`}
              onClick={() => setActiveSideTab('music')}
            >
              <Music size={16} />
              <span>Música</span>
              {musicQueue.length > 0 && (
                <span className="meet-drawer__tab-badge">{musicQueue.length}</span>
              )}
            </button>
          </div>
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
            messages={messages}
            onSendMessage={handleSendMessage}
            currentUserName={myName}
            typingUsers={typingUsers}
            onTyping={onTyping}
            onClose={() => setActiveSideTab(null)}
            roomId={roomId}
            musicOpen={musicOpen}
            onOpenMusic={onOpenMusic}
          />
        )}
        {currentTab === 'participants' && (
          <Participants
            onClose={() => setActiveSideTab(null)}
            participants={roomData.participants}
            currentUserName={myName}
            currentUserId={userId}
            isLeader={isLeader}
            isCoLeader={roomData.participants.some(
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
        {currentTab === 'music' && (
          <MusicPanel
            roomId={roomId}
            queue={musicQueue}
            nowPlaying={musicNowPlaying}
            settings={musicSettings ?? roomData.settings ?? ({} as IRoomSettings)}
            isModerator={musicIsModerator}
            myName={myName}
            userId={userId}
            onAddUrl={onAddMusicUrl}
            onAdd={onMusicAdd}
            onVote={onMusicVote}
            onRemove={onMusicRemove}
            onReorder={onMusicReorder}
            onApprove={onMusicApprove}
            onNext={onMusicNext}
            onStop={onMusicStop}
          />
        )}
      </div>
    </BottomSheet>
  );
};

export default RoomDrawer;
