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
  // Helper local: evita repetir buildSocketAuth(roomId, myName) en cada emit.
  // Se evalúa en el momento del emit (lee localStorage entonces), igual que antes.
  const auth = () => buildSocketAuth(roomId, myName);

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
            onToggleCoHost={(targetUserName, makeCoHost) => {
              socket.emit('set-role', {
                roomId,
                targetUserName,
                role: makeCoHost ? 'cohost' : 'member',
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
