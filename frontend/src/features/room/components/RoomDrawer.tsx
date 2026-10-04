import React from 'react';
import { BottomSheet } from '../../../shared/components/BottomSheet';
import { Chat } from '../../chat/Chat';
import { Participants } from '../../participants/Participants';
import type { IRoomData, ChatMessage } from '../../../types/room';
import type { Socket } from 'socket.io-client';
import { buildSocketAuth } from '../../../shared/utils';

/**
 * Drawer lateral chat/participantes (extraído verbatim de pages/Room.tsx).
 */
interface RoomDrawerProps {
  activeSideTab: 'chat' | 'participants' | null;
  sideTabView: 'chat' | 'participants';
  setActiveSideTab: React.Dispatch<React.SetStateAction<'chat' | 'participants' | null>>;
  messages: ChatMessage[];
  handleSendMessage: (text: string) => void;
  myName: string;
  roomData: IRoomData;
  userId: string;
  isHost: boolean;
  peerMediaStates: Record<string, { isCameraOn: boolean; isMicOn: boolean; userName?: string }>;
  isMicOn: boolean;
  isCameraOn: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
  socket: Socket;
  roomId: string;
}

export const RoomDrawer: React.FC<RoomDrawerProps> = ({
  activeSideTab,
  sideTabView,
  setActiveSideTab,
  messages,
  handleSendMessage,
  myName,
  roomData,
  userId,
  isHost,
  peerMediaStates,
  isMicOn,
  isCameraOn,
  toggleMic,
  toggleCamera,
  socket,
  roomId,
}) => {
  return (
    <BottomSheet
      open={!!activeSideTab}
      onClose={() => setActiveSideTab(null)}
      variant="inline"
      desktopClassName={`meet-drawer ${sideTabView === 'participants' ? 'meet-drawer--wide' : ''}`}
      height={85}
      label={sideTabView === 'participants' ? 'Participantes' : 'Chat'}
    >
      <div className="meet-drawer__body">
        {sideTabView === 'chat' && (
          <Chat
            messages={messages}
            onSendMessage={handleSendMessage}
            currentUserName={myName}
            onClose={() => setActiveSideTab(null)}
          />
        )}
        {sideTabView === 'participants' && (
          <Participants
            onClose={() => setActiveSideTab(null)}
            participants={roomData.participants}
            currentUserName={myName}
            currentUserId={userId}
            isHost={isHost}
            isCoHost={roomData.participants.some(
              (p) =>
                (p.userId ? p.userId === userId : p.name.toLowerCase() === myName.toLowerCase()) &&
                p.role === 'cohost'
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
              socket.emit('moderate-mute-user', { roomId, targetUserName, targetSocketId, ...buildSocketAuth(roomId, myName) });
            }}
            onDisableCamUser={(targetUserName, targetSocketId) => {
              socket.emit('moderate-disable-camera', { roomId, targetUserName, targetSocketId, ...buildSocketAuth(roomId, myName) });
            }}
            onMuteAll={() => {
              socket.emit('moderate-mute-all', { roomId, ...buildSocketAuth(roomId, myName) });
            }}
            onDisableAllCameras={() => {
              socket.emit('moderate-disable-all-cameras', { roomId, ...buildSocketAuth(roomId, myName) });
            }}
            onKickUser={(targetUserName, targetUserId) => {
              socket.emit('kick-user', { roomId, targetUserName, targetUserId, kickedBy: myName, ban: false, ...buildSocketAuth(roomId, myName) });
            }}
            onBanUser={(targetUserName, targetUserId) => {
              socket.emit('kick-user', { roomId, targetUserName, targetUserId, kickedBy: myName, ban: true, ...buildSocketAuth(roomId, myName) });
            }}
            onUnbanUser={(targetUserName, targetUserId) => {
              socket.emit('unban-user', { roomId, targetUserName, targetUserId, ...buildSocketAuth(roomId, myName) });
            }}
            onToggleCoHost={(targetUserName, makeCoHost) => {
              socket.emit('set-role', {
                roomId,
                targetUserName,
                role: makeCoHost ? 'cohost' : 'member',
                ...buildSocketAuth(roomId, myName),
              });
            }}
            onRenameUser={(oldName, newName, targetUserId) => {
              socket.emit('rename-participant', { roomId, oldName, newName, targetUserId, ...buildSocketAuth(roomId, myName) });
            }}
            onApproveJoin={(reqUserId, reqName) => {
              socket.emit('approve-join', { roomId, userId: reqUserId, name: reqName, ...buildSocketAuth(roomId, myName) });
            }}
            onRejectJoin={(reqUserId, reqName, ban) => {
              socket.emit('reject-join', {
                roomId,
                userId: reqUserId,
                name: reqName,
                ban,
                requestedBy: myName,
                ...buildSocketAuth(roomId, myName),
              });
            }}
            onUpdateSettings={(settings) => {
              socket.emit('update-room-settings', { roomId, settings, ...buildSocketAuth(roomId, myName) });
            }}
          />
        )}
      </div>
    </BottomSheet>
  );
};
