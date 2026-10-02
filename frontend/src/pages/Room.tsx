import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { RoomHeader } from '../components/RoomHeader';
import { VideoPlayer } from '../components/VideoPlayer';
import { Participants } from '../components/Participants';
import { Chat } from '../components/Chat';
import { Reactions } from '../components/Reactions';
import { CameraGrid } from '../components/CameraGrid';
import { HostExitModal } from '../components/HostExitModal';
import { RoomSettingsModal } from '../components/RoomSettingsModal';
import { WaitingApproval } from '../components/WaitingApproval';
import { IRoomData, ChatMessage, ReactionItem } from '../types/room';
import { ApiService } from '../services/api';
import { getSocket, disconnectSocket } from '../services/socket';
import { removeRecentRoom } from '../services/recentRooms';
import { notify } from '../services/notifications';
import { useWebRTC } from '../hooks/useWebRTC';
import { useSwipeDown } from '../hooks/useSwipeDown';
import { usePresence } from '../hooks/usePresence';
import { Loader2, MessageSquare, Users, PhoneOff, PanelRightClose, PanelRightOpen, MoreVertical, Mic, MicOff, Video, VideoOff, Smile } from 'lucide-react';

// ── Audio helpers (Web Audio API) ─────────────────────────────────────────
function playJoinSound() {
  try {
    const ctx = new AudioContext();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    g.connect(ctx.destination);
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(880, ctx.currentTime);
    o1.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.18);
    o1.connect(g);
    o1.start();
    o1.stop(ctx.currentTime + 0.55);
    setTimeout(() => ctx.close(), 700);
  } catch (_) {}
}

function playLeaveSound() {
  try {
    const ctx = new AudioContext();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    g.connect(ctx.destination);
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(660, ctx.currentTime);
    o1.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.35);
    o1.connect(g);
    o1.start();
    o1.stop(ctx.currentTime + 0.55);
    setTimeout(() => ctx.close(), 700);
  } catch (_) {}
}

function playChatSound() {
  try {
    const ctx = new AudioContext();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    g.connect(ctx.destination);
    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    o1.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08); // E5
    o1.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16); // G5
    o1.connect(g);
    o1.start();
    o1.stop(ctx.currentTime + 0.35);
    setTimeout(() => ctx.close(), 500);
  } catch (_) {}
}

interface RoomProps {
  roomId: string;
  userName: string;
  isHost: boolean;
  onLeave: () => void;
}

export const Room: React.FC<RoomProps> = ({ roomId, userName, isHost: initialIsHost, onLeave }) => {
  // Stable user identity for this browser (never changes on rename → no duplicates)
  const userId = useMemo(() => {
    try {
      let id = localStorage.getItem('watchparty_user_id');
      if (!id) {
        id =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem('watchparty_user_id', id);
      }
      return id;
    } catch {
      return `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }, []);

  // Current display name (updates when THIS user is renamed)
  const [myName, setMyName] = useState(userName);
  // Waiting-list state (manual approval rooms)
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  // Media prefs chosen in the waiting lobby (mic/cam) — applied once admitted
  // (camera defaults ON so the guest sees their preview before entering)
  const pendingMediaPrefRef = useRef<{ micOn: boolean; camOn: boolean }>({ micOn: false, camOn: true });
  const applyMediaOnJoinRef = useRef(false);

  const [roomData, setRoomData] = useState<IRoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // True once the server confirmed entry with 'room-state' (blocks UI flash)
  const [joined, setJoined] = useState(false);
  const [isHost, setIsHost] = useState(initialIsHost);
  // Ref mirror of isHost so socket handlers never read a stale value
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  // Ref mirror of pending request count (for "new request" toasts)
  const joinRequestsLenRef = useRef(0);
  const [showHostExitModal, setShowHostExitModal] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ReactionItem[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [remoteAction, setRemoteAction] = useState<{
    action: 'play' | 'pause' | 'seek';
    currentTime: number;
    sentAt?: number;
    timestamp: number;
  } | null>(null);

  // Active side panel tab: null | 'chat' | 'participants'
  const [activeSideTab, setActiveSideTab] = useState<'chat' | 'participants' | null>(null);
  // Show emoji reactions popup over toolbar
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  // Toggle collapse right cameras strip accordion
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  // Unread messages counter (resets when chat tab opened)
  const [unreadCount, setUnreadCount] = useState(0);
  // Mobile “More” dropdown menu
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  // Room settings gear modal (name, info, save-mode, timer)
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  // Swipe-down-to-dismiss for the phone drawer (chat / participants)
  const drawerSheetRef = useSwipeDown<HTMLElement>(
    () => setActiveSideTab(null),
    !!activeSideTab
  );
  // Exit animations (drawer, ⋯ menu, emoji popup)
  const drawerPresence = usePresence(!!activeSideTab);
  const morePresence = usePresence(showMoreMenu, 160);
  const emojiPresence = usePresence(showEmojiPicker, 160);
  // Keep the last opened tab so the drawer still renders content while closing
  const lastSideTabRef = useRef<'chat' | 'participants'>('chat');
  if (activeSideTab) lastSideTabRef.current = activeSideTab;
  const sideTabView = activeSideTab ?? lastSideTabRef.current;
  // Ref mirror of the open side tab (socket handlers read it without stale closures)
  const activeSideTabRef = useRef<'chat' | 'participants' | null>(null);
  activeSideTabRef.current = activeSideTab;

  // Auto-hide toolbar and header on inactivity (like YouTube / Netflix / Google Meet)
  const [isBarVisible, setIsBarVisible] = useState(true);
  const hideBarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetBarTimer = useCallback(() => {
    // Only auto-hide in landscape mode or full desktop when inactive; NEVER hide in portrait mobile
    const isMobilePortrait = window.innerWidth <= 768 && window.innerHeight > window.innerWidth;
    if (isMobilePortrait) {
      setIsBarVisible(true);
      return;
    }

    setIsBarVisible(true);
    if (hideBarTimeoutRef.current) {
      clearTimeout(hideBarTimeoutRef.current);
    }
    // Auto hide after 4.5 seconds of inactivity
    hideBarTimeoutRef.current = setTimeout(() => {
      setShowMoreMenu((currentMenu) => {
        setShowEmojiPicker((currentEmoji) => {
          if (!currentMenu && !currentEmoji) {
            setIsBarVisible(false);
          }
          return currentEmoji;
        });
        return currentMenu;
      });
    }, 4500);
  }, []);

  useEffect(() => {
    const handleActivity = () => resetBarTimer();
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('touchstart', handleActivity, { passive: true });
    window.addEventListener('click', handleActivity);
    resetBarTimer();

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('click', handleActivity);
      if (hideBarTimeoutRef.current) clearTimeout(hideBarTimeoutRef.current);
    };
  }, [resetBarTimer]);

  // If user opens menu or emoji picker, keep bar visible
  useEffect(() => {
    if (showMoreMenu || showEmojiPicker) {
      setIsBarVisible(true);
      if (hideBarTimeoutRef.current) clearTimeout(hideBarTimeoutRef.current);
    } else {
      resetBarTimer();
    }
  }, [showMoreMenu, showEmojiPicker, resetBarTimer]);

  // Close more menu when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    if (showMoreMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMoreMenu]);

  // Reset unread count when chat tab is opened
  useEffect(() => {
    if (activeSideTab === 'chat') setUnreadCount(0);
  }, [activeSideTab]);

  // WebRTC hook for Voice and Camera
  const socket = getSocket();
  const {
    localStream,
    remotePeers,
    peerMediaStates,
    isMicOn,
    isCameraOn,
    mediaError,
    toggleMic,
    toggleCamera,
    enableMedia,
  } = useWebRTC(socket, roomId, myName, isHost);

  // 1. Initial Room Fetch + Socket.IO connection
  useEffect(() => {
    let isMounted = true;

    // Join room via Socket.IO (hoisted so it can be unsubscribed on cleanup)
    const emitJoin = () => {
      socket.emit('join-room', { roomId, userName: myName, isHost: initialIsHost, userId });
    };

    async function loadRoom() {
      try {
        setLoading(true);
        const data = await ApiService.getRoom(roomId);
        if (isMounted) {
          setRoomData(data);
          if (data.hostName.toLowerCase() === myName.toLowerCase()) {
            setIsHost(true);
            localStorage.setItem(
              'watchparty_host_session',
              JSON.stringify({ roomId, hostName: myName })
            );
          }
        }

        if (socket.connected) {
          emitJoin();
        }
        socket.on('connect', emitJoin);
      } catch (err: any) {
        if (isMounted) setError(err.message || 'No se pudo cargar la sala.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadRoom();

    // ── Socket Listeners ──────────────────────────────────────────────────────
    const handleRoomState = (state: {
      video: any;
      participants: any[];
      hostName?: string;
      isHost?: boolean;
      isTemporary?: boolean;
      settings?: any;
      joinRequests?: any[];
      kickedUsers?: any[];
      playback?: { currentTime: number; isPlaying: boolean } | null;
    }) => {
      setRoomData((prev) =>
        prev
          ? {
              ...prev,
              video: state.video,
              participants: state.participants,
              isTemporary: state.isTemporary !== undefined ? state.isTemporary : prev.isTemporary,
              settings: state.settings || prev.settings,
              joinRequests: state.joinRequests || prev.joinRequests,
              kickedUsers: state.kickedUsers || prev.kickedUsers,
            }
          : null
      );
      setAwaitingApproval(false);
      setJoined(true);
      joinRequestsLenRef.current = state.joinRequests?.length || 0;
      if (state.isHost !== undefined) setIsHost(state.isHost);

      // Admitted from the waiting lobby → apply the mic/cam prefs chosen there
      if (applyMediaOnJoinRef.current) {
        applyMediaOnJoinRef.current = false;
        const { micOn, camOn } = pendingMediaPrefRef.current;
        if (micOn || camOn) {
          enableMedia(micOn, camOn);
        }
      }

      if (state.playback && state.video) {
        setRemoteAction({
          action: state.playback.isPlaying ? 'play' : 'seek',
          currentTime: state.playback.currentTime,
          sentAt: Date.now(),
          timestamp: Date.now(),
        });
      }
    };

    const handleHostChanged = (data: { newHostName: string; participants: any[] }) => {
      setRoomData((prev) =>
        prev ? { ...prev, participants: data.participants, hostName: data.newHostName } : null
      );
      const amINewHost = data.newHostName.toLowerCase() === myName.toLowerCase();
      if (amINewHost) {
        setIsHost(true);
        localStorage.setItem(
          'watchparty_host_session',
          JSON.stringify({ roomId, hostName: myName })
        );
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          user: 'Sistema',
          text: `👑 ${data.newHostName} es ahora el nuevo Anfitrión (Host) de la sala`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    };

    const handleRoomClosed = (data: { message: string }) => {
      notify('error', data.message || 'La sala ha sido cerrada por el anfitrión.', 'Sala cerrada');
      clearRoomLocalData();
      disconnectSocket();
      onLeave();
    };

    const handleUserJoined = (data: { socketId?: string; userName: string; participants: any[] }) => {
      setRoomData((prev) => (prev ? { ...prev, participants: data.participants } : null));
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.user === 'Sistema' && last.text.includes(data.userName) && last.text.includes('se ha unido')) {
          return prev;
        }
        return [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            user: 'Sistema',
            text: `👋 ${data.userName} se ha unido a la sala`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ];
      });
      if (data.userName.toLowerCase() !== myName.toLowerCase()) {
        playJoinSound();
        notify('info', `${data.userName} se unió a la sala`, 'Participantes');
      }
    };

    const handleUserLeft = (data: { userName: string; participants: any[] }) => {
      setRoomData((prev) => (prev ? { ...prev, participants: data.participants } : null));
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.user === 'Sistema' && last.text.includes(data.userName) && last.text.includes('ha salido')) {
          return prev;
        }
        return [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            user: 'Sistema',
            text: `🚪 ${data.userName} ha salido de la sala`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ];
      });
      if (data.userName && data.userName.toLowerCase() !== myName.toLowerCase()) {
        playLeaveSound();
        notify('info', `${data.userName} salió de la sala`, 'Participantes');
      }
    };

    const handleVideoChanged = (data: { video: any }) => {
      setRoomData((prev) => (prev ? { ...prev, video: data.video, status: 'active' } : null));
      setRemoteAction(null);
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          user: 'Sistema',
          text: `🎬 Nuevo video disponible: ${data.video.originalName}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    };

    const handleSyncVideo = (data: { action: 'play' | 'pause' | 'seek'; currentTime: number; sentAt?: number }) => {
      setRemoteAction({
        action: data.action,
        currentTime: data.currentTime,
        sentAt: data.sentAt,
        timestamp: Date.now(),
      });
    };

    const handleChatMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      if (activeSideTabRef.current !== 'chat') {
        setUnreadCount((n) => n + 1);
        if (msg.user.toLowerCase() !== myName.toLowerCase()) {
          playChatSound();
          notify('info', `${msg.user}: ${msg.text}`, 'Nuevo mensaje', () => {
            setActiveSideTab('chat');
          });
        }
      }
    };

    const handleReactionEvent = (reaction: ReactionItem) => {
      setReactions((prev) => [...prev, reaction]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
      }, 2600);
    };

    // Moderation remote actions
    const handleForceMuteUser = (data: { targetSocketId?: string; targetUserName: string }) => {
      if (data.targetUserName.toLowerCase() === myName.toLowerCase() || data.targetSocketId === socket.id) {
        enableMedia(false, isCameraOn);
        notify('warning', 'El anfitrión o co-anfitrión ha silenciado tu micrófono.', 'Micro silenciado');
      }
    };

    const handleForceDisableCamera = (data: { targetSocketId?: string; targetUserName: string }) => {
      if (data.targetUserName.toLowerCase() === myName.toLowerCase() || data.targetSocketId === socket.id) {
        enableMedia(isMicOn, false);
        notify('warning', 'El anfitrión o co-anfitrión ha apagado tu cámara.', 'Cámara apagada');
      }
    };

    const handleForceMuteAll = () => {
      if (!isHost) {
        enableMedia(false, isCameraOn);
      }
    };

    const handleForceDisableAllCameras = () => {
      if (!isHost) {
        enableMedia(isMicOn, false);
      }
    };

    const handleUserKicked = (data: {
      targetUserName: string;
      targetUserId?: string;
      kickedBy: string;
      banned?: boolean;
      participants: any[];
      kickedUsers: any[];
    }) => {
      setRoomData((prev) =>
        prev
          ? { ...prev, participants: data.participants, kickedUsers: data.kickedUsers }
          : null
      );
      const amITarget =
        (data.targetUserId && data.targetUserId === userId) ||
        data.targetUserName.toLowerCase() === myName.toLowerCase();
      if (amITarget) {
        notify(
          'error',
          data.banned
            ? `Has sido baneado de la sala por ${data.kickedBy}.`
            : `Has sido expulsado de la sala por ${data.kickedBy}.`,
          data.banned ? 'Baneado' : 'Expulsado'
        );
        clearRoomLocalData();
        disconnectSocket();
        onLeave();
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            user: 'Sistema',
            text: data.banned
              ? `⛔ ${data.targetUserName} fue baneado de la sala por ${data.kickedBy}`
              : `🚫 ${data.targetUserName} fue expulsado de la sala por ${data.kickedBy}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      }
    };

    const handleKickedUsersUpdated = (data: { kickedUsers: any[] }) => {
      setRoomData((prev) => (prev ? { ...prev, kickedUsers: data.kickedUsers } : prev));
    };

    const handleParticipantRoleUpdated = (data: { targetUserName: string; role: string; participants: any[] }) => {
      setRoomData((prev) => (prev ? { ...prev, participants: data.participants } : null));
      if (data.targetUserName.toLowerCase() === myName.toLowerCase()) {
        if (data.role === 'cohost') {
          notify('success', '¡Ahora eres Co-Afitrión de la sala!', 'Nuevo rol');
        }
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          user: 'Sistema',
          text: `🎖️ ${data.targetUserName} ahora tiene el rol: ${data.role === 'cohost' ? 'Co-Afitrión' : 'Miembro'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    };

    const handleParticipantRenamed = (data: {
      oldName: string;
      newName: string;
      userId?: string;
      participants: any[];
    }) => {
      setRoomData((prev) => (prev ? { ...prev, participants: data.participants } : null));

      // If THIS user was renamed, adopt the new name everywhere (identity = userId)
      const isMe =
        (data.userId && data.userId === userId) ||
        (!data.userId && data.oldName.toLowerCase() === myName.toLowerCase()) ||
        data.oldName.toLowerCase() === myName.toLowerCase();
      if (isMe && data.newName !== myName) {
        setMyName(data.newName);
        try {
          const raw = localStorage.getItem('watchparty_host_session');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.roomId?.toUpperCase() === roomId.toUpperCase() && parsed.hostName === data.oldName) {
              parsed.hostName = data.newName;
              localStorage.setItem('watchparty_host_session', JSON.stringify(parsed));
            }
          }
        } catch {
          // ignore parse errors
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          user: 'Sistema',
          text: `✏️ ${data.oldName} ahora se llama ${data.newName}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    };

    // ── Waiting list (manual approval) ──────────────────────────────────────
    const handleJoinPending = () => {
      setJoined(false);
      setAwaitingApproval(true);
    };

    const handleJoinApproved = () => {
      // Apply the lobby media prefs once room-state arrives
      applyMediaOnJoinRef.current = true;
      setAwaitingApproval(false);
      // Re-run the join flow now that we were accepted
      socket.emit('join-room', { roomId, userName: myName, isHost: initialIsHost, userId });
    };

    const handleJoinRejected = (data: { reason?: string; message?: string }) => {
      setAwaitingApproval(false);
      setJoined(false);
      notify(
        data.reason === 'banned' ? 'error' : 'warning',
        data.message || 'Tu solicitud para unirte fue rechazada.',
        data.reason === 'banned' ? 'Baneado' : 'Solicitud rechazada'
      );
      clearRoomLocalData();
      disconnectSocket();
      onLeave();
    };

    const handleJoinRequestsUpdated = (data: { joinRequests: any[] }) => {
      const nextList = data.joinRequests || [];
      const prevLen = joinRequestsLenRef.current;
      joinRequestsLenRef.current = nextList.length;
      setRoomData((prev) => (prev ? { ...prev, joinRequests: nextList } : prev));
      // Host/co-host: pop a toast when a NEW join request arrives
      if (nextList.length > prevLen && isHostRef.current) {
        const newest = nextList[nextList.length - 1];
        notify(
          'info',
          `${newest?.name || 'Alguien'} quiere unirse a la sala. Revisa la pestaña Solicitudes.`,
          'Nueva solicitud de entrada'
        );
      }
    };

    const handleRoomSettingsUpdated = (data: { settings: any }) => {
      setRoomData((prev) =>
        prev
          ? {
              ...prev,
              settings: data.settings,
              isTemporary: data.settings.isTemporary !== undefined ? data.settings.isTemporary : prev.isTemporary,
            }
          : null
      );
    };

    const handleUploadProgressEvent = (data: { progress: number | null; fileName?: string }) => {
      setUploadProgress(data.progress);
    };

    socket.on('room-state', handleRoomState);
    socket.on('host-changed', handleHostChanged);
    socket.on('room-closed', handleRoomClosed);
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('video-changed', handleVideoChanged);
    socket.on('sync-video', handleSyncVideo);
    socket.on('upload-progress', handleUploadProgressEvent);
    socket.on('chat-message', handleChatMessage);
    socket.on('reaction', handleReactionEvent);
    socket.on('force-mute-user', handleForceMuteUser);
    socket.on('force-disable-camera', handleForceDisableCamera);
    socket.on('force-mute-all', handleForceMuteAll);
    socket.on('force-disable-all-cameras', handleForceDisableAllCameras);
    socket.on('user-kicked', handleUserKicked);
    socket.on('participant-role-updated', handleParticipantRoleUpdated);
    socket.on('participant-renamed', handleParticipantRenamed);
    socket.on('room-settings-updated', handleRoomSettingsUpdated);
    socket.on('kicked-users-updated', handleKickedUsersUpdated);
    socket.on('join-pending', handleJoinPending);
    socket.on('join-approved', handleJoinApproved);
    socket.on('join-rejected', handleJoinRejected);
    socket.on('join-requests-updated', handleJoinRequestsUpdated);

    return () => {
      isMounted = false;
      socket.off('connect', emitJoin);
      socket.off('room-state', handleRoomState);
      socket.off('host-changed', handleHostChanged);
      socket.off('room-closed', handleRoomClosed);
      socket.off('user-joined', handleUserJoined);
      socket.off('user-left', handleUserLeft);
      socket.off('video-changed', handleVideoChanged);
      socket.off('sync-video', handleSyncVideo);
      socket.off('upload-progress', handleUploadProgressEvent);
      socket.off('chat-message', handleChatMessage);
      socket.off('reaction', handleReactionEvent);
      socket.off('force-mute-user', handleForceMuteUser);
      socket.off('force-disable-camera', handleForceDisableCamera);
      socket.off('force-mute-all', handleForceMuteAll);
      socket.off('force-disable-all-cameras', handleForceDisableAllCameras);
      socket.off('user-kicked', handleUserKicked);
      socket.off('participant-role-updated', handleParticipantRoleUpdated);
      socket.off('participant-renamed', handleParticipantRenamed);
      socket.off('room-settings-updated', handleRoomSettingsUpdated);
      socket.off('kicked-users-updated', handleKickedUsersUpdated);
      socket.off('join-pending', handleJoinPending);
      socket.off('join-approved', handleJoinApproved);
      socket.off('join-rejected', handleJoinRejected);
      socket.off('join-requests-updated', handleJoinRequestsUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myName, initialIsHost, socket, onLeave, enableMedia, userId]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleToggleTemporaryMode = () => {
    if (!isHost || !roomData) return;
    const currentIsTemp = roomData.isTemporary !== false;
    const nextIsTemp = !currentIsTemp;
    socket.emit('update-room-settings', {
      roomId,
      settings: { ...roomData.settings, isTemporary: nextIsTemp },
    });
    setRoomData((prev) => (prev ? { ...prev, isTemporary: nextIsTemp } : null));
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        user: 'Sistema',
        text: `⚙️ Modo de sala cambiado a: ${
          nextIsTemp ? '⚡ Sala Temporal (se borra al salir)' : '💾 Sala Persistente (video queda guardado)'
        }`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  // ⚙ Configuración de sala: nombre + información
  const handleSaveRoomDetails = (name: string, description: string) => {
    if (!isHost || !roomData) return;
    socket.emit('update-room-settings', {
      roomId,
      settings: { ...roomData.settings, name, description },
    });
    setRoomData((prev) =>
      prev
        ? {
            ...prev,
            settings: { ...prev.settings, name, description } as IRoomData['settings'],
          }
        : null
    );
  };

  // ⚙ Configuración de sala: temporizador de cierre automático (minutes = null → eliminar)
  const handleSetRoomTimer = (minutes: number | null) => {
    if (!isHost || !roomData) return;
    const timerEndsAt = minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null;
    socket.emit('update-room-settings', {
      roomId,
      settings: { ...roomData.settings, timerMinutes: minutes, timerEndsAt },
    });
    setRoomData((prev) =>
      prev
        ? {
            ...prev,
            settings: { ...prev.settings, timerMinutes: minutes, timerEndsAt } as IRoomData['settings'],
          }
        : null
    );
    notify(
      'info',
      minutes
        ? `La sala se cerrará automáticamente en ${minutes} minuto${minutes > 1 ? 's' : ''}.`
        : 'Temporizador de sala eliminado.',
      'Configuración de sala'
    );
  };

  const handleLeaveClick = () => {
    if (isHost) setShowHostExitModal(true);
    else handleLeaveOnlyMe();
  };

  // Clears local data only for THIS room (keeps sessions of other rooms intact)
  const clearRoomLocalData = () => {
    try {
      const raw = localStorage.getItem('watchparty_host_session');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.roomId && parsed.roomId.toUpperCase() === roomId.toUpperCase()) {
          localStorage.removeItem('watchparty_host_session');
        }
      }
    } catch {
      // ignore parse errors
    }
    removeRecentRoom(roomId);
  };

  const handleLeaveOnlyMe = () => {
    setShowHostExitModal(false);
    // Host session + recent room are KEPT so the room can be recovered from Home
    socket.emit('leave-room', { roomId, userName: myName, userId });
    disconnectSocket();
    onLeave();
  };

  const handleDeleteRoomForAll = () => {
    setShowHostExitModal(false);
    clearRoomLocalData();
    socket.emit('close-room', { roomId });
    disconnectSocket();
    onLeave();
  };

  const handleUploadVideo = async (file: File) => {
    try {
      setUploadProgress(0);
      socket.emit('upload-progress', { roomId, progress: 0, fileName: file.name });
      const res = await ApiService.uploadVideo(roomId, file, (progress) => {
        setUploadProgress(progress);
        socket.emit('upload-progress', { roomId, progress, fileName: file.name });
      });
      setRoomData((prev) => (prev ? { ...prev, video: res.video, status: 'active' } : null));
      socket.emit('video-changed', { roomId, video: res.video });
      socket.emit('upload-progress', { roomId, progress: null });
    } catch (err: any) {
      socket.emit('upload-progress', { roomId, progress: null });
      notify('error', err.message || 'Error al subir el video', 'Error al subir');
    } finally {
      setUploadProgress(null);
    }
  };

  const handleSetVideoUrl = async (url: string, title?: string) => {
    try {
      setLoading(true);
      const res = await ApiService.setVideoUrl(roomId, url, title);
      setRoomData((prev) => (prev ? { ...prev, video: res.video, status: 'active' } : null));
      socket.emit('video-changed', { roomId, video: res.video });
    } catch (err: any) {
      notify('error', err.message || 'Error al cargar el enlace de video', 'Error al cargar video');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAction = useCallback(
    (action: 'play' | 'pause' | 'seek', currentTime: number) => {
      socket.emit('sync-video', { roomId, action, currentTime });
    },
    [roomId, socket]
  );

  const handleSendMessage = (text: string) => {
    socket.emit('send-message', { roomId, text, userName: myName });
  };

  const handleReaction = (emoji: string) => {
    socket.emit('send-reaction', { roomId, emoji, userName: myName });
  };

  // ── Render states ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="room-loading">
        <Loader2 size={40} className="animate-spin room-loading__icon" />
        <p className="room-loading__text">Conectando a la sala <strong>{roomId}</strong>…</p>
      </div>
    );
  }

  if (error || !roomData) {
    return (
      <div className="container">
        <div className="card card--center">
          <h2 style={{ color: 'var(--color-danger)', marginBottom: '1rem' }}>Error</h2>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
            {error || 'Sala no disponible'}
          </p>
          <button onClick={handleLeaveOnlyMe} className="btn btn--primary btn--full">
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  // Waiting-list: manual approval rooms block the room UI until accepted
  if (awaitingApproval && !error) {
    return (
      <WaitingApproval
        roomId={roomId}
        userName={myName}
        initialMicOn={pendingMediaPrefRef.current.micOn}
        initialCamOn={pendingMediaPrefRef.current.camOn}
        onPrefChange={(micOn, camOn) => {
          pendingMediaPrefRef.current = { micOn, camOn };
        }}
        onCancel={() => {
          setAwaitingApproval(false);
          // Cancels the join request server-side (leave-room handles pending users)
          socket.emit('leave-room', { roomId, userName: myName, userId });
          // Give the packet a moment to flush before tearing the socket down
          setTimeout(() => {
            disconnectSocket();
            onLeave();
          }, 120);
        }}
      />
    );
  }

  // Not yet confirmed by the server (waiting for room-state) → keep loading
  if (!joined) {
    return (
      <div className="room-loading">
        <Loader2 size={40} className="animate-spin room-loading__icon" />
        <p className="room-loading__text">Conectando a la sala <strong>{roomId}</strong>…</p>
      </div>
    );
  }

  return (
    <div className={`meet-layout ${!isBarVisible ? 'meet-layout--bars-hidden' : ''}`}>
      {/* ── Top Header (Google Meet style) ── */}
      <RoomHeader
        roomId={roomData.roomId}
        participantCount={roomData.participants.length}
        isHost={isHost}
        roomName={roomData.settings?.name}
        roomDescription={roomData.settings?.description}
        timerEndsAt={roomData.settings?.timerEndsAt}
        onOpenSettings={() => setShowRoomSettings(true)}
        onLeaveClick={handleLeaveClick}
        className={!isBarVisible ? 'header--hidden' : ''}
      />

      {/* ── Main Stage Area: Left Video + Right Vertical Cameras Strip ── */}
      <main className={`meet-stage ${isRightPanelCollapsed ? 'meet-stage--cams-collapsed' : ''}`}>
        {/* Cinematic Video Card */}
        <section className="meet-stage__video-wrapper">
          <VideoPlayer
            roomId={roomId}
            video={roomData.video}
            isHost={isHost}
            onUploadVideo={handleUploadVideo}
            onSetVideoUrl={handleSetVideoUrl}
            uploadProgress={uploadProgress}
            onSyncAction={handleSyncAction}
            remoteAction={remoteAction}
            reactions={reactions}
            isMicOn={isMicOn}
          />
        </section>

        {/* Right Vertical Camera Strip (Collapsible Accordion Style) */}
        {!isRightPanelCollapsed && (
          <aside className="meet-stage__cams-strip">
            <CameraGrid
              localStream={localStream}
              remotePeers={remotePeers}
              participants={roomData.participants}
              currentUserName={myName}
              isHost={isHost}
              isMicOn={isMicOn}
              isCameraOn={isCameraOn}
              peerMediaStates={peerMediaStates}
            />
          </aside>
        )}

        {/* ── Slide-over Right Drawer for Chat or Participants ── */}
        {drawerPresence.shown && (
          <aside
            className={`meet-drawer ${sideTabView === 'participants' ? 'meet-drawer--wide' : ''} ${drawerPresence.closing ? 'meet-drawer--closing' : ''}`}
            ref={drawerSheetRef}
          >
            <div className="meet-drawer__body">
              {sideTabView === 'chat' && (
                <>
                  <div className="meet-drawer__header">
                    <h3>Mensajes del chat</h3>
                    <button onClick={() => setActiveSideTab(null)} className="meet-drawer__close-btn" title="Cerrar">
                      Cerrar
                    </button>
                  </div>
                  <Chat messages={messages} onSendMessage={handleSendMessage} />
                </>
              )}
              {sideTabView === 'participants' && (
                <Participants
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
                    socket.emit('moderate-mute-user', { roomId, targetUserName, targetSocketId });
                  }}
                  onDisableCamUser={(targetUserName, targetSocketId) => {
                    socket.emit('moderate-disable-camera', { roomId, targetUserName, targetSocketId });
                  }}
                  onMuteAll={() => {
                    socket.emit('moderate-mute-all', { roomId });
                  }}
                  onDisableAllCameras={() => {
                    socket.emit('moderate-disable-all-cameras', { roomId });
                  }}
                  onKickUser={(targetUserName, targetUserId) => {
                    socket.emit('kick-user', { roomId, targetUserName, targetUserId, kickedBy: myName, ban: false });
                  }}
                  onBanUser={(targetUserName, targetUserId) => {
                    socket.emit('kick-user', { roomId, targetUserName, targetUserId, kickedBy: myName, ban: true });
                  }}
                  onUnbanUser={(targetUserName, targetUserId) => {
                    socket.emit('unban-user', { roomId, targetUserName, targetUserId });
                  }}
                  onToggleCoHost={(targetUserName, makeCoHost) => {
                    socket.emit('set-role', {
                      roomId,
                      targetUserName,
                      role: makeCoHost ? 'cohost' : 'member',
                    });
                  }}
                  onRenameUser={(oldName, newName, targetUserId) => {
                    socket.emit('rename-participant', { roomId, oldName, newName, targetUserId });
                  }}
                  onApproveJoin={(reqUserId, reqName) => {
                    socket.emit('approve-join', { roomId, userId: reqUserId, name: reqName });
                  }}
                  onRejectJoin={(reqUserId, reqName, ban) => {
                    socket.emit('reject-join', {
                      roomId,
                      userId: reqUserId,
                      name: reqName,
                      ban,
                      requestedBy: myName,
                    });
                  }}
                  onUpdateSettings={(settings) => {
                    socket.emit('update-room-settings', { roomId, settings });
                  }}
                  onClose={() => setActiveSideTab(null)}
                />
              )}
            </div>
          </aside>
        )}
      </main>

      {/* ── Bottom Bar (text buttons) ── */}
      <footer className={`meet-bottom-bar ${!isBarVisible ? 'meet-bottom-bar--hidden' : ''}`}>
        {/* Mic toggle — green when ON, red when OFF */}
        <button
          onClick={toggleMic}
          className={`meet-circle-btn ${isMicOn ? 'meet-circle-btn--mic-on' : 'meet-circle-btn--off'}`}
          title={isMicOn ? 'Silenciar micrófono' : 'Activar micrófono'}
        >
          {isMicOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>

        {/* Camera toggle */}
        <button
          onClick={toggleCamera}
          className={`meet-circle-btn ${isCameraOn ? 'meet-circle-btn--on' : 'meet-circle-btn--off'}`}
          title={isCameraOn ? 'Apagar cámara' : 'Activar cámara'}
        >
          {isCameraOn ? <Video size={18} /> : <VideoOff size={18} />}
        </button>

        {/* Emoji Reactions trigger */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowEmojiPicker((v) => !v)}
            className={`meet-circle-btn ${showEmojiPicker ? 'meet-circle-btn--active' : ''}`}
            title="Enviar reacción"
          >
            <Smile size={18} />
          </button>

          {emojiPresence.shown && (
            <div className={`meet-emoji-popup ${emojiPresence.closing ? 'meet-emoji-popup--closing' : ''}`}>
              <Reactions onReact={(emoji) => { handleReaction(emoji); setShowEmojiPicker(false); }} />
            </div>
          )}
        </div>

        {/* Chat Drawer Toggle — hidden on mobile (moved to … menu) */}
        <button
          onClick={() => { setActiveSideTab((v) => (v === 'chat' ? null : 'chat')); }}
          className={`meet-circle-btn meet-btn--hide-mobile ${activeSideTab === 'chat' ? 'meet-circle-btn--active' : ''}`}
          title="Chat"
        >
          <MessageSquare size={18} />
          {unreadCount > 0 && activeSideTab !== 'chat' && (
            <span className="meet-badge-dot" />
          )}
        </button>

        {/* Participants Drawer Toggle — hidden on mobile (moved to … menu) */}
        <button
          onClick={() => setActiveSideTab((v) => (v === 'participants' ? null : 'participants'))}
          className={`meet-circle-btn meet-btn--hide-mobile ${activeSideTab === 'participants' ? 'meet-circle-btn--active' : ''}`}
          title="Ver participantes"
        >
          <Users size={18} />
        </button>

        {/* Toggle Collapse Cameras Strip (Accordion) — hidden on mobile */}
        <button
          onClick={() => setIsRightPanelCollapsed((v) => !v)}
          className={`meet-circle-btn meet-btn--hide-mobile ${isRightPanelCollapsed ? 'meet-circle-btn--active' : ''}`}
          title={isRightPanelCollapsed ? 'Mostrar cámaras laterales' : 'Ocultar cámaras laterales'}
        >
          {isRightPanelCollapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
        </button>

        {/* ⋯ More Menu — visible only on mobile (the only icon-only button besides Share) */}
        <div className="meet-more-wrap" ref={moreMenuRef}>
          <button
            onClick={() => setShowMoreMenu((v) => !v)}
            className={`meet-circle-btn meet-btn--mobile-only ${showMoreMenu ? 'meet-circle-btn--active' : ''}`}
            title="Más opciones"
          >
            <MoreVertical size={20} />
            {/* Unread badge on ⋯ when chat unread */}
            {unreadCount > 0 && activeSideTab !== 'chat' && (
              <span className="meet-badge-dot" />
            )}
          </button>

          {morePresence.shown && (
            <div className={`meet-more-dropdown ${morePresence.closing ? 'meet-more-dropdown--closing' : ''}`}>
              <button
                className={`meet-more-item ${activeSideTab === 'chat' ? 'meet-more-item--active' : ''}`}
                onClick={() => { setActiveSideTab((v) => v === 'chat' ? null : 'chat'); setShowMoreMenu(false); }}
              >
                <MessageSquare size={16} />
                <span>Chat</span>
                {unreadCount > 0 && activeSideTab !== 'chat' && (
                  <span className="meet-more-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                )}
              </button>
              <button
                className={`meet-more-item ${activeSideTab === 'participants' ? 'meet-more-item--active' : ''}`}
                onClick={() => { setActiveSideTab((v) => v === 'participants' ? null : 'participants'); setShowMoreMenu(false); }}
              >
                <Users size={16} />
                <span>Participantes</span>
              </button>
              <button
                className="meet-more-item"
                onClick={() => { setIsRightPanelCollapsed((v) => !v); setShowMoreMenu(false); }}
              >
                {isRightPanelCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
                <span>{isRightPanelCollapsed ? 'Mostrar cámaras' : 'Ocultar cámaras'}</span>
              </button>
              <div className="meet-more-separator" />
              <button
                className="meet-more-item meet-more-item--danger"
                onClick={() => { handleLeaveClick(); setShowMoreMenu(false); }}
              >
                <PhoneOff size={16} />
                <span>Salir de la sala</span>
              </button>
            </div>
          )}
        </div>

        {/* Leave Call Button — hidden on mobile (available in ⋯ menu), visible on desktop */}
        <button
          onClick={handleLeaveClick}
          className="meet-circle-btn meet-circle-btn--leave meet-btn--hide-mobile"
          title="Salir de la reunión"
        >
          <PhoneOff size={18} />
        </button>
      </footer>

      {mediaError && <div className="meet-error-banner">⚠️ {mediaError}</div>}

      <HostExitModal
        isOpen={showHostExitModal}
        participantCount={roomData.participants.length}
        isTemporary={roomData.isTemporary !== false}
        onClose={() => setShowHostExitModal(false)}
        onLeaveOnlyMe={handleLeaveOnlyMe}
        onDeleteRoomForAll={handleDeleteRoomForAll}
      />

      {/* ⚙ Room settings: name, info, save-mode (temporary/stored), approval and auto-close timer */}
      <RoomSettingsModal
        isOpen={showRoomSettings}
        onClose={() => setShowRoomSettings(false)}
        isTemporary={roomData.isTemporary !== false}
        onToggleTemporary={handleToggleTemporaryMode}
        roomName={roomData.settings?.name || ''}
        roomDescription={roomData.settings?.description || ''}
        timerMinutes={roomData.settings?.timerMinutes ?? null}
        timerEndsAt={roomData.settings?.timerEndsAt || null}
        requireApproval={roomData.settings?.requireApproval === true}
        onSaveDetails={handleSaveRoomDetails}
        onSetTimer={handleSetRoomTimer}
        onToggleRequireApproval={() => {
          const next = !(roomData.settings?.requireApproval === true);
          socket.emit('update-room-settings', { roomId, settings: { ...roomData.settings, requireApproval: next } });
          notify(
            'success',
            next
              ? 'Los invitados deberán ser aprobados por ti para entrar.'
              : 'Ahora cualquiera con el código puede entrar directamente.',
            'Aprobar entrada'
          );
        }}
      />
    </div>
  );
};
