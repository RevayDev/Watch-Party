import { expect, it } from 'vitest';
import { nearestDockEdge } from '../src/features/player/dockPosition';
it.each([
 [350,12,'top'], [0,220,'left'], [800,220,'right'], [350,550,'bottom'],
 [0,0,'top'], [800,550,'right'],
] as const)('folds from %s,%s toward %s', (x,y,edge) => {
 expect(nearestDockEdge(x,y,200,50,1000,600)).toBe(edge);
});
