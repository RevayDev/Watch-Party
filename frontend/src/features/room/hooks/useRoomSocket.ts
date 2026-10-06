import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { IRoomData, ChatMessage, ReactionItem } from '../../../types/room';
import { ApiService } from '../../../services/api';
import { getSocket, disconnectSocket } from '../../../services/socket';
import { removeRecentRoom, updateRecentRoomMeta } from '../../../services/recentRooms';
import { notify } from '../../../services/notifications';
import { useWebRTC } from '../../../hooks/useWebRTC';
import { useSwipeDown } from '../../../shared/hooks/useSheetDrag';
import { usePresence } from '../../../hooks/usePresence';
import { STORAGE_KEYS } from '../../../shared/constants';
import { buildSocketAuth, resolveJoinRejectedFeedback, saveHostSession } from '../../../shared/utils';
import { playJoinSound, playLeaveSound, playChatSound } from '../utils/sounds';

export interface UseRoomSocketArgs {
  roomId: string;
  userName: string;
  initialIsHost: boolean;
  onLeave: () => void;
}

/**
 * Toda la lógica socket/estado extraída verbatim de pages/Room.tsx.
 * El componente queda como composición (sin lógica de negocio aquí alterada).
 */
export function useRoomSocket({ roomId, userName, initialIsHost, onLeave }: UseRoomSocketArgs) {
  // Stable user identity for this browser (never changes on rename → no duplicates)
  const userId = useMemo(() => {
    try {
      let id = localStorage.getItem(STORAGE_KEYS.USER_ID);
      if (!id) {
        id =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(STORAGE_KEYS.USER_ID, id);
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
  const settingsName = roomData?.settings?.name;
  const settingsDescription = roomData?.settings?.description;

  // Guarda nombre/descripción en "salas recientes" cuando se conocen (no cambia funcionalidad)
  useEffect(() => {
    if (settingsName?.trim() || settingsDescription?.trim()) {
      updateRecentRoomMeta(roomId, {
        roomName: settingsName,
        roomDescription: settingsDescription,
      });
    }
  }, [roomId, settingsName, settingsDescription]);
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
  const [showMemberExitModal, setShowMemberExitModal] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ReactionItem[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [remoteAction, setRemoteAction] = useState<{
    action: 'play' | 'pause' | 'seek';
    currentTime: number;
    sentAt?: number;
    timestamp: number;
  } | null>(null);
  // Último consenso de playback ya aplicado: `room-state` llega en cada
  // (re)join con la misma posición y reaplicarlo corta el video. Solo se
  // re-aplica si cambia play/pause o el salto supera la tolerancia (2 s).
  const lastConsensusRef = useRef<{ currentTime: number; isPlaying: boolean } | null>(null);

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
  // Exit animations (⋯ menu, emoji popup — the drawer is a BottomSheet now)
  const morePresence = usePresence(showMoreMenu, 160);
  const emojiPresence = usePresence(showEmojiPicker, 160);
  // Same swipe-down-to-close for the phone popovers (⋯ menu, emoji reactions)
  const moreSheetRef = useSwipeDown<HTMLDivElement>(
    () => setShowMoreMenu(false),
    showMoreMenu
  );
  const emojiSheetRef = useSwipeDown<HTMLDivElement>(
    () => setShowEmojiPicker(false),
    showEmojiPicker
  );
  // Keep the last opened tab so the drawer still renders content while closing
  const lastSideTabRef = useRef<'chat' | 'participants'>('chat');
  if (activeSideTab) lastSideTabRef.current = activeSideTab;
  const sideTabView = activeSideTab ?? lastSideTabRef.current;
  // Ref mirror of the open side tab (socket handlers read it without stale closures)
  const activeSideTabRef = useRef<'chat' | 'participants' | null>(null);
  activeSideTabRef.current = activeSideTab;

  // Auto-hide toolbar and header on inactivity (like YouTube / Netflix / Google Meet)
  const [isBarVisible, setIsBarVisible] = useState(true);
  // When true, the header + bottom bar are ALWAYS visible (user chose "Mostrar interfaz")
  // When false, they auto-hide and only the bottom bar reappears on touch/move
  const [uiPinned, setUiPinned] = useState(true);
  const uiPinnedRef = useRef(true);
  uiPinnedRef.current = uiPinned;
  const hideBarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetBarTimer = useCallback(() => {
    // If UI is pinned, always keep everything visible and never auto-hide
    if (uiPinnedRef.current) {
      setIsBarVisible(true);
      if (hideBarTimeoutRef.current) {
        clearTimeout(hideBarTimeoutRef.current);
        hideBarTimeoutRef.current = null;
      }
      return;
    }

    // UI is NOT pinned → show bottom bar on activity, auto-hide after 4.5s
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

  // If user opens menu, emoji picker, or side tab (chat/participants), keep bar visible
  useEffect(() => {
    if (showMoreMenu || showEmojiPicker || activeSideTab !== null) {
      setIsBarVisible(true);
      if (hideBarTimeoutRef.current) clearTimeout(hideBarTimeoutRef.current);
    } else {
      resetBarTimer();
    }
  }, [showMoreMenu, showEmojiPicker, activeSideTab, resetBarTimer]);

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

  // Espejos por ref del estado media/host para el efecto socket gigante.
  // Sin esto, togglear mic/cámara cambiaba isMicOn/isCameraOn (deps del
  // efecto) y re-ejecutaba loadRoom + join-room → recarga/reconexión.
  const enableMediaRef = useRef(enableMedia);
  enableMediaRef.current = enableMedia;
  const isMicOnRef = useRef(isMicOn);
  isMicOnRef.current = isMicOn;
  const isCameraOnRef = useRef(isCameraOn);
  isCameraOnRef.current = isCameraOn;

  // Clears local data only for THIS room (keeps sessions of other rooms intact)
  const clearRoomLocalData = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.HOST_SESSION);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.roomId && parsed.roomId.toUpperCase() === roomId.toUpperCase()) {
          localStorage.removeItem(STORAGE_KEYS.HOST_SESSION);
        }
      }
    } catch {
      // ignore parse errors
    }
    removeRecentRoom(roomId);
  }, [roomId]);

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
            // Preserva el hostSecret ya guardado para esta sala, si existe
            saveHostSession(roomId, myName);
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
          enableMediaRef.current(micOn, camOn);
        }
      }

      if (state.playback && state.video) {
        const nextPlaying = state.playback.isPlaying;
        const prev = lastConsensusRef.current;
        const timeJump = prev ? Math.abs(state.playback.currentTime - prev.currentTime) : Infinity;
        // Solo seeks redundantes verificados se filtran: primer estado,
        // cambio play/pause o salto >2 s siempre se aplican.
        if (!prev || prev.isPlaying !== nextPlaying || timeJump > 2) {
          lastConsensusRef.current = { currentTime: state.playback.currentTime, isPlaying: nextPlaying };
          setRemoteAction({
            action: state.playback.isPlaying ? 'play' : 'seek',
            currentTime: state.playback.currentTime,
            sentAt: Date.now(),
            timestamp: Date.now(),
          });
        }
      }
    };

    const handleHostChanged = (data: { newHostName: string; participants: any[] }) => {
      setRoomData((prev) =>
        prev ? { ...prev, participants: data.participants, hostName: data.newHostName } : null
      );
      const amINewHost = data.newHostName.toLowerCase() === myName.toLowerCase();
      if (amINewHost) {
        setIsHost(true);
        // Preserva el hostSecret ya guardado para esta sala, si existe
        saveHostSession(roomId, myName);
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
      if (data.action === 'play') {
        lastConsensusRef.current = { currentTime: data.currentTime, isPlaying: true };
      } else if (data.action === 'pause') {
        lastConsensusRef.current = { currentTime: data.currentTime, isPlaying: false };
      } else {
        lastConsensusRef.current = {
          currentTime: data.currentTime,
          isPlaying: lastConsensusRef.current?.isPlaying ?? false,
        };
      }
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
        enableMediaRef.current(false, isCameraOnRef.current);
        notify('warning', 'El anfitrión o co-anfitrión ha silenciado tu micrófono.', 'Micro silenciado');
      }
    };

    const handleForceDisableCamera = (data: { targetSocketId?: string; targetUserName: string }) => {
      if (data.targetUserName.toLowerCase() === myName.toLowerCase() || data.targetSocketId === socket.id) {
        enableMediaRef.current(isMicOnRef.current, false);
        notify('warning', 'El anfitrión o co-anfitrión ha apagado tu cámara.', 'Cámara apagada');
      }
    };

    const handleForceMuteAll = () => {
      if (!isHostRef.current) {
        enableMediaRef.current(false, isCameraOnRef.current);
      }
    };

    const handleForceDisableAllCameras = () => {
      if (!isHostRef.current) {
        enableMediaRef.current(isMicOnRef.current, false);
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
          const raw = localStorage.getItem(STORAGE_KEYS.HOST_SESSION);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.roomId?.toUpperCase() === roomId.toUpperCase() && parsed.hostName === data.oldName) {
              parsed.hostName = data.newName;
              localStorage.setItem(STORAGE_KEYS.HOST_SESSION, JSON.stringify(parsed));
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
      const feedback = resolveJoinRejectedFeedback(data.reason, data.message);
      notify(feedback.type, feedback.message, feedback.title);
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

    const handleSettingsError = (data: { message?: string }) => {
      notify('warning', data.message || 'No se pudo actualizar la configuración de la sala.', 'Configuración');
    };

    const handleActionDenied = (data: { event?: string; message?: string }) => {
      notify('warning', data.message || 'No tienes permiso para realizar esa acción.', 'Acción denegada');
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
    socket.on('settings-error', handleSettingsError);
    socket.on('action-denied', handleActionDenied);

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
      socket.off('settings-error', handleSettingsError);
      socket.off('action-denied', handleActionDenied);
    };
  }, [roomId, myName, initialIsHost, socket, onLeave, userId, clearRoomLocalData]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleToggleTemporaryMode = () => {
    if (!isHost || !roomData) return;
    const currentIsTemp = roomData.isTemporary !== false;
    const nextIsTemp = !currentIsTemp;
    socket.emit('update-room-settings', {
      roomId,
      settings: { ...roomData.settings, isTemporary: nextIsTemp },
      ...buildSocketAuth(roomId, myName),
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
      ...buildSocketAuth(roomId, myName),
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
      ...buildSocketAuth(roomId, myName),
    });
    setRoomData((prev) =>
      prev
        ? {
            ...prev,
            settings: { ...prev.settings, timerMinutes: minutes, timerEndsAt } as IRoomData['settings'],
          }
        : null
    );
  };

  const toggleBarsVisibility = useCallback(() => {
    setUiPinned((prev) => {
      const next = !prev;
      uiPinnedRef.current = next;
      if (next) {
        // Pinning: show bars immediately and cancel any pending hide timer
        setIsBarVisible(true);
        if (hideBarTimeoutRef.current) {
          clearTimeout(hideBarTimeoutRef.current);
          hideBarTimeoutRef.current = null;
        }
      } else {
        // Unpinning: hide bars now and let auto-hide manage from here
        setIsBarVisible(false);
      }
      return next;
    });
  }, []);

  const handleLeaveClick = () => {
    if (isHost) setShowHostExitModal(true);
    else setShowMemberExitModal(true);
  };

  const handleLeaveOnlyMe = () => {
    setShowHostExitModal(false);
    setShowMemberExitModal(false);
    // Host session + recent room are KEPT so the room can be recovered from Home
    socket.emit('leave-room', { roomId, userName: myName, userId });
    disconnectSocket();
    onLeave();
  };

  const handleDeleteRoomForAll = () => {
    setShowHostExitModal(false);
    clearRoomLocalData();
    socket.emit('close-room', { roomId, ...buildSocketAuth(roomId, myName) });
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
      socket.emit('sync-video', {
        roomId,
        action,
        currentTime,
        ...buildSocketAuth(roomId, myName),
      });
    },
    [roomId, socket, myName]
  );

  // Callback ESTABLE para el heartbeat del player: el inline anterior
  // recreaba la función en cada render y el efecto del player re-reportaba
  // (spam de playback-heartbeat en cada mensaje/reacción/toggle).
  const handlePlaybackHeartbeat = useCallback(
    (currentTime: number, isPlaying: boolean) => {
      socket.emit('playback-heartbeat', { roomId, currentTime, isPlaying });
    },
    [socket, roomId]
  );

  const handleSendMessage = (text: string) => {
    socket.emit('send-message', { roomId, text, userName: myName });
  };

  const handleReaction = (emoji: string) => {
    socket.emit('send-reaction', { roomId, emoji, userName: myName });
  };

  const handleCancelWaiting = () => {
    setAwaitingApproval(false);
    // Cancels the join request server-side (leave-room handles pending users)
    socket.emit('leave-room', { roomId, userName: myName, userId });
    // Give the packet a moment to flush before tearing the socket down
    setTimeout(() => {
      disconnectSocket();
      onLeave();
    }, 120);
  };

  return {
    userId,
    myName,
    awaitingApproval,
    pendingMediaPrefRef,
    roomData,
    loading,
    error,
    joined,
    isHost,
    showHostExitModal,
    setShowHostExitModal,
    showMemberExitModal,
    setShowMemberExitModal,
    messages,
    reactions,
    uploadProgress,
    remoteAction,
    activeSideTab,
    setActiveSideTab,
    showEmojiPicker,
    setShowEmojiPicker,
    isRightPanelCollapsed,
    setIsRightPanelCollapsed,
    unreadCount,
    showMoreMenu,
    setShowMoreMenu,
    moreMenuRef,
    showRoomSettings,
    setShowRoomSettings,
    morePresence,
    emojiPresence,
    moreSheetRef,
    emojiSheetRef,
    sideTabView,
    isBarVisible,
    uiPinned,
    toggleBarsVisibility,
    socket,
    localStream,
    remotePeers,
    peerMediaStates,
    isMicOn,
    isCameraOn,
    mediaError,
    toggleMic,
    toggleCamera,
    handleToggleTemporaryMode,
    handleSaveRoomDetails,
    handleSetRoomTimer,
    handleLeaveClick,
    handleLeaveOnlyMe,
    handleDeleteRoomForAll,
    handleUploadVideo,
    handleSetVideoUrl,
    handleSyncAction,
    handlePlaybackHeartbeat,
    handleSendMessage,
    handleReaction,
    handleCancelWaiting,
  };
}

export type RoomSocket = ReturnType<typeof useRoomSocket>;
