import { useCallback, useState } from 'react';
import { STORAGE_KEYS } from '../../../shared/constants';

/**
 * Estilo personal de la barra inferior (por usuario, solo local).
 * A diferencia de los ajustes de sala (servidor, solo leader), esto nunca
 * se emite: cada quien ve su barra como prefiere (etiquetas sí/no,
 * distribuida en PC o píldora centrada).
 */
export type BarLayout = 'spread' | 'centered';
export type BarShape = 'square' | 'rounded';
function readShape(): BarShape {
  try { return localStorage.getItem(STORAGE_KEYS.BAR_SHAPE) === 'rounded' ? 'rounded' : 'square'; }
  catch { return 'square'; }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function readLayout(): BarLayout {
  try {
    return localStorage.getItem(STORAGE_KEYS.BAR_LAYOUT) === 'centered'
      ? 'centered'
      : 'spread';
  } catch {
    return 'spread';
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* almacenamiento no disponible: la preferencia vive solo la sesión */
  }
}

export function useBarPrefs() {
  const [showLabels, setShowLabelsState] = useState<boolean>(() =>
    readBool(STORAGE_KEYS.BAR_LABELS, true)
  );
  const [layout, setLayoutState] = useState<BarLayout>(readLayout);
  const [shape, setShapeState] = useState<BarShape>(readShape);
  const setShape = useCallback((value: BarShape) => {
    setShapeState(value); write(STORAGE_KEYS.BAR_SHAPE, value);
  }, []);

  const setShowLabels = useCallback((value: boolean) => {
    setShowLabelsState(value);
    write(STORAGE_KEYS.BAR_LABELS, value ? '1' : '0');
  }, []);

  const setLayout = useCallback((value: BarLayout) => {
    setLayoutState(value);
    write(STORAGE_KEYS.BAR_LAYOUT, value);
  }, []);

  return { showLabels, layout, shape, setShape, setShowLabels, setLayout };
}

export type BarPrefs = ReturnType<typeof useBarPrefs>;
