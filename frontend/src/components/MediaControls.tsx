import { Button } from '../shared/components/ui';
import React from 'react';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';

interface MediaControlsProps {
  isMicOn: boolean;
  isCameraOn: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  mediaError?: string | null;
}

export const MediaControls: React.FC<MediaControlsProps> = ({
  isMicOn,
  isCameraOn,
  onToggleMic,
  onToggleCamera,
  mediaError,
}) => {
  return (
    <div className="media-bar">
      <div className="media-bar__controls">
        {/* Mic Circular Button */}
        <Button variant="unstyled"
          type="button"
          onClick={onToggleMic}
          className={`meet-action-btn ${isMicOn ? 'meet-action-btn--active' : 'meet-action-btn--off'}`}
          title={isMicOn ? 'Silenciar micrófono' : 'Activar micrófono'}
        >
          {isMicOn ? <Mic size={18} /> : <MicOff size={18} color="#ef4444" />}
        </Button>

        {/* Camera Circular Button */}
        <Button variant="unstyled"
          type="button"
          onClick={onToggleCamera}
          className={`meet-action-btn ${isCameraOn ? 'meet-action-btn--active' : 'meet-action-btn--off'}`}
          title={isCameraOn ? 'Apagar cámara' : 'Activar cámara'}
        >
          {isCameraOn ? <Video size={18} /> : <VideoOff size={18} color="#ef4444" />}
        </Button>
      </div>

      {mediaError && (
        <div className="media-bar__error">⚠️ {mediaError}</div>
      )}
    </div>
  );
};
