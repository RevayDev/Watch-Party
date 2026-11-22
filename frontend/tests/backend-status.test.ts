// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
function response() { return { code: 0, body: null as unknown, setHeader: vi.fn(), status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } }; }
it('reports offline as a normal JSON status when Render fails instead of leaking CORS to the page', async () => {
 vi.stubEnv('VITE_API_URL', 'https://sleeping.onrender.com');
 const fetch = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetch);
 const { default: handler } = await import('../api/backend-status.mjs');
 const res = response(); await handler({ method: 'GET' }, res);
 expect(res.code).toBe(200); expect(res.body).toEqual({ ok: false, availability: null });
 const again = response(); await handler({ method: 'GET' }, again);
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('returns availability only after verifying the configured backend health', async () => {
 vi.stubEnv('VITE_API_URL', 'https://ready.onrender.com');
 const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ roomsAvailable: 3 }));
 vi.stubGlobal('fetch', fetch);
 const { default: handler } = await import('../api/backend-status.mjs');
 const res = response(); await handler({ method: 'GET' }, res);
 expect(res.body).toEqual({ ok: true, availability: { roomsAvailable: 3 } });
 expect(fetch.mock.calls[0][0].href).toBe('https://ready.onrender.com/api/health');
});
