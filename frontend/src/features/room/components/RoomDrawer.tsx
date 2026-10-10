import React from 'react';
import { BottomSheet } from '../../../shared/components/BottomSheet';
import { Chat } from '../../chat/Chat';
import { Participants } from '../../participants/Participants';
import { MusicPanel } from './MusicPanel';
import type { IRoomData, IMusicQueueEntry, IMusicNowPlaying, IMusicTrack, IRoomSettings, ChatMessage } from '../../../types/room';
import type { Socket } from 'socket.io-client';
import { buildSocketAuth } from '../../../shared/utils';

/**
 * Drawer lateral chat/participantes/música (extraído verbatim de pages/Room.tsx).
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
  /** Spotify en el chat: enlace de lo que suena + ambiente. */
  spotifyOpenUrl?: string | null;
  canPlayAmbient?: boolean;
  onPlayAmbient?: () => Promise<void>;
  /** Música/Spotify: cola colaborativa (opcionales: sin esto no se muestra el tab). */
  musicQueue?: IMusicQueueEntry[];
  musicNowPlaying?: IMusicNowPlaying | null;
  musicSettings?: IRoomSettings;
  musicIsModerator?: boolean;
  musicSpotifyConnected?: boolean;
  onMusicSearch?: (q: string) => Promise<IMusicTrack[] | null>;
  onMusicAdd?: (t: IMusicTrack) => void;
  onMusicVote?: (id: string) => void;
  onMusicRemove?: (id: string) => void;
  onMusicReorder?: (ids: string[]) => void;
  onMusicApprove?: (id: string) => void;
  onMusicNext?: () => void;
  onMusicStop?: () => void;
  onMusicConnect?: () => void;
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
  spotifyOpenUrl = null,
  canPlayAmbient = false,
  onPlayAmbient = async () => undefined,
  musicQueue = [],
  musicNowPlaying = null,
  musicSettings,
  musicIsModerator = false,
  musicSpotifyConnected = false,
  onMusicSearch = async () => null,
  onMusicAdd = () => undefined,
  onMusicVote = () => undefined,
  onMusicRemove = () => undefined,
  onMusicReorder = () => undefined,
  onMusicApprove = () => undefined,
  onMusicNext = () => undefined,
  onMusicStop = () => undefined,
  onMusicConnect = () => undefined,
}) => {
  // Helper local: evita repetir buildSocketAuth(roomId, myName) en cada emit.
  // Se evalúa en el momento del emit (lee localStorage entonces), igual que antes.
  const auth = () => buildSocketAuth(roomId, myName);
  const drawerLabel = sideTabView === 'participants' ? 'Participantes' : sideTabView === 'music' ? 'Música' : 'Chat';

  return (
    <BottomSheet
      open={!!activeSideTab}
      onClose={() => setActiveSideTab(null)}
      variant="inline"
      desktopClassName={`meet-drawer ${sideTabView === 'participants' ? 'meet-drawer--wide' : ''}`}
      height={85}
      label={drawerLabel}
    >
      <div className="meet-drawer__body">
        {sideTabView === 'chat' && (
          <Chat
            messages={messages}
            onSendMessage={handleSendMessage}
            currentUserName={myName}
            typingUsers={typingUsers}
            onTyping={onTyping}
            onClose={() => setActiveSideTab(null)}
            roomId={roomId}
            spotifyOpenUrl={spotifyOpenUrl}
            canPlayAmbient={canPlayAmbient}
            onPlayAmbient={onPlayAmbient}
          />
        )}
        {sideTabView === 'participants' && (
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
        {sideTabView === 'music' && (
          <MusicPanel
            roomId={roomId}
            queue={musicQueue}
            nowPlaying={musicNowPlaying}
            settings={musicSettings ?? roomData.settings ?? ({} as IRoomSettings)}
            isModerator={musicIsModerator}
            myName={myName}
            userId={userId}
            spotifyConnected={musicSpotifyConnected}
            onSearch={onMusicSearch}
            onAdd={onMusicAdd}
            onVote={onMusicVote}
            onRemove={onMusicRemove}
            onReorder={onMusicReorder}
            onApprove={onMusicApprove}
            onNext={onMusicNext}
            onStop={onMusicStop}
            onConnect={onMusicConnect}
          />
        )}
      </div>
    </BottomSheet>
  );
};
