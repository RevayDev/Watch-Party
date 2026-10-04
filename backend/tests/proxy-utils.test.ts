import { describe, it, expect } from 'vitest';
import {
  extractDriveDownloadUrl,
  toDriveExplicitRange,
  handleProxyError,
} from '../src/services/proxy.service.js';

describe('extractDriveDownloadUrl', () => {
  it('null si el HTML no es la página de confirmación (sin download-form)', () => {
    expect(extractDriveDownloadUrl('<html><body>video bytes</body></html>')).toBeNull();
  });

  it('null si el form no tiene action', () => {
    const html = '<form id="download-form" method="get"><input name="confirm" value="t"></form>';
    expect(extractDriveDownloadUrl(html)).toBeNull();
  });

  it('extrae la URL real con los inputs ocultos del form', () => {
    const html = [
      '<html><body>',
      '<form id="download-form" action="https://drive.usercontent.google.com/download?id=ABC&amp;export=download">',
      '<input type="hidden" name="confirm" value="t123">',
      '<input type="hidden" name="uuid" value="u456">',
      '</form></body></html>',
    ].join('');
    const url = extractDriveDownloadUrl(html);
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get('confirm')).toBe('t123');
    expect(parsed.searchParams.get('uuid')).toBe('u456');
    expect(parsed.searchParams.get('id')).toBe('ABC');
  });

  it('null con string vacío', () => {
    expect(extractDriveDownloadUrl('')).toBeNull();
  });
});

describe('toDriveExplicitRange', () => {
  const CHUNK = 4 * 1024 * 1024;

  it('sin Range del cliente → primer chunk explícito', () => {
    expect(toDriveExplicitRange(null, CHUNK)).toBe(`bytes=0-${CHUNK - 1}`);
  });

  it('rango abierto "bytes=0-" se expande a un chunk fijo', () => {
    expect(toDriveExplicitRange('bytes=0-', CHUNK)).toBe(`bytes=0-${CHUNK - 1}`);
  });

  it('rango abierto con offset se expande desde ese offset', () => {
    expect(toDriveExplicitRange('bytes=1000-', CHUNK)).toBe(`bytes=1000-${1000 + CHUNK - 1}`);
  });

  it('rango cerrado se reenvía intacto', () => {
    expect(toDriveExplicitRange('bytes=0-1023', CHUNK)).toBe('bytes=0-1023');
  });

  it('Range malformado se reenvía intacto (no se rompe)', () => {
    expect(toDriveExplicitRange('items=0-10', CHUNK)).toBe('items=0-10');
  });
});

describe('handleProxyError', () => {
  it('responde status + { error } y añade details solo si hay', () => {
    const calls: Array<{ status: number; body: unknown }> = [];
    const res: any = {
      status: (s: number) => ({ json: (b: unknown) => { calls.push({ status: s, body: b }); } }),
    };
    handleProxyError(res, 502, 'No se pudo obtener el video externo');
    expect(calls).toEqual([{ status: 502, body: { error: 'No se pudo obtener el video externo' } }]);

    handleProxyError(res, 504, 'Timeout', 'upstream lento');
    expect(calls[1]).toEqual({
      status: 504,
      body: { error: 'Timeout', details: 'upstream lento' },
    });
  });
});
