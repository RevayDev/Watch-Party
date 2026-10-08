import React, { useEffect } from 'react';
import { MessageSquare, Users, PhoneOff, PanelRightClose, PanelRightOpen, MoreVertical, Mic, MicOff, Video, VideoOff, Smile, Eye, EyeOff } from 'lucide-react';
import { Reactions } from '../../../components/Reactions';

/**
 * Barra inferior de la sala (extraída verbatim de pages/Room.tsx, solo composición).
 */
interface RoomControlsProps {
  isMicOn: boolean;
  isCameraOn: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
  showEmojiPicker: boolean;
  setShowEmojiPicker: React.Dispatch<React.SetStateAction<boolean>>;
  emojiPresence: { shown: boolean; closing: boolean };
  emojiSheetRef: React.RefObject<HTMLDivElement>;
  handleReaction: (emoji: string) => void;
  activeSideTab: 'chat' | 'participants' | null;
  setActiveSideTab: React.Dispatch<React.SetStateAction<'chat' | 'participants' | null>>;
  unreadCount: number;
  isRightPanelCollapsed: boolean;
  setIsRightPanelCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  showMoreMenu: boolean;
  setShowMoreMenu: React.Dispatch<React.SetStateAction<boolean>>;
  morePresence: { shown: boolean; closing: boolean };
  moreSheetRef: React.RefObject<HTMLDivElement>;
  moreMenuRef: React.Ref<HTMLDivElement>;
  handleLeaveClick: () => void;
  isBarVisible: boolean;
  uiPinned?: boolean;
  toggleBarsVisibility: () => void;
}

export const RoomControls: React.FC<RoomControlsProps> = ({
  isMicOn,
  isCameraOn,
  toggleMic,
  toggleCamera,
  showEmojiPicker,
  setShowEmojiPicker,
  emojiPresence,
  emojiSheetRef,
  handleReaction,
  activeSideTab,
  setActiveSideTab,
  unreadCount,
  isRightPanelCollapsed,
  setIsRightPanelCollapsed,
  showMoreMenu,
  setShowMoreMenu,
  morePresence,
  moreSheetRef,
  moreMenuRef,
  handleLeaveClick,
  isBarVisible,
  uiPinned = true,
  toggleBarsVisibility,
}) => {
  // Picker persistente: solo se cierra con el botón Smile (toggle), Esc o
  // swipe-down (emojiSheetRef). Reaccionar NO lo cierra.
  useEffect(() => {
    if (!showEmojiPicker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowEmojiPicker(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showEmojiPicker, setShowEmojiPicker]);

  return (
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
          <div
            className={`meet-emoji-popup ${emojiPresence.closing ? 'meet-emoji-popup--closing' : ''}`}
            ref={emojiSheetRef}
          >
            <Reactions onReact={(emoji) => handleReaction(emoji)} />
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
          <div
            className={`meet-more-dropdown ${morePresence.closing ? 'meet-more-dropdown--closing' : ''}`}
            ref={moreSheetRef}
          >
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
            <button
              className={`meet-more-item ${!uiPinned ? 'meet-more-item--active' : ''}`}
              onClick={() => { toggleBarsVisibility(); setShowMoreMenu(false); }}
            >
              {uiPinned ? <EyeOff size={16} /> : <Eye size={16} />}
              <span>{uiPinned ? 'Ocultar interfaz' : 'Mostrar interfaz'}</span>
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
  );
};
