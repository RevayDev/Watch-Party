import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { AMBIENT_QUOTES, pickAmbientQuotes } from '../../player/interstellar';

// Re-export para tests y compatibilidad: el array canónico vive en interstellar.ts.
export { AMBIENT_QUOTES };

const AUDIO_SRC = '/audio/ambient-intro.mp3';
const INTRO_BG_SRC = '/interstellar-background.png';
const PEAK_VOLUME = 0.22;
/** Si los metadatos del audio no llegan, la secuencia dura esto (3 frases). */
const FALLBACK_TOTAL_MS = 10000;
/** Si `play()` no se resuelve ni falla (se cuelga), se pide un toque. */
const PLAY_TIMEOUT_MS = 2500;
/** Espera máxima a los metadatos antes de arrancar con la duración estimada. */
const META_WAIT_MS = 3000;
const TICK_MS = 100;

function pickQuotes(): [string, string, string] {
  return pickAmbientQuotes();
}

/**
 * Intenta reproducir el audio tolerando entornos donde `play()` no existe,
 * devuelve `undefined` o lanza de forma síncrona (p. ej. jsdom).
 */
function tryPlay(audio: HTMLAudioElement): Promise<void> {
  try {
    return Promise.resolve(audio.play());
  } catch {
    return Promise.reject(new Error('reproducción no disponible'));
  }
}

function delayReject(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error('timeout de reproducción')), ms);
  });
}

interface AmbientIntroProps {
  /** `skipped` = true si el usuario la omitió (para avisar a la sala). */
  onDone: (skipped: boolean) => void;
  /** Frases compartidas por la sala (trigger del combo). Sin prop: al azar. */
  quotes?: [string, string, string];
}

/**
 * Secuencia cinematográfica: fondo + audio con fade in/out y 3 frases
 * repartidas según la duración real del audio. La monta el padre con una
 * `key` única por disparo (combo Interestellar); nunca se re-dispara por
 * re-renders ni reconexiones de socket. Omitible en todo momento.
 * El texto aparece enseguida, con o sin audio (si el autoplay falla, las
 * frases siguen igual y el audio simplemente no suena).
 */
export const AmbientIntro: React.FC<AmbientIntroProps> = ({ onDone, quotes: sharedQuotes }) => {
  const [randomQuotes] = useState<[string, string, string]>(pickQuotes);
  const quotes = sharedQuotes ?? randomQuotes;
  const [quoteIndex, setQuoteIndex] = useState(0);
  // El texto aparece al instante (fundido corto fijo) y se oculta 1.2 s
  // antes de cada cambio: no depende de la duración del fundido del slot.
  const [quoteShown, setQuoteShown] = useState(true);
  const [finished, setFinished] = useState(false);
  const [bgLoaded, setBgLoaded] = useState(false);
  // Omitir oculta la capa AL INSTANTE sin esperar al padre (el aviso igual
  // se emite para cerrar en todos). Sin esto, si la cadena padre fallara,
  // el botón parecería no funcionar.
  const [skipped, setSkipped] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const totalUsedRef = useRef<number | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const audio = new Audio(AUDIO_SRC);
    audio.preload = 'auto';
    audio.volume = 0;
    audioRef.current = audio;

    const later = (fn: () => void, ms: number) => {
      timersRef.current.push(window.setTimeout(fn, ms));
    };

    const finish = () => {
      setFinished((already) => {
        if (already) return already;
        try {
          audio.pause();
        } catch {
          /* noop */
        }
        audioRef.current = null;
        doneRef.current(false);
        return true;
      });
    };

    // Rampa de volumen hacia `target` y luego continúa con `next`.
    const ramp = (target: number, ms: number, next?: () => void) => {
      const steps = Math.max(1, Math.round(ms / TICK_MS));
      const delta = (target - audio.volume) / steps;
      let left = steps;
      const tick = () => {
        if (left <= 0) {
          audio.volume = Math.min(1, Math.max(0, target));
          next?.();
          return;
        }
        left -= 1;
        audio.volume = Math.min(1, Math.max(0, audio.volume + delta));
        later(tick, TICK_MS);
      };
      tick();
    };

    // Arranca la secuencia repartida en `totalMs`: una frase por tercio,
    // subida el primer 30 %, meseta el 40 % y bajada el último 30 %.
    const begin = (totalMs: number) => {
      const slot = totalMs / 3;
      // Cada frase entra al instante y sale 1.2 s antes del cambio.
      const showQuote = (i: number) => {
        setQuoteIndex(i);
        setQuoteShown(true);
        later(() => setQuoteShown(false), Math.max(400, slot - 1200));
      };
      // Frases: una por vez, sin repetir dentro de la secuencia.
      later(() => showQuote(1), slot);
      later(() => showQuote(2), slot * 2);
      // La primera ya está visible desde el montaje: solo programa su salida.
      later(() => setQuoteShown(false), Math.max(400, slot - 1200));
      // Audio: subida suave, meseta, bajada hasta el silencio.
      ramp(PEAK_VOLUME, totalMs * 0.3, () => {
        later(() => ramp(0, totalMs * 0.3, finish), totalMs * 0.4);
      });
      // Por si el redondeo deja el audio sonando tras el último timer.
      later(finish, totalMs + 2000);
    };

    let begun = false;
    let totalMs: number | null = null;
    const beginOnce = () => {
      if (begun) return;
      begun = true;
      const total = totalMs ?? FALLBACK_TOTAL_MS;
      totalUsedRef.current = total;
      begin(total);
    };

    const onMeta = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 1) totalMs = d * 1000;
    };
    const onEnded = () => finish();
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);

    // Las frases arrancan enseguida, con o sin audio: espera breve a los
    // metadatos para repartirlas según el audio real; si no llegan, con
    // la duración estimada.
    let waited = 0;
    const waitMeta = () => {
      if (begun) return;
      if (totalMs !== null || waited >= META_WAIT_MS) {
        beginOnce();
        return;
      }
      waited += TICK_MS;
      later(waitMeta, TICK_MS);
    };
    waitMeta();

    // El audio se suma cuando puede; si lo bloquean o falla, las frases
    // siguen igual y simplemente no suena.
    let audioStarted = false;
    const maybeStartAudio = () => {
      if (audioStarted) return;
      const total = totalUsedRef.current;
      if (total === null) {
        later(maybeStartAudio, TICK_MS);
        return;
      }
      audioStarted = true;
      ramp(PEAK_VOLUME, total * 0.3, () => {
        later(() => ramp(0, total * 0.3, finish), total * 0.4);
      });
    };
    Promise.race([tryPlay(audio), delayReject(PLAY_TIMEOUT_MS)])
      .then(() => maybeStartAudio())
      .catch(() => {
        /* sin audio: la secuencia visual continúa igual */
      });

    return () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current = [];
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
      try {
        audio.pause();
      } catch {
        /* noop */
      }
      audioRef.current = null;
    };
    // Solo al montar: la secuencia no debe reiniciarse jamás.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSkip = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    try {
      audioRef.current?.pause();
    } catch {
      /* noop */
    }
    audioRef.current = null;
    setSkipped(true);
    onDone(true);
  };

  if (finished || skipped) return null;

  return (
    <div className="ambient-intro" role="dialog" aria-label="Bienvenida a la sala">
      <img
        src={INTRO_BG_SRC}
        alt=""
        aria-hidden="true"
        draggable={false}
        onLoad={() => setBgLoaded(true)}
        className={bgLoaded ? 'ambient-intro__bg ambient-intro__bg--visible' : 'ambient-intro__bg'}
      />
      <div className="ambient-intro__shade" aria-hidden="true" />
      <div className="ambient-intro__stars" aria-hidden="true" />
      <div className="ambient-intro__vignette" aria-hidden="true" />
      <p
        key={quoteIndex}
        className={quoteShown ? 'ambient-intro__quote ambient-intro__quote--visible' : 'ambient-intro__quote'}
      >
        {quotes[quoteIndex]}
      </p>
      <button type="button" className="ambient-intro__skip" onClick={handleSkip}>
        <span>Omitir</span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
};

export default AmbientIntro;
