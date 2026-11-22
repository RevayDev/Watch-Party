import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '../shared/components/ui';
export function MediaConnectionNotice({ failed, hasPeers = true, onRetry }: { failed: boolean; hasPeers?: boolean; onRetry: () => void }) {
 const [dismissed, setDismissed] = useState(false);
 useEffect(() => { if (!failed) setDismissed(false); }, [failed]);
 // A stale RTC retry must not alarm somebody who is alone in the room.
 if (!failed || !hasPeers || dismissed) return null;
 return <aside className="media-connection-notice" role="status">
  <span>Audio o cámara sin conexión</span>
  <Button variant="icon" aria-label="Reconectar micrófonos y cámaras" title="Reconectar micrófonos y cámaras" onClick={onRetry}><RefreshCw size={16} /></Button>
  <Button variant="icon" aria-label="Ocultar aviso de conexión" onClick={() => setDismissed(true)}><X size={16} /></Button>
 </aside>;
}
