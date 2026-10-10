import crypto from 'node:crypto';

/**
 * Cifrado AES-256-GCM para los tokens de Spotify en reposo.
 * La clave sale de `SPOTIFY_TOKEN_KEY` (hex de 32 bytes); sin clave válida
 * se lanza `Error('SPOTIFY_TOKEN_KEY no configurada')` y el servicio cae a
 * memoria efímera (ver `spotify.service.ts`).
 * Formato serializado: base64 de `iv(12) | authTag(16) | ciphertext`.
 */

const KEY_ERROR = 'SPOTIFY_TOKEN_KEY no configurada';

function readKey(): Buffer {
  const raw = (process.env.SPOTIFY_TOKEN_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(KEY_ERROR);
  }
  return Buffer.from(raw, 'hex');
}

/** ¿Hay clave válida para persistencia cifrada? (no lanza). */
export function hasSpotifyTokenKey(): boolean {
  try {
    readKey();
    return true;
  } catch {
    return false;
  }
}

/** Cifra texto plano → base64. Lanza si la clave falta o es inválida. */
export function encryptToB64(plain: string): string {
  const key = readKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Descifra base64 → texto plano. Lanza si la clave falta o es inválida. */
export function decryptFromB64(payload: string): string {
  const key = readKey();
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < 12 + 16 + 1) throw new Error(KEY_ERROR);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
