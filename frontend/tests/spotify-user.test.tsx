// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clearOwnSpotify,
  codeChallenge,
  finishSelfOAuth,
  generateCodeVerifier,
  getOwnClientId,
  getSelfStatus,
  getValidSelfToken,
  openOAuthTab,
  readSelfReturn,
  searchSelfTracks,
  setOwnClientId,
  startSelfOAuth,
} from '../src/features/room/components/spotifyUser';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => handler(url, init))
  );
}

const TOKEN_OK = {
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
};

describe('spotifyUser (vinculación propia, sin .env)', () => {
  it('generateCodeVerifier es único y base64url', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });

  it('codeChallenge coincide con el vector RFC 7636', async () => {
    await expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });

  it('readSelfReturn parsea code+state y rechaza lo demás', () => {
    expect(readSelfReturn('?room=X&spotify=self&code=C&state=S')).toEqual({ code: 'C', state: 'S' });
    expect(readSelfReturn('?room=X&spotify=connected')).toBeNull();
    expect(readSelfReturn('?room=X')).toBeNull();
    expect(readSelfReturn('')).toBeNull();
  });

  it('startSelfOAuth guarda verifier+state y devuelve URL con PKCE', async () => {
    setOwnClientId('mi-client-id');
    const { authUrl } = await startSelfOAuth('mi-client-id', 'ABC123');
    const u = new URL(authUrl);
    expect(u.hostname).toBe('accounts.spotify.com');
    expect(u.searchParams.get('client_id')).toBe('mi-client-id');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBeTruthy();
    expect(u.searchParams.get('state')).toBeTruthy();
  });

  it('finishSelfOAuth canjea el código y guarda tokens (sin secreto)', async () => {
    setOwnClientId('mi-client-id');
    await startSelfOAuth('mi-client-id', 'ABC123');
    const saved = JSON.parse(localStorage.getItem('wp_spotify_self_state') as string);
    stubFetch((url) => {
      if (String(url).includes('/api/token')) return TOKEN_OK;
      throw new Error('unexpected ' + url);
    });
    const search = `?room=ABC123&spotify=self&code=CODE&state=${encodeURIComponent(saved.state)}`;
    await expect(finishSelfOAuth(search)).resolves.toBe(true);
    expect(getOwnClientId()).toBe('mi-client-id');
    await expect(getValidSelfToken()).resolves.toBe('AT');
  });

  it('finishSelfOAuth rechaza state distinto (CSRF)', async () => {
    setOwnClientId('mi-client-id');
    await startSelfOAuth('mi-client-id', 'ABC123');
    stubFetch(() => TOKEN_OK);
    await expect(
      finishSelfOAuth('?room=ABC123&spotify=self&code=CODE&state=otro')
    ).resolves.toBe(false);
  });

  it('getValidSelfToken renueva con el refresh si venció', async () => {
    setOwnClientId('mi-client-id');
    localStorage.setItem(
      'wp_spotify_self_token',
      JSON.stringify({ accessToken: 'VIEJO', refreshToken: 'RT', expiresAt: Date.now() - 1000 })
    );
    stubFetch((url) => {
      if (String(url).includes('/api/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'NUEVO', expires_in: 3600 }),
        };
      }
      throw new Error('unexpected');
    });
    await expect(getValidSelfToken()).resolves.toBe('NUEVO');
  });

  it('getSelfStatus dice conectado + cuenta vía /v1/me', async () => {
    setOwnClientId('mi-client-id');
    localStorage.setItem(
      'wp_spotify_self_token',
      JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3600000 })
    );
    stubFetch((url) => {
      if (String(url).includes('/v1/me')) {
        return { ok: true, status: 200, json: async () => ({ display_name: 'Yo Mismo' }) };
      }
      throw new Error('unexpected ' + url);
    });
    await expect(getSelfStatus()).resolves.toEqual({ connected: true, accountName: 'Yo Mismo' });
  });

  it('searchSelfTracks mapea pistas', async () => {
    setOwnClientId('mi-client-id');
    localStorage.setItem(
      'wp_spotify_self_token',
      JSON.stringify({ accessToken: 'AT', refreshToken: null, expiresAt: Date.now() + 3600000 })
    );
    stubFetch((url) => {
      if (String(url).includes('/v1/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tracks: {
              items: [
                {
                  id: 'abc12345',
                  name: 'Tema',
                  artists: [{ name: 'Artista' }],
                  album: { images: [{ url: 'http://img/x.jpg' }] },
                  duration_ms: 200000,
                  uri: 'spotify:track:abc12345',
                  external_urls: { spotify: 'https://open.spotify.com/track/abc12345' },
                },
              ],
            },
          }),
        };
      }
      throw new Error('unexpected ' + url);
    });
    const tracks = await searchSelfTracks('tema');
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ id: 'abc12345', name: 'Tema', artists: 'Artista' });
  });

  it('clearOwnSpotify borra clientId y tokens', async () => {
    setOwnClientId('x');
    localStorage.setItem('wp_spotify_self_token', JSON.stringify({ accessToken: 'AT' }));
    clearOwnSpotify();
    expect(getOwnClientId()).toBeNull();
    await expect(getValidSelfToken()).resolves.toBeNull();
  });

  it('openOAuthTab abre en blanco y navega al llegar la URL', async () => {
    const location = { href: '' };
    const win = { closed: false, location, close: vi.fn(), document: { title: '', body: { innerHTML: '' } } };
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => win as unknown as Window);
    await expect(openOAuthTab(async () => 'https://accounts.spotify.com/authorize?x=1')).resolves.toBe(
      true
    );
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank', 'noopener,noreferrer');
    expect(location.href).toBe('https://accounts.spotify.com/authorize?x=1');
    expect(win.close).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('openOAuthTab cierra la pestaña si falla (sin dejarla en blanco)', async () => {
    const win = { closed: false, location: { href: '' }, close: vi.fn(), document: { title: '', body: { innerHTML: '' } } };
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => win as unknown as Window);
    await expect(openOAuthTab(async () => {
      throw new Error('503');
    })).resolves.toBe(false);
    expect(win.close).toHaveBeenCalledTimes(1);
    openSpy.mockRestore();
  });

  it('openOAuthTab escribe el motivo si no puede cerrarla', async () => {
    const doc = { title: '', body: { innerHTML: '' } };
    const win = {
      closed: false,
      location: { href: '' },
      close: vi.fn(() => {
        throw new Error('denied');
      }),
      document: doc,
    };
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => win as unknown as Window);
    await expect(openOAuthTab(async () => {
      throw new Error('503');
    })).resolves.toBe(false);
    expect(doc.body.innerHTML).toContain('Cierra esta pestaña');
    openSpy.mockRestore();
  });
});
