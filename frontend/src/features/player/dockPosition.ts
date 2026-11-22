export type DockEdge = 'top' | 'right' | 'bottom' | 'left';
export function nearestDockEdge(left: number, top: number, width: number, height: number, parentWidth: number, parentHeight: number): DockEdge {
 const distances: [DockEdge, number][] = [['top', top], ['right', parentWidth - left - width], ['bottom', parentHeight - top - height], ['left', left]];
 return distances.reduce((best, item) => item[1] < best[1] ? item : best)[0];
}
