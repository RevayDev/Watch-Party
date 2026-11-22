// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
// JS functions deploy without depending on the frontend TypeScript build.
import search from '../api/youtube/search.mjs';
import status from '../api/youtube/status.mjs';
import proxy, { allowedDriveUrl, driveRange, confirmationUrl } from '../api/proxy.mjs';

class ResponseMock extends Writable {
 code = 200; headers = new Map(); body: unknown; chunks: Buffer[] = []; headersSent = false;
 setHeader(key: string, value: string) { this.headers.set(key, value); }
 status(code: number) { this.code = code; return this; }
 json(body: unknown) { this.body = body; this.end(); return this; }
 _write(chunk: Buffer, _encoding: string, done: () => void) { this.headersSent = true; this.chunks.push(Buffer.from(chunk)); done(); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('reports missing platform credentials without disclosing them', async () => {
 vi.stubEnv('YOUTUBE_API_KEY', ''); const response = new ResponseMock();
 await search({ method: 'GET', query: { q: 'missing' } }, response);
 expect(response.code).toBe(503);
 vi.stubEnv('YOUTUBE_API_KEY', 'private-key'); const ready = new ResponseMock();
 status({ method: 'GET' }, ready); expect(ready.body).toEqual({ configured: true });
});
it('searches Google on the server and returns the existing track contract', async () => {
 vi.stubEnv('YOUTUBE_API_KEY', 'private-key');
 const fetch = vi.fn().mockResolvedValue(Response.json({ items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'Song', channelTitle: 'Artist' } }] }));
 vi.stubGlobal('fetch', fetch); const response = new ResponseMock();
 await search({ method: 'GET', query: { q: 'vercel song' } }, response);
 expect(response.code).toBe(200);
 expect(response.body).toMatchObject({ tracks: [{ id: 'abcdefghijk', name: 'Song', openUrl: 'https://www.youtube.com/watch?v=abcdefghijk' }] });
 expect(fetch.mock.calls[0][1].headers).toEqual({ 'X-Goog-Api-Key': 'private-key' });
 expect(JSON.stringify(response.body)).not.toContain('private-key');
});
it.each(['https://localhost/video', 'https://drive.google.com.evil.test/video', 'http://drive.google.com/file', 'https://user:pass@drive.google.com/file'])('rejects unapproved proxy target %s', url => {
 expect(() => allowedDriveUrl(url)).toThrow();
});
it('bounds open and oversized ranges while preserving seeks', () => {
 expect(driveRange()).toBe('bytes=0-4194303');
 expect(driveRange('bytes=100-')).toBe('bytes=100-4194403');
 expect(driveRange('bytes=0-99999999')).toBe('bytes=0-4194303');
 expect(driveRange('bytes=20-30')).toBe('bytes=20-30');
 expect(() => driveRange('bytes=30-20')).toThrow();
});
it('parses only a confirmation form whose target is approved', () => {
 expect(confirmationUrl('<form id="download-form" action="https://drive.usercontent.google.com/download"><input name="id" value="file"></form>')?.searchParams.get('id')).toBe('file');
 expect(() => confirmationUrl('<form id="download-form" action="https://localhost/private"></form>')).toThrow();
});
it('follows Drive confirmation and streams partial content without buffering the movie', async () => {
 const fetch = vi.fn().mockResolvedValueOnce(new Response('<form id="download-form" action="https://drive.usercontent.google.com/download"><input name="id" value="file"></form>', { headers: { 'content-type': 'text/html' } }))
 .mockResolvedValueOnce(new Response('film', { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/100', 'content-length': '4' } }));
 vi.stubGlobal('fetch', fetch); const response = new ResponseMock();
 await proxy({ method: 'GET', query: { url: 'https://drive.usercontent.google.com/download?id=file' }, headers: { range: 'bytes=0-3' } }, response);
 expect(response.code).toBe(206); expect(Buffer.concat(response.chunks).toString()).toBe('film');
 expect(response.headers.get('content-range')).toBe('bytes 0-3/100');
 expect(fetch).toHaveBeenCalledTimes(2);
});
it('blocks a redirect to a private host before fetching it', async () => {
 const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }));
 vi.stubGlobal('fetch', fetch); const response = new ResponseMock();
 await proxy({ method: 'GET', query: { url: 'https://drive.google.com/uc?id=file' }, headers: {} }, response);
 expect(fetch).toHaveBeenCalledTimes(1); expect(response.code).toBe(502);
});
