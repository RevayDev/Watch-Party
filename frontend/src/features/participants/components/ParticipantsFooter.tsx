import React from 'react';
import { MicOff, VideoOff } from 'lucide-react';
import { IRoomSettings } from '../../../types/room';

export interface ParticipantsFooterProps {
  muteOnEntry: boolean;
  cameraOffOnEntry: boolean;
  setMuteOnEntry: (v: boolean) => void;
  setCameraOffOnEntry: (v: boolean) => void;
  onUpdateSettings?: (settings: Partial<IRoomSettings>) => void;
  onMuteAll?: () => void;
  onDisableAllCameras?: () => void;
}

/** Controles inferiores de moderación (JSX movido verbatim). */
export const ParticipantsFooter: React.FC<ParticipantsFooterProps> = ({
  muteOnEntry,
  cameraOffOnEntry,
  setMuteOnEntry,
  setCameraOffOnEntry,
  onUpdateSettings,
  onMuteAll,
  onDisableAllCameras,
}) => {
  return (
    <div className="part-footer-controls">
      {/* Left: Opciones al entrar */}
      <div className="part-footer-col">
        <span className="part-footer-title">Al entrar</span>
        <div className="part-toggle-row">
          <label className="part-switch">
            <input
              type="checkbox"
              checked={muteOnEntry}
              onChange={(e) => {
                setMuteOnEntry(e.target.checked);
                onUpdateSettings?.({ muteOnEntry: e.target.checked });
              }}
            />
            <span className="part-slider" />
          </label>
          <div className="part-toggle-label">
            <span>Micro apagado</span>
          </div>
        </div>
        <div className="part-toggle-row">
          <label className="part-switch">
            <input
              type="checkbox"
              checked={cameraOffOnEntry}
              onChange={(e) => {
                setCameraOffOnEntry(e.target.checked);
                onUpdateSettings?.({
                  cameraOffOnEntry: e.target.checked,
                });
              }}
            />
            <span className="part-slider" />
          </label>
          <div className="part-toggle-label">
            <span>Cámara apagada</span>
          </div>
        </div>
      </div>

      {/* Right: Restricciones generales */}
      <div className="part-footer-col">
        <span className="part-footer-title">Restricciones</span>
        <div className="part-footer-actions">
          <button
            type="button"
            onClick={onMuteAll}
            className="part-outline-action-btn"
          >
            <MicOff size={14} />
            <span>Silenciar todos</span>
          </button>
          <button
            type="button"
            onClick={onDisableAllCameras}
            className="part-outline-action-btn"
          >
            <VideoOff size={14} />
            <span>Apagar cámaras</span>
          </button>
        </div>
      </div>
    </div>
  );
};
