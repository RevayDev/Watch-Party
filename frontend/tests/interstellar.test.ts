import { describe, it, expect } from 'vitest';
import {
  checkInterstellarCombo,
  hasInterstellarPair,
  isInterstellarEmoji,
  INTERSTELLAR_WINDOW_MS,
  AMBIENT_QUOTES,
  pickAmbientQuotes,
  type InterstellarEvent,
} from '../src/features/player/interstellar';

function ev(emoji: string, user: string, at: number): InterstellarEvent {
  return { emoji, user, at };
}

describe('interstellar.ts', () => {
  describe('isInterstellarEmoji', () => {
    it('reconoce 🪐 y ✨', () => {
      expect(isInterstellarEmoji('🪐')).toBe(true);
      expect(isInterstellarEmoji('✨')).toBe(true);
    });
    it('rechaza otros emojis', () => {
      expect(isInterstellarEmoji('🩷')).toBe(false);
      expect(isInterstellarEmoji('❤️')).toBe(false);
      expect(isInterstellarEmoji('')).toBe(false);
    });
  });

  describe('checkInterstellarCombo', () => {
    it('dispara cuando llega 🪐 y existe ✨ de OTRO usuario en ventana', () => {
      const recent = [ev('✨', 'Ana', 1000)];
      const incoming = ev('🪐', 'Beto', 2000);
      expect(checkInterstellarCombo(recent, incoming)).toBe(true);
    });

    it('dispara cuando llega ✨ y existe 🪐 de OTRO usuario en ventana', () => {
      const recent = [ev('🪐', 'Ana', 5000)];
      const incoming = ev('✨', 'Beto', 5000 + INTERSTELLAR_WINDOW_MS);
      expect(checkInterstellarCombo(recent, incoming)).toBe(true);
    });

    it('NO dispara si es el mismo usuario (mismo nombre, distinto case)', () => {
      const recent = [ev('🪐', 'Ana', 1000)];
      const incoming = ev('✨', 'ana', 1500);
      expect(checkInterstellarCombo(recent, incoming)).toBe(false);
    });

    it('NO dispara si la pareja expira la ventana de 5 s', () => {
      const recent = [ev('🪐', 'Ana', 1000)];
      const incoming = ev('✨', 'Beto', 1000 + INTERSTELLAR_WINDOW_MS + 1);
      expect(checkInterstellarCombo(recent, incoming)).toBe(false);
    });

    it('NO dispara si falta el emoji complementario', () => {
      const recent = [ev('🪐', 'Ana', 1000)];
      const incoming = ev('🪐', 'Beto', 1500);
      expect(checkInterstellarCombo(recent, incoming)).toBe(false);
    });

    it('devuelve false si visualEffects está off', () => {
      const recent = [ev('🪐', 'Ana', 1000)];
      const incoming = ev('✨', 'Beto', 1500);
      expect(checkInterstellarCombo(recent, incoming, false)).toBe(false);
    });

    it('rechaza incoming que no es 🪐/✨', () => {
      const recent = [ev('🪐', 'Ana', 1000)];
      const incoming = ev('❤️', 'Beto', 1500);
      expect(checkInterstellarCombo(recent, incoming)).toBe(false);
    });
  });

  describe('hasInterstellarPair', () => {
    it('detecta una pareja válida dentro del historial', () => {
      const events = [
        ev('🪐', 'Ana', 10_000),
        ev('✨', 'Beto', 12_000),
        ev('🩷', 'Carol', 13_000),
      ];
      expect(hasInterstellarPair(events)).toBe(true);
    });

    it('no detecta pareja si es el mismo usuario', () => {
      const events = [ev('🪐', 'Ana', 10_000), ev('✨', 'Ana', 11_000)];
      expect(hasInterstellarPair(events)).toBe(false);
    });

    it('no detecta pareja fuera de ventana', () => {
      const events = [
        ev('🪐', 'Ana', 10_000),
        ev('✨', 'Beto', 10_000 + INTERSTELLAR_WINDOW_MS + 1),
      ];
      expect(hasInterstellarPair(events)).toBe(false);
    });

    it('devuelve false con visualEffects off', () => {
      const events = [ev('🪐', 'Ana', 10_000), ev('✨', 'Beto', 11_000)];
      expect(hasInterstellarPair(events, false)).toBe(false);
    });

    it('exporta las constantes esperadas', () => {
      expect(INTERSTELLAR_WINDOW_MS).toBe(5000);
    });
  });

  describe('frases compartidas de la cinemática', () => {
    it('AMBIENT_QUOTES tiene 10 frases no vacías', () => {
      expect(AMBIENT_QUOTES).toHaveLength(10);
      for (const q of AMBIENT_QUOTES) {
        expect(q.trim().length).toBeGreaterThan(0);
      }
    });

    it('pickAmbientQuotes devuelve 3 distintas del array', () => {
      const picked = pickAmbientQuotes();
      expect(picked).toHaveLength(3);
      for (const q of picked) {
        expect(AMBIENT_QUOTES).toContain(q);
      }
      expect(new Set(picked).size).toBe(3);
    });
  });
});
