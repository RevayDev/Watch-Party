import { useEffect, useRef, useState } from 'react';

interface Presence {
  /** Keep the element mounted (entering or leaving) */
  shown: boolean;
  /** True while the exit animation is playing */
  closing: boolean;
}

/**
 * Keeps a component mounted long enough to play its exit animation.
 *
 * Usage:
 *   const { shown, closing } = usePresence(isOpen);
 *   if (!shown) return null;
 *   return <div className={`overlay ${closing ? 'overlay--closing' : ''}`}>...</div>;
 */
export function usePresence(isOpen: boolean, duration = 250): Presence {
  const [state, setState] = useState<'hidden' | 'shown' | 'closing'>(isOpen ? 'shown' : 'hidden');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (isOpen) {
      setState('shown');
      return;
    }
    setState((prev) => (prev === 'shown' ? 'closing' : prev));
    timerRef.current = setTimeout(() => {
      setState('hidden');
      timerRef.current = null;
    }, duration);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isOpen, duration]);

  return { shown: state !== 'hidden', closing: state === 'closing' };
}

export default usePresence;
