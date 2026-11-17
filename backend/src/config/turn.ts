import { createHmac } from 'node:crypto';

export function createTurnCredentials(socketId: string) {
  const secret = process.env.TURN_SHARED_SECRET?.trim();
  const urls = process.env.TURN_URLS?.split(',').map((url) => url.trim()).filter((url) => /^turns?:[^\s]+$/i.test(url));
  if (!secret || !urls?.length) return undefined;

  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const username = `${expiresAt}:${socketId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { urls, username, credential };
}
