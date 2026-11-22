import { useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, RefreshCw, X } from 'lucide-react';
import { Button } from '../../shared/components/ui';
export function PlayerActionDock({ onChange, onClear, children }: { onChange?: () => void; onClear?: () => void; children?: ReactNode }) {
 const root = useRef<HTMLDivElement>(null);
 const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
 const [collapsed, setCollapsed] = useState(false);
 const [position, setPosition] = useState<{ left?: number; top: number }>({ top: 12 });
 const move = (left: number, top: number) => { const parent = root.current?.parentElement; if (!parent) return; setPosition({ left: Math.max(0, Math.min(left, parent.clientWidth - (root.current?.offsetWidth ?? 220))), top: Math.max(0, Math.min(top, parent.clientHeight - 44)) }); };
 return <div ref={root} className="player-action-dock" style={collapsed ? { right: 0, top: position.top } : { left: position.left, right: position.left === undefined ? 12 : 'auto', top: position.top }}>
  {!collapsed && <><Button type="button" variant="unstyled" className="player-action-dock__grip" title="Mover acciones del video" aria-label="Mover acciones del video" onPointerDown={event => { const rect = root.current!.getBoundingClientRect(), parent = root.current!.parentElement!.getBoundingClientRect(); drag.current = { x: event.clientX, y: event.clientY, left: rect.left - parent.left, top: rect.top - parent.top }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }} onPointerMove={event => { const start = drag.current; if (start) move(start.left + event.clientX - start.x, start.top + event.clientY - start.y); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={event => { const delta: Record<string, [number, number]> = { ArrowLeft: [-12,0], ArrowRight: [12,0], ArrowUp: [0,-12], ArrowDown: [0,12] }; if (delta[event.key]) { event.preventDefault(); event.stopPropagation(); move((root.current?.offsetLeft ?? 0) + delta[event.key][0], position.top + delta[event.key][1]); } }}><GripVertical size={16} /></Button>
  {onChange && <Button type="button" variant="unstyled" className="player-change-btn" title="Cambiar video: subir archivo o pegar enlace" onClick={onChange}><RefreshCw size={14} />Cambiar</Button>}
  {onClear && <Button type="button" variant="unstyled" className="player-change-btn" title="Quitar video" onClick={onClear}><X size={14} />Quitar</Button>}</>}
  <div className="player-action-dock__audio" hidden={collapsed}>{children}</div>
  <Button type="button" variant="unstyled" className="player-action-dock__fold" title={collapsed ? 'Mostrar acciones del video' : 'Ocultar acciones del video'} aria-label={collapsed ? 'Mostrar acciones del video' : 'Ocultar acciones del video'} onClick={() => setCollapsed(value => !value)}>{collapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</Button>
 </div>;
}
