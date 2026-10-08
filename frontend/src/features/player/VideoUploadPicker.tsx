import React from 'react';
import { Loader2 } from 'lucide-react';
import { DEMO_UPLOAD_DISABLED_MESSAGE, isDemoMode } from '../../shared/demo';

export type PickerTab = 'upload' | 'url';

export interface VideoUploadPickerProps {
  activeTab: PickerTab;
  setActiveTab: (t: PickerTab) => void;
  urlInput: string;
  titleInput: string;
  setUrlInput: (v: string) => void;
  setTitleInput: (v: string) => void;
  isSubmittingUrl: boolean;
  onUrlSubmit: (e: React.FormEvent) => void;
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onTriggerFile: () => void;
}

/**
 * Picker subir-archivo vs enlace (JSX movido verbatim desde VideoPlayer.tsx).
 */
export const VideoUploadPicker: React.FC<VideoUploadPickerProps> = ({
  activeTab,
  setActiveTab,
  urlInput,
  titleInput,
  setUrlInput,
  setTitleInput,
  isSubmittingUrl,
  onUrlSubmit,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onTriggerFile,
}) => {
  // Demo: la subida de archivos está deshabilitada solo visualmente (el tab
  // queda disabled con tooltip y siempre se muestra el formulario de enlace).
  // El código original queda intacto tras el flag.
  const demo = isDemoMode();
  return (
    <>
      <div className="dropzone-tabs">
        <button
          type="button"
          className={`dropzone-tab-btn ${activeTab === 'upload' ? 'dropzone-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('upload')}
          disabled={demo}
          aria-disabled={demo}
          title={demo ? DEMO_UPLOAD_DISABLED_MESSAGE : undefined}
          data-testid="demo-upload-tab"
        >
          <span>Subir Archivo</span>
        </button>
        <button
          type="button"
          className={`dropzone-tab-btn ${activeTab === 'url' ? 'dropzone-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('url')}
        >
          <span>{demo ? 'Pegar enlace de Google Drive' : 'Enlace Web / HLS'}</span>
        </button>
      </div>
      {demo && (
        <p
          className="dropzone-supported-hints"
          data-testid="demo-upload-note"
          title={DEMO_UPLOAD_DISABLED_MESSAGE}
        >
          <span>{DEMO_UPLOAD_DISABLED_MESSAGE}</span>
        </p>
      )}
      {activeTab === 'upload' && !demo ? (
        <div
          className={`dropzone-box ${isDragOver ? 'dropzone-box--active' : ''}`}
          onClick={onTriggerFile}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="dropzone-box__title">Sube un archivo multimedia</div>
          <div className="dropzone-box__subtitle">
            Arrastra tu archivo aquí o haz clic (.mp4, .mkv, .webm)
          </div>
          <button
            type="button"
            className="btn btn--primary"
            style={{ marginTop: '0.25rem', padding: '0.5rem 1.25rem', fontSize: '0.84rem' }}
          >
            Seleccionar de mi PC
          </button>
        </div>
      ) : (
        <form onSubmit={onUrlSubmit} className="dropzone-url-card">
          <div className="dropzone-input-group">
            <label>Enlace del video o transmisión:</label>
            <input
              type="url"
              required
              placeholder="https://... playlist.m3u8 o Google Drive"
              className="dropzone-input"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
            />
          </div>
          <div className="dropzone-input-group">
            <label>Título del archivo (opcional):</label>
            <input
              type="text"
              placeholder="Ej: Nuestro viaje de verano"
              className="dropzone-input"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
            />
          </div>

          <div className="dropzone-supported-hints">
            <span>✓ Compatible con transmisiones HLS (.m3u8, Yandex, etc.)</span>
            <span>✓ Compatible con enlaces públicos de Google Drive</span>
            <span>✓ Compatible con URLs directas (.mp4, .webm)</span>
          </div>

          <button
            type="submit"
            disabled={isSubmittingUrl || !urlInput.trim()}
            className="btn btn--primary"
            style={{ marginTop: '0.4rem', padding: '0.65rem', justifyContent: 'center' }}
          >
            {isSubmittingUrl ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Cargando enlace...</span>
              </>
            ) : (
              'Transmitir Enlace en la Sala'
            )}
          </button>
        </form>
      )}
    </>
  );
};
