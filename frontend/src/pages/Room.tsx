import React, { useEffect, useState, useCallback, useRef } from 'react';
import { RoomHeader } from '../components/RoomHeader';
import { VideoPlayer } from '../components/VideoPlayer';
import { Participants } from '../components/Participants';
import { Chat } from '../components/Chat';
import { Reactions } from '../components/Reactions';
import { CameraGrid } from '../components/CameraGrid';
import { HostExitModal } from '../components/HostExitModal';
import { IRoomData, ChatMessage, ReactionItem } from '../types/room';
import { ApiService } from '../services/api';
import { getSocket, disconnectSocket } from '../services/socket';
import { useWebRTC } from '../hooks/useWebRTC';
import { Loader2, Mic, MicOff, Video, VideoOff, MessageSquare, Users, PhoneOff, Smile, X, PanelRightClose, PanelRightOpen, MoreVertical } from 'lucide-react';

// ── Toast Notification Types ───────────────────────────────────────────────
interface ToastNotification {
  id: string;
  type: 'join' | 'leave' | 'chat';
  userName: string;
  text?: string;
}

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
  const [roomData, setRoomData] = useState<IRoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isHost, setIsHost] = useState(initialIsHost);
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
  // Google Meet-style toast notifications
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Unread messages counter (resets when chat tab opened)
  const [unreadCount, setUnreadCount] = useState(0);
  // Mobile “More” dropdown menu
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

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

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) { clearTimeout(timer); toastTimersRef.current.delete(id); }
  }, []);

  const addToast = useCallback((type: 'join' | 'leave' | 'chat', toastUserName: string, toastText?: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev.slice(-3), { id, type, userName: toastUserName, text: toastText }]);
    if (type === 'join') playJoinSound();
    else if (type === 'leave') playLeaveSound();
    else if (type === 'chat') playChatSound();

    const duration = type === 'chat' ? 4500 : 4000;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      toastTimersRef.current.delete(id);
    }, duration);
    toastTimersRef.current.set(id, timer);
  }, []);

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
  } = useWebRTC(socket, roomId, userName, isHost);

  // 1. Initial Room Fetch + Socket.IO connection
  useEffect(() => {
    let isMounted = true;

    async function loadRoom() {
      try {
        setLoading(true);
        const data = await ApiService.getRoom(roomId);
        if (isMounted) {
          setRoomData(data);
          if (data.hostName.toLowerCase() === userName.toLowerCase()) {
            setIsHost(true);
            localStorage.setItem(
              'watchparty_host_session',
              JSON.stringify({ roomId, hostName: userName })
            );
          }
        }

        // Join room via Socket.IO
        const emitJoin = () => {
          socket.emit('join-room', { roomId, userName, isHost: initialIsHost });
        };
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
      playback?: { currentTime: number; isPlaying: boolean } | null;
    }) => {
      setRoomData((prev) =>
        prev ? { ...prev, video: state.video, participants: state.participants } : null
      );
      if (state.isHost !== undefined) setIsHost(state.isHost);

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
      const amINewHost = data.newHostName.toLowerCase() === userName.toLowerCase();
      if (amINewHost) {
        setIsHost(true);
        localStorage.setItem(
          'watchparty_host_session',
          JSON.stringify({ roomId, hostName: userName })
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
      alert(data.message || 'La sala ha sido cerrada por el anfitrión.');
      localStorage.removeItem('watchparty_host_session');
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
      if (data.userName.toLowerCase() !== userName.toLowerCase()) {
        addToast('join', data.userName);
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
      if (data.userName && data.userName.toLowerCase() !== userName.toLowerCase()) {
        addToast('leave', data.userName);
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
      setActiveSideTab((tab) => {
        if (tab !== 'chat') {
          setUnreadCount((n) => n + 1);
          if (msg.user.toLowerCase() !== userName.toLowerCase()) {
            addToast('chat', msg.user, msg.text);
          }
        }
        return tab;
      });
    };

    const handleReactionEvent = (reaction: ReactionItem) => {
      setReactions((prev) => [...prev, reaction]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
      }, 2600);
    };

    socket.on('room-state', handleRoomState);
    socket.on('host-changed', handleHostChanged);
    socket.on('room-closed', handleRoomClosed);
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('video-changed', handleVideoChanged);
    socket.on('sync-video', handleSyncVideo);
    socket.on('chat-message', handleChatMessage);
    socket.on('reaction', handleReactionEvent);

    return () => {
      isMounted = false;
      socket.off('room-state', handleRoomState);
      socket.off('host-changed', handleHostChanged);
      socket.off('room-closed', handleRoomClosed);
      socket.off('user-joined', handleUserJoined);
      socket.off('user-left', handleUserLeft);
      socket.off('video-changed', handleVideoChanged);
      socket.off('sync-video', handleSyncVideo);
      socket.off('chat-message', handleChatMessage);
      socket.off('reaction', handleReactionEvent);
    };
  }, [roomId, userName, initialIsHost, socket, onLeave]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleLeaveClick = () => {
    if (isHost) setShowHostExitModal(true);
    else handleLeaveOnlyMe();
  };

  const handleLeaveOnlyMe = () => {
    setShowHostExitModal(false);
    localStorage.removeItem('watchparty_host_session');
    socket.emit('leave-room', { roomId, userName });
    disconnectSocket();
    onLeave();
  };

  const handleDeleteRoomForAll = () => {
    setShowHostExitModal(false);
    localStorage.removeItem('watchparty_host_session');
    socket.emit('close-room', { roomId });
    disconnectSocket();
    onLeave();
  };

  const handleUploadVideo = async (file: File) => {
    try {
      setUploadProgress(0);
      const res = await ApiService.uploadVideo(roomId, file, (progress) => {
        setUploadProgress(progress);
      });
      setRoomData((prev) => (prev ? { ...prev, video: res.video, status: 'active' } : null));
      socket.emit('video-changed', { roomId, video: res.video });
    } catch (err: any) {
      alert(err.message || 'Error al subir el video');
    } finally {
      setUploadProgress(null);
    }
  };

  const handleSyncAction = useCallback(
    (action: 'play' | 'pause' | 'seek', currentTime: number) => {
      socket.emit('sync-video', { roomId, action, currentTime });
    },
    [roomId, socket]
  );

  const handleSendMessage = (text: string) => {
    socket.emit('send-message', { roomId, text, userName });
  };

  const handleReaction = (emoji: string) => {
    socket.emit('send-reaction', { roomId, emoji, userName });
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

  return (
    <div className={`meet-layout ${!isBarVisible ? 'meet-layout--bars-hidden' : ''}`}>
      {/* ── Top Header (Google Meet style) ── */}
      <RoomHeader
        roomId={roomData.roomId}
        participantCount={roomData.participants.length}
        isHost={isHost}
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
              currentUserName={userName}
              isHost={isHost}
              isMicOn={isMicOn}
              isCameraOn={isCameraOn}
              peerMediaStates={peerMediaStates}
            />
          </aside>
        )}

        {/* ── Slide-over Right Drawer for Chat or Participants ── */}
        {activeSideTab && (
          <aside className="meet-drawer">
            <div className="meet-drawer__header">
              <h3>{activeSideTab === 'chat' ? 'Mensajes del chat' : `Participantes (${roomData.participants.length})`}</h3>
              <button onClick={() => setActiveSideTab(null)} className="meet-drawer__close-btn">
                <X size={18} />
              </button>
            </div>
            <div className="meet-drawer__body">
              {activeSideTab === 'chat' && (
                <Chat messages={messages} onSendMessage={handleSendMessage} />
              )}
              {activeSideTab === 'participants' && (
                <Participants participants={roomData.participants} currentUserName={userName} />
              )}
            </div>
          </aside>
        )}
      </main>

      {/* ── Google Meet Floating Circular Bottom Bar ── */}
      <footer className={`meet-bottom-bar ${!isBarVisible ? 'meet-bottom-bar--hidden' : ''}`}>
        {/* Mic toggle — green when ON */}
        <button
          onClick={toggleMic}
          className={`meet-circle-btn ${isMicOn ? 'meet-circle-btn--mic-on' : 'meet-circle-btn--off'}`}
          title={isMicOn ? 'Silenciar micrófono' : 'Activar micrófono'}
        >
          {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
        </button>

        {/* Camera toggle */}
        <button
          onClick={toggleCamera}
          className={`meet-circle-btn ${isCameraOn ? 'meet-circle-btn--on' : 'meet-circle-btn--off'}`}
          title={isCameraOn ? 'Apagar cámara' : 'Activar cámara'}
        >
          {isCameraOn ? <Video size={20} /> : <VideoOff size={20} />}
        </button>

        {/* Emoji Reactions trigger */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowEmojiPicker((v) => !v)}
            className={`meet-circle-btn ${showEmojiPicker ? 'meet-circle-btn--active' : ''}`}
            title="Enviar reacción"
          >
            <Smile size={20} />
          </button>

          {showEmojiPicker && (
            <div className="meet-emoji-popup">
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
          <MessageSquare size={20} />
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
          <Users size={20} />
        </button>

        {/* Toggle Collapse Cameras Strip (Accordion) — hidden on mobile */}
        <button
          onClick={() => setIsRightPanelCollapsed((v) => !v)}
          className={`meet-circle-btn meet-btn--hide-mobile ${isRightPanelCollapsed ? 'meet-circle-btn--active' : ''}`}
          title={isRightPanelCollapsed ? 'Mostrar cámaras laterales' : 'Ocultar cámaras laterales'}
        >
          {isRightPanelCollapsed ? <PanelRightOpen size={20} /> : <PanelRightClose size={20} />}
        </button>

        {/* ⋯ More Menu — visible only on mobile */}
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

          {showMoreMenu && (
            <div className="meet-more-dropdown">
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
          <PhoneOff size={20} />
        </button>
      </footer>

      {mediaError && <div className="meet-error-banner">⚠️ {mediaError}</div>}

      {/* ── Google Meet-style Toast Notifications ── */}
      <div className="meet-toasts">
        {toasts.map((toast) => (
          <div 
            key={toast.id} 
            className={`meet-toast meet-toast--${toast.type}`}
            onClick={() => {
              if (toast.type === 'chat') {
                setActiveSideTab('chat');
                dismissToast(toast.id);
              }
            }}
            style={{ cursor: toast.type === 'chat' ? 'pointer' : 'default' }}
          >
            <span className="meet-toast__avatar">
              {toast.userName.charAt(0).toUpperCase()}
            </span>
            <div className="meet-toast__body">
              <span className="meet-toast__name">{toast.userName}</span>
              <span className="meet-toast__action">
                {toast.type === 'join' 
                  ? 'se unió a la sala' 
                  : toast.type === 'leave' 
                  ? 'salió de la sala' 
                  : toast.text || 'envió un mensaje'}
              </span>
            </div>
            <button
              className="meet-toast__close"
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(toast.id);
              }}
              title="Cerrar"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <HostExitModal
        isOpen={showHostExitModal}
        participantCount={roomData.participants.length}
        onClose={() => setShowHostExitModal(false)}
        onLeaveOnlyMe={handleLeaveOnlyMe}
        onDeleteRoomForAll={handleDeleteRoomForAll}
      />
    </div>
  );
};
