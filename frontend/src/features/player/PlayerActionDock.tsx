import { useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, GripVertical, RefreshCw, X } from 'lucide-react';
import { Button } from '../../shared/components/ui';
import { nearestDockEdge, type DockEdge } from './dockPosition';
export function PlayerActionDock({ onChange, onClear, children }: { onChange?: () => void; onClear?: () => void; children?: ReactNode }) {
 const root = useRef<HTMLDivElement>(null);
 const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
 const [collapsed, setCollapsed] = useState(false);
 const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
 const [edge, setEdge] = useState<DockEdge>('top');
 const [anchor, setAnchor] = useState<CSSProperties>({ left: '50%', top: 0, transform: 'translateX(-50%)' });
 const move = (left: number, top: number) => {
  const el = root.current, parent = el?.parentElement; if (!el || !parent) return;
  const x = Math.max(0, Math.min(left, parent.clientWidth - el.offsetWidth));
  const y = Math.max(0, Math.min(top, parent.clientHeight - el.offsetHeight));
  setPosition({ left: x, top: y });
  setEdge(nearestDockEdge(x, y, el.offsetWidth, el.offsetHeight, parent.clientWidth, parent.clientHeight));
 };
 const fold = () => {
  if (collapsed) { setCollapsed(false); return; }
  const el = root.current, parent = el?.parentElement; if (!el || !parent) return;
  const rect = el.getBoundingClientRect(), box = parent.getBoundingClientRect();
  const x = rect.left - box.left, y = rect.top - box.top;
  const closest = nearestDockEdge(x, y, el.offsetWidth, el.offsetHeight, parent.clientWidth, parent.clientHeight);
  setEdge(closest);
  const centerX = Math.max(0, Math.min(x + el.offsetWidth / 2 - 18, parent.clientWidth - 36));
  const centerY = Math.max(0, Math.min(y + el.offsetHeight / 2 - 20, parent.clientHeight - 40));
  setAnchor(closest === 'top' ? { left: centerX, top: 0 } : closest === 'bottom' ? { left: centerX, bottom: 0 } : closest === 'left' ? { left: 0, top: centerY } : { right: 0, top: centerY });
  setCollapsed(true);
 };
 const Arrow = edge === 'top' ? (collapsed ? ChevronDown : ChevronUp) : edge === 'bottom' ? (collapsed ? ChevronUp : ChevronDown) : edge === 'left' ? (collapsed ? ChevronRight : ChevronLeft) : (collapsed ? ChevronLeft : ChevronRight);
 return <div ref={root} className="player-action-dock" data-edge={edge} style={collapsed ? anchor : position ?? { left: '50%', top: 12, transform: 'translateX(-50%)' }}>
  {!collapsed && <><Button type="button" variant="unstyled" className="player-action-dock__grip" title="Mover acciones del video" aria-label="Mover acciones del video" onPointerDown={event => { const rect = root.current!.getBoundingClientRect(), parent = root.current!.parentElement!.getBoundingClientRect(); drag.current = { x: event.clientX, y: event.clientY, left: rect.left - parent.left, top: rect.top - parent.top }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }} onPointerMove={event => { const start = drag.current; if (start) move(start.left + event.clientX - start.x, start.top + event.clientY - start.y); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={event => { const delta: Record<string, [number, number]> = { ArrowLeft: [-12,0], ArrowRight: [12,0], ArrowUp: [0,-12], ArrowDown: [0,12] }; if (delta[event.key]) { event.preventDefault(); event.stopPropagation(); move((root.current?.offsetLeft ?? 0) + delta[event.key][0], (position?.top ?? 12) + delta[event.key][1]); } }}><GripVertical size={16} /></Button>
  {onChange && <Button type="button" variant="unstyled" className="player-change-btn" title="Cambiar video: subir archivo o pegar enlace" onClick={onChange}><RefreshCw size={14} />Cambiar</Button>}
  {onClear && <Button type="button" variant="unstyled" className="player-change-btn" title="Quitar video" onClick={onClear}><X size={14} />Quitar</Button>}</>}
  <div className="player-action-dock__audio" hidden={collapsed}>{children}</div>
  <Button type="button" variant="unstyled" className="player-action-dock__fold" title={collapsed ? 'Mostrar acciones del video' : 'Ocultar acciones del video'} aria-label={collapsed ? 'Mostrar acciones del video' : 'Ocultar acciones del video'} onClick={fold}><Arrow size={16} /></Button>
 </div>;
}
