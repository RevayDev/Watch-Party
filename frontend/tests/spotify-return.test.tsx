// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { stripSpotifyReturnParams } from '../src/shared/utils';

/** Limpieza de la URL tras el retorno OAuth (conserva la sala). */
describe('stripSpotifyReturnParams', () => {
  it('quita spotify y reason conservando room', () => {
    window.history.replaceState({}, '', '/?room=ABC123&spotify=connected');
    stripSpotifyReturnParams();
    expect(window.location.search).toBe('?room=ABC123');
    window.history.replaceState({}, '', '/');
  });

  it('quita el error conservando room', () => {
    window.history.replaceState({}, '', '/?room=ABC123&spotify=error&reason=cancelled');
    stripSpotifyReturnParams();
    expect(window.location.search).toBe('?room=ABC123');
    window.history.replaceState({}, '', '/');
  });

  it('no toca URLs sin retorno', () => {
    window.history.replaceState({}, '', '/?room=ABC123');
    stripSpotifyReturnParams();
    expect(window.location.search).toBe('?room=ABC123');
    window.history.replaceState({}, '', '/');
  });
});
