import { createHmac } from 'node:crypto';

const TURN_URL_PATTERN = /^turns?:[^\s]+$/i;

function getTurnConfig() {
  const secret = process.env.TURN_SHARED_SECRET?.trim();
  const urls = process.env.TURN_URLS
    ?.split(',')
    .map((url) => url.trim())
    .filter((url) => TURN_URL_PATTERN.test(url));

  return { secret, urls: urls?.length ? urls : undefined };
}

/**
 * Safe to expose in diagnostics: it deliberately reveals neither relay URLs
 * nor the shared secret.  The backend creates short-lived credentials only
 * after a participant has joined a room.
 */
export function isTurnConfigured() {
  const { secret, urls } = getTurnConfig();
  return Boolean(secret && urls);
}

export function createTurnCredentials(socketId: string) {
  const { secret, urls } = getTurnConfig();
  if (!secret || !urls) return undefined;

  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const username = `${expiresAt}:${socketId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { urls, username, credential };
}
