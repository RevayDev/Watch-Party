// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AmbientIntro, AMBIENT_QUOTES } from '../src/features/room/components/AmbientIntro';

type Listener = () => void;

class MockAudio {
  static mode: 'ok' | 'fail' | 'hang' = 'ok';
  static durationSec = NaN;
  static instances: MockAudio[] = [];
  volume = 0;
  paused = true;
  preload = '';
  private listeners = new Map<string, Listener[]>();
  constructor() {
    MockAudio.instances.push(this);
  }
  get duration(): number {
    return MockAudio.durationSec;
  }
  addEventListener(ev: string, fn: Listener): void {
    const list = this.listeners.get(ev) ?? [];
    list.push(fn);
    this.listeners.set(ev, list);
  }
  removeEventListener(ev: string, fn: Listener): void {
    const list = this.listeners.get(ev) ?? [];
    this.listeners.set(
      ev,
      list.filter((l) => l !== fn)
    );
  }
  static fire(ev: string): void {
    for (const inst of MockAudio.instances) {
      for (const fn of inst.listeners.get(ev) ?? []) fn();
    }
  }
  async play(): Promise<void> {
    if (MockAudio.mode === 'hang') {
      return new Promise(() => undefined); // no se resuelve jamás
    }
    if (MockAudio.mode === 'fail') {
      throw new DOMException('play() bloqueado', 'NotAllowedError');
    }
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
}

beforeEach(() => {
  MockAudio.mode = 'ok';
  MockAudio.durationSec = NaN;
  MockAudio.instances = [];
  vi.stubGlobal('Audio', MockAudio as unknown as typeof Audio);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Monta y arranca con metadatos de `durationSec` (o sin ellos si es null). */
async function renderStarted(durationSec: number | null) {
  const onDone = vi.fn();
  await act(async () => {
    render(<AmbientIntro onDone={onDone} />);
  });
  if (durationSec !== null) {
    MockAudio.durationSec = durationSec;
    await act(async () => {
      MockAudio.fire('loadedmetadata');
    });
  }
  await act(async () => {
    await Promise.resolve();
  });
  // Deja correr la espera de metadatos para que `begin` ya haya arrancado.
  await act(async () => {
    vi.advanceTimersByTime(150);
  });
  return onDone;
}

const quoteText = () => document.querySelector('.ambient-intro__quote')?.textContent ?? '';

describe('AmbientIntro', () => {
  it('la colección tiene exactamente 10 frases no vacías', () => {
    expect(AMBIENT_QUOTES).toHaveLength(10);
    for (const q of AMBIENT_QUOTES) {
      expect(typeof q).toBe('string');
      expect(q.trim().length).toBeGreaterThan(0);
    }
  });

  it('omite la secuencia y limpia el audio', async () => {
    const onDone = vi.fn();
    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = render(<AmbientIntro onDone={onDone} />));
    });
    MockAudio.durationSec = 10;
    await act(async () => {
      MockAudio.fire('loadedmetadata');
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Omitir'));
    });
    // Omitir avisa con skipped=true (la sala lo reenvía a todos).
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(true);
    // …y la capa se oculta AL INSTANTE aunque el padre no desmonte todavía.
    expect(screen.queryByRole('dialog')).toBeNull();
    // Como en Room (el padre desmonta al recibir onDone), no debe quedar
    // ningún timer que vuelva a llamar onDone después del desmontaje.
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('muestra 3 frases distintas, una por vez, y termina sola', async () => {
    const onDone = await renderStarted(10);

    const first = quoteText();
    expect(first.length).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(3400);
    });
    const second = quoteText();
    expect(second.length).toBeGreaterThan(0);
    expect(second).not.toBe(first);

    await act(async () => {
      vi.advanceTimersByTime(3400);
    });
    const third = quoteText();
    expect(third.length).toBeGreaterThan(0);
    expect(third).not.toBe(first);
    expect(third).not.toBe(second);

    // Nunca hay dos frases a la vez.
    expect(document.querySelectorAll('.ambient-intro__quote')).toHaveLength(1);

    // Al terminar llama onDone una sola vez, con skipped=false.
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('reparte las frases según la duración real del audio', async () => {
    await renderStarted(30);
    const quote = document.querySelector('.ambient-intro__quote') as HTMLElement | null;
    expect(quote).not.toBeNull();
    // La primera entra al instante (un tercio de 30 s por frase).
    expect(quote?.classList.contains('ambient-intro__quote--visible')).toBe(true);

    const first = quoteText();
    // A los 5 s sigue la primera…
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(quoteText()).toBe(first);
    expect(
      document
        .querySelector('.ambient-intro__quote')
        ?.classList.contains('ambient-intro__quote--visible')
    ).toBe(true);
    // …1.2 s antes del cambio (10 s) se oculta, y luego entra la segunda.
    await act(async () => {
      vi.advanceTimersByTime(3900);
    });
    expect(
      document
        .querySelector('.ambient-intro__quote')
        ?.classList.contains('ambient-intro__quote--visible')
    ).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(quoteText()).not.toBe(first);
    expect(
      document
        .querySelector('.ambient-intro__quote')
        ?.classList.contains('ambient-intro__quote--visible')
    ).toBe(true);
  });

  it('sin metadatos arranca con la duración estimada', async () => {
    await renderStarted(null);
    // Espera a metadatos (3 s) y luego reparte 10 s en 3 frases.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    const first = quoteText();
    expect(first.length).toBeGreaterThan(0);
    await act(async () => {
      vi.advanceTimersByTime(3400);
    });
    expect(quoteText()).not.toBe(first);
  });

  it('usa las frases compartidas por la sala cuando se las pasan', async () => {
    const onDone = vi.fn();
    await act(async () => {
      render(<AmbientIntro onDone={onDone} quotes={['AAA', 'BBB', 'CCC']} />);
    });
    MockAudio.durationSec = 10;
    await act(async () => {
      MockAudio.fire('loadedmetadata');
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(quoteText()).toBe('AAA');
    await act(async () => {
      vi.advanceTimersByTime(3400);
    });
    expect(quoteText()).toBe('BBB');
    await act(async () => {
      vi.advanceTimersByTime(3400);
    });
    expect(quoteText()).toBe('CCC');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('sin botón de toque: si el play se cuelga, el texto sale enseguida', async () => {
    MockAudio.mode = 'hang';
    const onDone = vi.fn();
    await act(async () => {
      render(<AmbientIntro onDone={onDone} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Nada de botones: la primera frase ya está visible.
    expect(screen.queryByRole('button', { name: /comenzar/i })).toBeNull();
    expect(quoteText().length).toBeGreaterThan(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('sin botón de toque: con autoplay bloqueado las frases salen igual', async () => {
    MockAudio.mode = 'fail';
    const onDone = vi.fn();
    await act(async () => {
      render(<AmbientIntro onDone={onDone} />);
    });
    MockAudio.durationSec = 10;
    await act(async () => {
      MockAudio.fire('loadedmetadata');
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByRole('button', { name: /comenzar/i })).toBeNull();
    const first = quoteText();
    expect(first.length).toBeGreaterThan(0);
    // Rota y termina sola aunque no haya audio.
    await act(async () => {
      vi.advanceTimersByTime(3400);
    });
    expect(quoteText()).not.toBe(first);
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('al terminar el audio cierra la secuencia', async () => {
    const onDone = await renderStarted(120);
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      MockAudio.fire('ended');
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('desmontar a mitad limpia timers sin llamar onDone de más', async () => {
    const onDone = vi.fn();
    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = render(<AmbientIntro onDone={onDone} />));
    });
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('muestra el fondo interstellar con fundido al cargar', async () => {
    await renderStarted(10);
    const bg = document.querySelector('.ambient-intro__bg') as HTMLImageElement | null;
    expect(bg).not.toBeNull();
    expect(bg?.getAttribute('src')).toBe('/interstellar-background.png');
    // Decorativo: oculto para lectores de pantalla y sin arrastre.
    expect(bg?.getAttribute('aria-hidden')).toBe('true');
    expect(bg?.getAttribute('alt')).toBe('');
    // Antes de cargar no es visible (evita parpadeo); al cargar, fundido.
    expect(bg?.classList.contains('ambient-intro__bg--visible')).toBe(false);
    await act(async () => {
      fireEvent.load(bg as HTMLImageElement);
    });
    expect(bg?.classList.contains('ambient-intro__bg--visible')).toBe(true);
  });
});
