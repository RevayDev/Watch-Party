import { DeviceTest } from '../../../components/MediaSettings';
import { Button, Popover } from '../../../shared/components/ui';
import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Users, PhoneOff, PanelRightClose, PanelRightOpen, MoreVertical, Mic, MicOff, Video, VideoOff, Smile, Eye, EyeOff, Music, ScreenShare, ScreenShareOff, ChevronDown } from 'lucide-react';
import { Reactions } from '../../../components/Reactions';

/**
 * Barra inferior de la sala (extraída verbatim de pages/Room.tsx, solo composición).
 */
interface RoomControlsProps {
  localStream?: MediaStream | null;
  onRetryMedia?: () => void;
  isScreenSharing?: boolean;
  onToggleScreenShare?: () => void;
  isMicOn: boolean;
  isCameraOn: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
  showEmojiPicker: boolean;
  setShowEmojiPicker: React.Dispatch<React.SetStateAction<boolean>>;
  emojiPresence: { shown: boolean; closing: boolean };
  emojiSheetRef: React.RefObject<HTMLDivElement>;
  handleReaction: (emoji: string) => void;
  activeSideTab: 'chat' | 'participants' | 'music' | null;
  setActiveSideTab: React.Dispatch<React.SetStateAction<'chat' | 'participants' | 'music' | null>>;
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
  /** Sala (informativa; sin uso directo, se conserva por compatibilidad). */
  roomId?: string;
  /** ¿Está abierto el panel musical? (anillo activo + toggle). */
  musicOpen?: boolean;
  /** Abre/cierra el panel musical. */
  onToggleMusic?: () => void;
  /** Distribución en PC: repartida o píldora centrada (gusto personal). */
  layout?: 'spread' | 'centered';
  /** Etiquetas bajo los iconos (gusto personal). */
  showLabels?: boolean;
}

/**
 * Item de la barra: botón + etiqueta visible (estilo referencia Zoom).
 * La etiqueta es decorativa (aria-hidden); el lector usa el `title`.
 */
const BarItem: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({
  label,
  className = '',
  children,
}) => (
  <div className={`meet-bar-item ${className}`.trim()}>
    {children}
    <span className="meet-bar-label" aria-hidden="true">
      {label}
    </span>
  </div>
);

export const RoomControls: React.FC<RoomControlsProps> = ({
  localStream = null,
  onRetryMedia,
  isScreenSharing = false,
  onToggleScreenShare,
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
  musicOpen = false,
  onToggleMusic = () => undefined,
  layout = 'spread',
  showLabels = true,
}) => {
  const [deviceMenu, setDeviceMenu] = useState<'audio' | 'video' | null>(null);
  const [screenNotice, setScreenNotice] = useState(false);
  const screenAnchor = useRef<HTMLButtonElement>(null);
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

  const footerClass = [
    'meet-bottom-bar',
    !isBarVisible ? 'meet-bottom-bar--hidden' : '',
    layout === 'spread' ? 'meet-bottom-bar--spread' : '',
    showLabels ? '' : 'meet-bottom-bar--no-labels',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <footer className={footerClass}>
      {/* ── Izquierda: micro y cámara ── */}
      <div className="meet-bar-group meet-bar-group--left">
      <BarItem label={isMicOn ? 'Silenciar' : 'Activar micrófono'}>
        {/* Mic toggle — green when ON, red when OFF */}
        <div className="meet-device-control">
          <Button variant="unstyled"
          onClick={toggleMic}
          className={`meet-circle-btn ${isMicOn ? 'meet-circle-btn--mic-on' : 'meet-circle-btn--off'}`}
          title={isMicOn ? 'Silenciar micrófono' : 'Activar micrófono'}
        >
          {isMicOn ? <Mic size={18} /> : <MicOff size={18} />}
        </Button>
          <Button variant="unstyled" type="button" className="meet-device-arrow" aria-label="Opciones de micrófono" aria-expanded={deviceMenu === 'audio'} onClick={() => setDeviceMenu(value => value === 'audio' ? null : 'audio')}><ChevronDown size={14} /></Button>
          {deviceMenu === 'audio' && <Popover className="meet-device-menu" aria-label="Opciones de micrófono" onDismiss={() => setDeviceMenu(null)}>
            <DeviceTest compact kind="audio" localStream={localStream} />
            {onRetryMedia && <Button type="button" variant="ghost" size="sm" onClick={onRetryMedia}>Reconectar dispositivos</Button>}
          </Popover>}
        </div>
      </BarItem>

      <BarItem label={isCameraOn ? 'Detener video' : 'Iniciar video'}>
        {/* Camera toggle */}
        <div className="meet-device-control">
          <Button variant="unstyled"
          onClick={toggleCamera}
          className={`meet-circle-btn ${isCameraOn ? 'meet-circle-btn--on' : 'meet-circle-btn--off'}`}
          title={isCameraOn ? 'Apagar cámara' : 'Activar cámara'}
        >
          {isCameraOn ? <Video size={18} /> : <VideoOff size={18} />}
        </Button>
          <Button variant="unstyled" type="button" className="meet-device-arrow" aria-label="Opciones de cámara" aria-expanded={deviceMenu === 'video'} onClick={() => setDeviceMenu(value => value === 'video' ? null : 'video')}><ChevronDown size={14} /></Button>
          {deviceMenu === 'video' && <Popover className="meet-device-menu" aria-label="Opciones de cámara" onDismiss={() => setDeviceMenu(null)}>
            <DeviceTest compact kind="video" localStream={localStream} />
            {onRetryMedia && <Button type="button" variant="ghost" size="sm" onClick={onRetryMedia}>Reconectar dispositivos</Button>}
          </Popover>}
        </div>
      </BarItem>

      </div>



      {/* Conversación */}
      <div className="meet-bar-group meet-bar-group--social">
      <BarItem label="Reacciones">
        {/* Emoji Reactions trigger */}
        <div style={{ position: 'relative' }}>
          <Button variant="unstyled"
            onClick={() => setShowEmojiPicker((v) => !v)}
            className={`meet-circle-btn ${showEmojiPicker ? 'meet-circle-btn--active' : ''}`}
            title="Enviar reacción"
          >
            <Smile size={18} />
          </Button>

{emojiPresence.shown && (
          <div
            className={`meet-emoji-popup ${emojiPresence.closing ? 'meet-emoji-popup--closing' : ''}`}
            ref={emojiSheetRef}
          >
            <Reactions onReact={(emoji) => handleReaction(emoji)} />
          </div>
        )}
        </div>
      </BarItem>

      <BarItem label="Chat" className="meet-btn--hide-mobile">
        {/* Chat Drawer Toggle — hidden on mobile (moved to … menu) */}
        <Button variant="unstyled"
          onClick={() => { setActiveSideTab((v) => (v === 'chat' ? null : 'chat')); }}
          className={`meet-circle-btn meet-btn--hide-mobile ${activeSideTab === 'chat' ? 'meet-circle-btn--active' : ''}`}
          title="Chat"
        >
          <MessageSquare size={18} />
          {unreadCount > 0 && activeSideTab !== 'chat' && (
            <span className="meet-badge-dot" />
          )}
        </Button>
      </BarItem>
      <BarItem label="Participantes" className="meet-btn--hide-mobile">
        {/* Participants Drawer Toggle — hidden on mobile (moved to … menu) */}
        <Button variant="unstyled"
          onClick={() => setActiveSideTab((v) => (v === 'participants' ? null : 'participants'))}
          className={`meet-circle-btn meet-btn--hide-mobile ${activeSideTab === 'participants' ? 'meet-circle-btn--active' : ''}`}
          title="Ver participantes"
        >
          <Users size={18} />
        </Button>
      </BarItem>




      <BarItem label={isRightPanelCollapsed ? 'Mostrar' : 'Ocultar'} className="meet-btn--hide-mobile">
        {/* Toggle Collapse Cameras Strip (Accordion) — hidden on mobile */}
        <Button variant="unstyled"
          onClick={() => setIsRightPanelCollapsed((v) => !v)}
          className={`meet-circle-btn meet-btn--hide-mobile ${isRightPanelCollapsed ? 'meet-circle-btn--active' : ''}`}
          title={isRightPanelCollapsed ? 'Mostrar cámaras laterales' : 'Ocultar cámaras laterales'}
        >
          {isRightPanelCollapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
        </Button>
      </BarItem>
      </div>



      {/* ⋯ More Menu — visible only on mobile (the only icon-only button besides Share) */}
      <div className="meet-more-wrap" ref={moreMenuRef}>
        <Button variant="unstyled"
          onClick={() => setShowMoreMenu((v) => !v)}
          className={`meet-circle-btn meet-btn--mobile-only ${showMoreMenu ? 'meet-circle-btn--active' : ''}`}
          title="Más opciones"
        >
          <MoreVertical size={20} />
          {/* Unread badge on ⋯ when chat unread */}
          {unreadCount > 0 && activeSideTab !== 'chat' && (
            <span className="meet-badge-dot" />
          )}
        </Button>

        {morePresence.shown && (
          <Popover
            className={`meet-more-dropdown ${morePresence.closing ? 'meet-more-dropdown--closing' : ''}`}
            ref={moreSheetRef}
          >
            <Button variant="unstyled"
              className={`meet-more-item ${activeSideTab === 'chat' ? 'meet-more-item--active' : ''}`}
              onClick={() => { setActiveSideTab((v) => v === 'chat' ? null : 'chat'); setShowMoreMenu(false); }}
            >
              <MessageSquare size={16} />
              <span>Chat</span>
              {unreadCount > 0 && activeSideTab !== 'chat' && (
                <span className="meet-more-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </Button>
            <Button variant="unstyled"
              className={`meet-more-item ${activeSideTab === 'participants' ? 'meet-more-item--active' : ''}`}
              onClick={() => { setActiveSideTab((v) => v === 'participants' ? null : 'participants'); setShowMoreMenu(false); }}
            >
              <Users size={16} />
              <span>Participantes</span>
            </Button>
            <Button variant="unstyled"
              className="meet-more-item"
              onClick={() => { setIsRightPanelCollapsed((v) => !v); setShowMoreMenu(false); }}
            >
              {isRightPanelCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
              <span>{isRightPanelCollapsed ? 'Mostrar cámaras' : 'Ocultar cámaras'}</span>
            </Button>
            <Button variant="unstyled"
              className={`meet-more-item ${!uiPinned ? 'meet-more-item--active' : ''}`}
              onClick={() => { toggleBarsVisibility(); setShowMoreMenu(false); }}
            >
              {uiPinned ? <EyeOff size={16} /> : <Eye size={16} />}
              <span>{uiPinned ? 'Ocultar interfaz' : 'Mostrar interfaz'}</span>
            </Button>
            <div className="meet-more-separator" />
            <Button variant="danger"
              className="meet-more-item meet-more-item--danger"
              onClick={() => { handleLeaveClick(); setShowMoreMenu(false); }}
            >
              <PhoneOff size={16} />
              <span>Salir de la sala</span>
            </Button>
          </Popover>
        )}
      </div>


      {/* ── Características: música y pantalla ── */}
      <div className="meet-bar-group meet-bar-group--right">
      <BarItem label="Música">
        <Button variant="unstyled"
          type="button"
          onClick={onToggleMusic}
          className={`meet-circle-btn meet-circle-btn--music${musicOpen ? ' meet-circle-btn--active' : ''}`}
          title={musicOpen ? 'Cerrar panel de música' : 'Abrir música (YouTube)'}
          aria-label={musicOpen ? 'Cerrar panel de música' : 'Abrir música (YouTube)'}
        >
          <Music size={18} />
        </Button>
      </BarItem>
      {onToggleScreenShare && <BarItem label={isScreenSharing ? 'Dejar de compartir' : 'Compartir pantalla'}>
        <div style={{ position: 'relative' }}>
        <Button ref={screenAnchor} variant="unstyled" type="button" onClick={() => {
          if (!isScreenSharing && !navigator.mediaDevices?.getDisplayMedia) { setScreenNotice(value => !value); return; }
          onToggleScreenShare();
        }} className={`meet-circle-btn ${isScreenSharing ? 'meet-circle-btn--active' : ''}`} title={isScreenSharing ? 'Dejar de compartir pantalla' : 'Compartir pantalla o ventana'} aria-pressed={isScreenSharing}>
          {isScreenSharing ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />}
        </Button>
        {screenNotice && <Popover anchor={screenAnchor.current} className="meet-device-menu" role="dialog" aria-label="Compartir pantalla" onDismiss={() => setScreenNotice(false)}>
          <h4>Compartir pantalla</h4>
          <p>Este navegador no permite transmitir la pantalla de tu dispositivo. Puedes ver las pantallas de otros participantes o compartir desde un equipo compatible.</p>
          <Button variant="secondary" onClick={() => setScreenNotice(false)}>Entendido</Button>
        </Popover>}
        </div>
      </BarItem>}
      </div>



      {/* ── Final: salir ── */}
      <div className="meet-bar-group meet-bar-group--end">
      <BarItem label="Salir" className="meet-btn--hide-mobile">
        {/* Leave Call Button — hidden on mobile (available in ⋯ menu), visible on desktop */}
        <Button variant="unstyled"
          onClick={handleLeaveClick}
          className="meet-circle-btn meet-circle-btn--leave meet-btn--hide-mobile"
          title="Salir de la reunión"
        >
          <PhoneOff size={18} />
        </Button>
      </BarItem>
      </div>
    </footer>
  );
};
