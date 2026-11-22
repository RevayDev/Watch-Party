let offset = 0;
let bestRtt = Infinity;
export const roomNow = () => Date.now() + offset;
export function resetRoomClock() { offset = 0; bestRtt = Infinity; }
export function sampleRoomClock(sent: number, server: number, received = Date.now()) {
 const rtt = received - sent;
 if (![sent, server, received].every(Number.isFinite) || rtt < 0 || rtt > 5000) return;
 if (rtt <= bestRtt + 20) { offset = server - (sent + received) / 2; bestRtt = rtt; }
}
