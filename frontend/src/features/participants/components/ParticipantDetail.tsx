import React from 'react';
import { Ban, Crown, Pencil, Shield, ShieldOff, UserX } from 'lucide-react';
import { IParticipant } from '../../../types/room';
import { confirmAction } from '../../../services/notifications';
import { BottomSheet } from '../../../shared/components/BottomSheet';
import { getAvatarColor, getInitials } from '../../../shared/utils';

export interface ParticipantDetailProps {
  detailView: IParticipant;
  open: boolean;
  onClose: () => void;
  isSameUser: (p: IParticipant) => boolean;
  canModerateTarget: (p: IParticipant) => boolean;
  canModerate: boolean;
  /** Solo el host gestiona roles (promover/degradar cohost, pasar sala). */
  canManageRoles?: boolean;
  isHost?: boolean;
  isRenaming: boolean;
  newNameVal: string;
  setNewNameVal: (v: string) => void;
  setIsRenaming: (v: boolean) => void;
  openRename: (p: IParticipant) => void;
  saveRename: () => void;
  onKickUser?: (targetUserName: string, targetUserId?: string) => void;
  onBanUser?: (targetUserName: string, targetUserId?: string) => void;
  onToggleCoHost?: (targetUserName: string, makeCoHost: boolean) => void;
  onTransferHost?: (targetUserName: string, targetUserId?: string) => void;
  onSelectNone: () => void;
}

/** Ficha de participante + modal de renombrado (JSX movido verbatim). */
export const ParticipantDetail: React.FC<ParticipantDetailProps> = ({
  detailView,
  open,
  onClose,
  isSameUser,
  canModerateTarget,
  canModerate,
  canManageRoles = false,
  isHost = false,
  isRenaming,
  newNameVal,
  setNewNameVal,
  setIsRenaming,
  openRename,
  saveRename,
  onKickUser,
  onBanUser,
  onToggleCoHost,
  onTransferHost,
  onSelectNone,
}) => {
  const isTargetHost = detailView.isHost || detailView.role === 'host';
  const isTargetCoHost = !isTargetHost && detailView.role === 'cohost';
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      variant="inline"
      desktopClassName="part-detail-card"
      label={`Detalle de ${detailView.name}`}
    >
      {/* Top User Header */}
      <div className="part-detail-header">
        <div
          className="part-detail-avatar"
          style={{ background: getAvatarColor(detailView.name) }}
        >
          {getInitials(detailView.name)}
          <span className="part-status-dot part-status-dot--online" />
        </div>

        <div className="part-detail-identity">
          <div className="part-detail-name-row">
            <h3>{detailView.name}</h3>
            {isSameUser(detailView) ? (
              <span className="part-name-tag">(Tú)</span>
            ) : detailView.isHost || detailView.role === 'host' ? (
              <span className="part-name-tag">(Host)</span>
            ) : detailView.role === 'cohost' ? (
              <span className="part-name-tag">(Co-Host)</span>
            ) : null}
          </div>
          <span className="part-detail-status">● En línea</span>
        </div>
      </div>

      {/* Pop-up de renombrado (botón "Renombrar" de la ficha) */}
      <BottomSheet
        open={isRenaming}
        onClose={() => setIsRenaming(false)}
        label={`Renombrar a ${detailView.name}`}
        className="sheet--sm"
      >
        <form
          className="part-rename-modal"
          onSubmit={(event) => {
            event.preventDefault();
            saveRename();
          }}
        >
          <h3>Renombrar usuario</h3>
          <p>El nuevo nombre será visible para todos en la sala.</p>
          <input
            type="text"
            value={newNameVal}
            maxLength={50}
            onChange={(e) => setNewNameVal(e.target.value)}
            placeholder="Nuevo nombre"
            className="part-search-input"
            autoFocus
          />
          <div className="part-rename-modal__actions">
            <button
              type="button"
              className="host-exit-modal__cancel-btn"
              onClick={() => setIsRenaming(false)}
            >
              Cancelar
            </button>
            <button type="submit" className="part-rename-save-btn">
              Guardar
            </button>
          </div>
        </form>
      </BottomSheet>

      {/* Acciones: moderación arriba (TOP), renombrar separado abajo */}
      {(canModerate || isSameUser(detailView)) && (
        <div className="part-detail-actions">
          {canModerateTarget(detailView) && (
            <div className="part-detail-modrow">
              <button
                type="button"
                className="part-outline-action-btn part-outline-action-btn--danger"
                onClick={() => {
                  confirmAction({
                    title: 'Expulsar usuario',
                    message: `¿Expulsar a ${detailView.name}? Podrá volver a entrar a la sala.`,
                    confirmLabel: 'Expulsar',
                    danger: true,
                  }).then((ok) => {
                    if (ok) {
                      onKickUser?.(detailView.name, detailView.userId);
                      onSelectNone();
                    }
                  });
                }}
              >
                <UserX size={14} />
                <span>Expulsar</span>
              </button>
              <button
                type="button"
                className="part-outline-action-btn part-outline-action-btn--danger"
                onClick={() => {
                  confirmAction({
                    title: 'Banear usuario',
                    message: `¿Banear a ${detailView.name}? No podrá volver a entrar a la sala.`,
                    confirmLabel: 'Banear',
                    danger: true,
                  }).then((ok) => {
                    if (ok) {
                      onBanUser?.(detailView.name, detailView.userId);
                      onSelectNone();
                    }
                  });
                }}
              >
                <Ban size={14} />
                <span>Banear</span>
              </button>
            </div>
          )}
          <button
            type="button"
            className="part-outline-action-btn part-detail-rename-btn"
            onClick={() => openRename(detailView)}
          >
            <Pencil size={14} />
            <span>Renombrar</span>
          </button>
          {canManageRoles && !isSameUser(detailView) && !isTargetHost && (
            <div className="part-detail-modrow">
              <button
                type="button"
                className="part-outline-action-btn"
                onClick={() => {
                  onToggleCoHost?.(detailView.name, !isTargetCoHost);
                }}
              >
                {isTargetCoHost ? <ShieldOff size={14} /> : <Shield size={14} />}
                <span>{isTargetCoHost ? 'Quitar cohost' : 'Hacer cohost'}</span>
              </button>
              {isHost && (
                <button
                  type="button"
                  className="part-outline-action-btn"
                  onClick={() => {
                    if (
                      window.confirm(
                        `¿Pasar la sala a ${detailView.name}? Perderás el control de anfitrión.`
                      )
                    ) {
                      onTransferHost?.(detailView.name, detailView.userId);
                      onSelectNone();
                    }
                  }}
                >
                  <Crown size={14} />
                  <span>Pasar sala</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Ficha de Información Detallada */}
      <div className="part-info-section">
        <div className="part-info-section-title">
          <span>Info</span>
        </div>
        <div className="part-info-grid">
          <div className="part-info-item">
            <span className="part-info-label">Rol</span>
            <span className="part-info-value">
              {detailView.isHost || detailView.role === 'host'
                ? 'Host'
                : detailView.role === 'cohost'
                  ? 'Co-Host'
                  : 'Miembro'}
            </span>
          </div>
          <div className="part-info-item">
            <span className="part-info-label">Unido</span>
            <span className="part-info-value">
              {new Date(
                detailView.joinedAt || Date.now(),
              ).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="part-info-item">
            <span className="part-info-label">Dispositivo</span>
            <span className="part-info-value">
              {detailView.device || 'Web'}
            </span>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
};
