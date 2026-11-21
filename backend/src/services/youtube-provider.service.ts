import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const registrationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('google'), apiKey: z.string().trim().min(20).max(200) }),
  z.object({ kind: z.literal('endpoint'), endpoint: z.string().url().max(2048), token: z.string().max(2048).optional() }),
]);
type Provider = { kind: 'google' | 'endpoint'; endpoint?: string; secret: string; owner: string; expiresAt: number; expiryTimer?: ReturnType<typeof setTimeout> };
const providers = new Map<string, Provider>();
export const PROVIDER_TTL_MS = 6 * 60 * 60 * 1000;

export function registerYouTubeProvider(input: unknown) {
  const config = registrationSchema.parse(input);
  if (config.kind === 'endpoint') {
    const url = new URL(config.endpoint);
    const allowed = (process.env.YOUTUBE_SEARCH_PROVIDER_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || !allowed.includes(url.origin)) {
      throw new Error('El endpoint debe usar HTTPS y pertenecer a un origen autorizado en YOUTUBE_SEARCH_PROVIDER_ORIGINS. No incluyas claves en la URL.');
    }
    if (/[\r\n]/.test(config.token || '')) throw new Error('Token inválido.');
  }
  for (const [id, provider] of providers) if (provider.expiresAt <= Date.now()) {
    clearTimeout(provider.expiryTimer); providers.delete(id);
  }
  if (providers.size >= 1000) throw new Error('No hay capacidad para registrar otro proveedor.');
  const id = randomBytes(32).toString('hex');
  const owner = randomBytes(32).toString('hex');
  const provider: Provider = {
    kind: config.kind, secret: config.kind === 'google' ? config.apiKey : config.token || '', owner,
    endpoint: config.kind === 'endpoint' ? config.endpoint : undefined, expiresAt: Date.now() + PROVIDER_TTL_MS,
  };
  providers.set(id, provider);
  provider.expiryTimer = setTimeout(() => providers.delete(id), PROVIDER_TTL_MS);
  provider.expiryTimer.unref();
  return { id, owner, ...describeYouTubeProvider(id)! };
}

export function getYouTubeProvider(id: string) {
  const provider = providers.get(id);
  if (provider && provider.expiresAt <= Date.now()) { clearTimeout(provider.expiryTimer); providers.delete(id); return undefined; }
  return provider;
}

export function describeYouTubeProvider(id: string) {
  const provider = getYouTubeProvider(id);
  return provider ? { kind: provider.kind, endpoint: provider.endpoint, expiresAt: provider.expiresAt } : null;
}

export function revokeYouTubeProvider(id: string, owner: string) {
  const provider = getYouTubeProvider(id);
  if (!provider || !/^[a-f0-9]{64}$/.test(owner) || owner.length !== provider.owner.length || !timingSafeEqual(Buffer.from(owner), Buffer.from(provider.owner))) return false;
  clearTimeout(provider.expiryTimer);
  return providers.delete(id);
}
