import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { IRoomData, IRoomSettings, ChatMessage, ReactionItem, TypingPayload } from '../../../types/room';
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
import { clampDuckPct, DUCK_DEFAULT_PCT, heartbeatIntervalMs } from '../../../shared/perf';
import {
  INTERSTELLAR_WINDOW_MS,
  INTERSTELLAR_DURATION_MS,
  checkInterstellarCombo,
  isInterstellarEmoji,
  type InterstellarEvent,
} from '../../player/interstellar';

export interface UseRoomSocketArgs {
  roomId: string;
  userName: string;
  initialIsHost: boolean;
  onLeave: () => void;
}

/** Acción remota de playback. `autoplay` = play grupal del handshake video-ready. */
export interface RemoteSyncAction {
  action: 'play' | 'pause' | 'seek';
  currentTime: number;
  sentAt?: number;
  timestamp: number;
  autoplay?: boolean;
}

let remoteActionSeq = 0;
/** Timestamps monótonos: dos consensos seguidos nunca comparten timestamp. */
export const nextRemoteActionTimestamp = (): number => Date.now() + (++remoteActionSeq * 0.001);

/** Indicador "escribiendo": expira a los 4 s sin refresco; emisión máx 1/2 s. */
export const TYPING_EXPIRE_MS = 4000;
export const TYPING_THROTTLE_MS = 2000;

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
  // Ref mirrors of roomData/myName so sync guards and new handlers always
  // read the current value (no stale closures in callbacks estables).
  const roomDataRef = useRef(roomData);
  roomDataRef.current = roomData;
  const myNameRef = useRef(myName);
  myNameRef.current = myName;
  // Ref mirror of pending request count (for "new request" toasts)
  const joinRequestsLenRef = useRef(0);
  const [showHostExitModal, setShowHostExitModal] = useState(false);
  const [showMemberExitModal, setShowMemberExitModal] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ReactionItem[]>([]);
  // Indicador "escribiendo": mapa userName -> timestamp del último `typing`.
  // Expira a los 4 s sin refresco (ver efecto de poda más abajo).
  const [typingMap, setTypingMap] = useState<Record<string, number>>({});
  // Estado del combo Interestellar: se activa cuando 🪐 + ✨ de usuarios distintos en 5 s.
  const [interestellarActive, setInterestellarActive] = useState(false);
  const interstellarHistoryRef = useRef<InterstellarEvent[]>([]);
  const interstellarSeenRef = useRef<Set<string>>(new Set());
  const interestellarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [remoteAction, setRemoteAction] = useState<RemoteSyncAction | null>(null);
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
  const notified10mRef = useRef(false);
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
    peerSignalStates,
    qualityLevel,
    lowBandwidth,
    isMicOn,
    isCameraOn,
    mediaError,
    toggleMic,
    toggleCamera,
    enableMedia,
  } = useWebRTC(socket, roomId, myName, isHost);

  // Pill "Reconectando…": true entre `disconnect`/`reconnect_attempt` y el
  // próximo `connect`/`room-state`. NUNCA destruye sala/chat/video ni emite
  // `leave-room`: las caídas transitorias las cubren la gracia de 20 s del
  // servidor + el re-join automático en `connect` (ver efecto gigante).
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Espejos por ref del estado media/host para el efecto socket gigante.
  // Sin esto, togglear mic/cámara cambiaba isMicOn/isCameraOn (deps del
  // efecto) y re-ejecutaba loadRoom + join-room → recarga/reconexión.
  const enableMediaRef = useRef(enableMedia);
  enableMediaRef.current = enableMedia;
  const isMicOnRef = useRef(isMicOn);
  isMicOnRef.current = isMicOn;
  const isCameraOnRef = useRef(isCameraOn);
  isCameraOnRef.current = isCameraOn;

  // Poda del indicador "escribiendo": entradas con más de 4 s se retiran.
  // Solo corre el intervalo mientras haya alguien escribiendo.
  const hasTyping = Object.keys(typingMap).length > 0;
  useEffect(() => {
    if (!hasTyping) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setTypingMap((prev) => {
        let changed = false;
        const next: Record<string, number> = {};
        for (const [name, at] of Object.entries(prev)) {
          if (now - at < TYPING_EXPIRE_MS) {
            next[name] = at;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(timer);
  }, [hasTyping]);

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
      // Re-conexión completada: el servidor confirmó la sala (no se perdió nada).
      setIsReconnecting(false);
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
            timestamp: nextRemoteActionTimestamp(),
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

    const handleUserJoined = (data: { socketId?: string; userName: string; participants: any[]; settings?: any; status?: string }) => {
      setRoomData((prev) => {
        if (!prev) return null;
        const patch = { participants: data.participants };
        if (data.settings) Object.assign(patch, { settings: data.settings });
        if (data.status) Object.assign(patch, { status: data.status });
        return { ...prev, ...patch };
      });
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

    const handleSyncVideo = (data: { action: 'play' | 'pause' | 'seek'; currentTime: number; sentAt?: number; autoplay?: boolean }) => {
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
      // Anti-bucle: el play de consenso/autoplay llega como `play` y el
      // player lo aplica sin re-emitir `sync-video` ni `seek` repetido
      // (isApplyingRemote + dedup de 500 ms del servidor).
      setRemoteAction({
        action: data.action,
        currentTime: data.currentTime,
        sentAt: data.sentAt,
        timestamp: nextRemoteActionTimestamp(),
        autoplay: data.autoplay === true,
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

      // ── Combo Interestellar: 🪐 + ✨ de usuarios DISTINTOS en ≤5 s ──
      if (!visualEffectsRef.current) return;
      if (!isInterstellarEmoji(reaction.emoji)) return;
      const incoming: InterstellarEvent = {
        emoji: reaction.emoji,
        user: reaction.user,
        at: Date.now(),
      };
      const history = interstellarHistoryRef.current;
      // Si ya vimos este id (reemisión/latencia), no lo procesamos de nuevo
      const lastIds = interstellarSeenRef.current;
      if (lastIds.has(reaction.id)) return;
      lastIds.add(reaction.id);
      if (lastIds.size > 60) {
        // Podar ids antiguos para no crecer indefinidamente
        const first = lastIds.values().next().value;
        if (first !== undefined) lastIds.delete(first);
      }
      if (checkInterstellarCombo(history, incoming, true)) {
        setInterestellarActive(true);
        if (interestellarTimerRef.current) clearTimeout(interestellarTimerRef.current);
        interestellarTimerRef.current = setTimeout(
          () => setInterestellarActive(false),
          INTERSTELLAR_DURATION_MS
        );
        history.length = 0; // reiniciar ventana tras disparar
      } else {
        history.push(incoming);
      }
      // Limpieza de eventos fuera de ventana (>10 s)
      interstellarHistoryRef.current = history.filter(
        (ev) => Date.now() - ev.at <= INTERSTELLAR_WINDOW_MS * 2
      );
    };


    // Indicador "escribiendo": se registra quién escribe y se refresca el
    // timestamp. El propio `typing` se ignora (no se muestra uno mismo).
    const handleTypingEvent = (data: TypingPayload | undefined) => {
      if (!data || typeof data.user !== 'string' || !data.user.trim()) return;
      const name = data.user.trim().slice(0, 50);
      if (!name || name.toLowerCase() === myName.toLowerCase()) return;
      setTypingMap((prev) => ({ ...prev, [name]: Date.now() }));
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
      setIsReconnecting(false);
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

    // Nuevo host: el servidor envía el secreto para acreditarse en próximos emits.
    const handleHostSecret = (data: { hostSecret?: string }) => {
      if (data?.hostSecret) {
        saveHostSession(roomId, myNameRef.current, data.hostSecret);
        notify('success', 'Ahora eres el anfitrión de la sala.', 'Anfitrión');
      }
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
    socket.on('typing', handleTypingEvent);
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
    socket.on('host-secret', handleHostSecret);

    // ── Estado de conexión (pill "Reconectando…", Rol A) ───────────────────
    // Caída transitoria: SOLO se marca el pill. No se emite `leave-room`,
    // no se limpia roomData/messages/video ni se desmonta el player: al
    // reconectar, `connect` re-emite join-room y `room-state` rehidrata sin
    // cortar la película (la gracia de 20 s del servidor conserva el lugar).
    const handleSocketDisconnect = () => {
      setIsReconnecting(true);
    };
    const handleReconnectAttempt = () => {
      setIsReconnecting(true);
    };
    const handleSocketReconnect = () => {
      setIsReconnecting(false);
    };
    socket.on('disconnect', handleSocketDisconnect);
    socket.on('reconnect_attempt', handleReconnectAttempt);
    socket.on('reconnect', handleSocketReconnect);

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
      socket.off('typing', handleTypingEvent);
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
      socket.off('host-secret', handleHostSecret);
      socket.off('disconnect', handleSocketDisconnect);
      socket.off('reconnect_attempt', handleReconnectAttempt);
      socket.off('reconnect', handleSocketReconnect);
    };
  }, [roomId, myName, initialIsHost, socket, onLeave, userId, clearRoomLocalData]);

  // Aviso de 10 minutos restantes (solo 1 vez por sesión)
  useEffect(() => {
    const timerEndsAt = roomData?.settings?.timerEndsAt;
    if (!timerEndsAt) return;
    const check10m = () => {
      const ms = new Date(timerEndsAt).getTime() - Date.now();
      if (ms > 0 && ms <= 10 * 60 * 1000 && !notified10mRef.current) {
        notified10mRef.current = true;
        notify('warning', 'Quedan 10 minutos para el cierre automático de la sala.', 'La sala se cierra pronto');
      }
    };
    check10m();
    const iv = window.setInterval(check10m, 5000);
    return () => window.clearInterval(iv);
  }, [roomData?.settings?.timerEndsAt, notify]);

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

  // ── Rol B: Rendimiento (persistido en ajustes de sala) ────────────────────
  // Parche parcial por socket; el servidor sanea por whitelist, fusiona y
  // difunde `room-settings-updated`. Optimista en local para respuesta inmediata.
  const handleUpdatePerfSettings = useCallback(
    (patch: Partial<IRoomSettings>) => {
      if (!isHostRef.current) return;
      setRoomData((prev) =>
        prev
          ? { ...prev, settings: { ...prev.settings, ...patch } as IRoomData['settings'] }
          : prev
      );
      socket.emit('update-room-settings', {
        roomId,
        settings: patch,
        ...buildSocketAuth(roomId, myName),
      });
    },
    [roomId, socket, myName]
  );

  // Lecturas con defaults (undefined = ON salvo dataSaver y duckingLevel).
  const perfSettings: IRoomSettings = roomData?.settings ?? ({} as IRoomSettings);
  const dataSaver = perfSettings.dataSaver === true;
  const fullscreenToasts = perfSettings.fullscreenToasts !== false;
  const reactionsEnabled = perfSettings.reactionsEnabled !== false;
  const visualEffects = perfSettings.visualEffects !== false;
  // Espejo por ref para que los handlers socket lean el valor vigente.
  const visualEffectsRef = useRef(visualEffects);
  visualEffectsRef.current = visualEffects;
  const duckingEnabled = perfSettings.duckingEnabled !== false;
  const duckingLevelPct =
    typeof perfSettings.duckingLevel === 'number'
      ? clampDuckPct(perfSettings.duckingLevel)
      : DUCK_DEFAULT_PCT;
  // Agente A: intervalo efectivo del heartbeat (5 s normal / 15 s en ahorro).
  // El intervalo interno del player queda intacto; la estrangulación a 15 s
  // se aplica en handlePlaybackHeartbeat (abajo).
  const heartbeatInterval = heartbeatIntervalMs(dataSaver);

  // Espejo del modo ahorro para el throttle del heartbeat (sin re-suscribir).
  const dataSaverRef = useRef(false);
  dataSaverRef.current = dataSaver;
  const lastHeartbeatAtRef = useRef(0);

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
      socket.emit('upload-progress', { roomId, progress: 0, fileName: file.name, ...buildSocketAuth(roomId, myName) });
      const res = await ApiService.uploadVideo(roomId, file, (progress) => {
        setUploadProgress(progress);
        socket.emit('upload-progress', { roomId, progress, fileName: file.name, ...buildSocketAuth(roomId, myName) });
      });
      setRoomData((prev) => (prev ? { ...prev, video: res.video, status: 'active' } : null));
      socket.emit('video-changed', { roomId, video: res.video, ...buildSocketAuth(roomId, myName) });
      socket.emit('upload-progress', { roomId, progress: null, ...buildSocketAuth(roomId, myName) });
    } catch (err: any) {
      socket.emit('upload-progress', { roomId, progress: null, ...buildSocketAuth(roomId, myName) });
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
      socket.emit('video-changed', { roomId, video: res.video, ...buildSocketAuth(roomId, myName) });
    } catch (err: any) {
      notify('error', err.message || 'Error al cargar el enlace de video', 'Error al cargar video');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAction = useCallback(
    (action: 'play' | 'pause' | 'seek', currentTime: number) => {
      // Pre-chequeo local: con hostOnlySync solo host/cohost emiten sync-video.
      // El servidor también lo niega (action-denied); esto evita el viaje.
      const snapshot = roomDataRef.current;
      if (snapshot?.settings?.hostOnlySync === true) {
        const myNameVigente = myNameRef.current;
        const cohost = (snapshot.participants ?? []).some(
          (p) =>
            (p.userId ? p.userId === userId : p.name.toLowerCase() === myNameVigente.toLowerCase()) &&
            p.role === 'cohost'
        );
        if (!isHostRef.current && !cohost) {
          notify('warning', 'Solo el anfitrión controla la reproducción.', 'Reproducción bloqueada');
          return;
        }
      }
      socket.emit('sync-video', {
        roomId,
        action,
        currentTime,
        ...buildSocketAuth(roomId, myNameRef.current),
      });
    },
    [roomId, socket, userId]
  );

  // Callback ESTABLE para el heartbeat del player: el inline anterior
  // recreaba la función en cada render y el efecto del player re-reportaba
  // (spam de playback-heartbeat en cada mensaje/reacción/toggle).
  // Rol B: en ahorro de datos se estrangula a 1 emisión / 15 s (el intervalo
  // interno del player —5 s— queda intacto para el agente A).
  const handlePlaybackHeartbeat = useCallback(
    (currentTime: number, isPlaying: boolean) => {
      if (dataSaverRef.current) {
        const now = Date.now();
        if (lastHeartbeatAtRef.current !== 0 && now - lastHeartbeatAtRef.current < 15000) return;
        lastHeartbeatAtRef.current = now;
      }
      socket.emit('playback-heartbeat', { roomId, currentTime, isPlaying });
    },
    [socket, roomId]
  );

  // Handshake video-ready (Rol A): el player lo llama una vez por video al
  // alcanzar `loadeddata` con currentTime≈0. El servidor cuenta presentes y
  // responde con el `play` grupal (autoplay) o el timeout de 15 s lo hace.
  const handleVideoReady = useCallback(
    (fileName: string) => {
      if (!fileName) return;
      socket.emit('video-ready', { roomId, fileName });
    },
    [socket, roomId]
  );

  const handleSendMessage = (text: string) => {
    socket.emit('send-message', { roomId, text, userName: myName });
  };

  // Emisión throttled del indicador "escribiendo": máx 1 cada 2 s.
  // La guarda de "solo con texto" vive en el input del chat (Chat.tsx).
  const lastTypingEmitRef = useRef(0);
  const emitTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingEmitRef.current < TYPING_THROTTLE_MS) return;
    lastTypingEmitRef.current = now;
    socket.emit('typing', { roomId, userName: myName });
  }, [socket, roomId, myName]);

  // Nombres con actividad reciente (<4 s), ordenados para un render estable.
  const typingUsers = useMemo(
    () => Object.keys(typingMap).sort((a, b) => a.localeCompare(b, 'es')),
    [typingMap]
  );

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
    typingUsers,
    emitTyping,
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
    peerSignalStates,
    qualityLevel,
    lowBandwidth,
    isReconnecting,
    isMicOn,
    isCameraOn,
    mediaError,
    toggleMic,
    toggleCamera,
    handleToggleTemporaryMode,
    handleSaveRoomDetails,
    handleSetRoomTimer,
    handleUpdatePerfSettings,
    dataSaver,
    fullscreenToasts,
    reactionsEnabled,
    visualEffects,
    duckingEnabled,
    duckingLevelPct,
    interestellarActive,
    heartbeatInterval,
    handleLeaveClick,
    handleLeaveOnlyMe,
    handleDeleteRoomForAll,
    handleUploadVideo,
    handleSetVideoUrl,
    handleSyncAction,
    handlePlaybackHeartbeat,
    handleVideoReady,
    handleSendMessage,
    handleReaction,
    handleCancelWaiting,
  };
}

export type RoomSocket = ReturnType<typeof useRoomSocket>;
