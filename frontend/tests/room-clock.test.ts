import { afterEach, expect, it, vi } from 'vitest';
import { resetRoomClock, roomNow, sampleRoomClock } from '../src/shared/roomClock';
afterEach(() => { vi.useRealTimers(); resetRoomClock(); });
it('compensates device clock skew using the round-trip midpoint', () => {
 vi.useFakeTimers(); vi.setSystemTime(10020);
 sampleRoomClock(10000, 10510, 10020);
 expect(roomNow()).toBe(10520);
 vi.setSystemTime(11020); expect(roomNow()).toBe(11520);
});
it('rejects invalid and very late clock samples', () => {
 vi.useFakeTimers(); vi.setSystemTime(1000);
 sampleRoomClock(2000, 4000, 1000); sampleRoomClock(0, 20000, 9000);
 expect(roomNow()).toBe(1000);
});
