// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
it('uses Vercel search even when a Render backend is configured', async () => {
 vi.stubEnv('VITE_API_URL', 'https://sleeping.onrender.com'); vi.resetModules();
 const fetch = vi.fn().mockResolvedValue(Response.json({ tracks: [] })); vi.stubGlobal('fetch', fetch);
 const { ApiService } = await import('../src/services/api');
 await ApiService.youtubeSearch('song', new AbortController().signal);
 expect(fetch.mock.calls[0][0]).toBe('/api/youtube/search?q=song');
 expect(fetch).toHaveBeenCalledTimes(1);
});
