import { useCallback, useEffect, useRef, type RefObject } from 'react';

export interface SheetDragOptions {
  /** Sliding panel element. Listeners attach here. */
  panelRef: RefObject<HTMLElement | null>;
  /** Backdrop element whose opacity follows the drag progress. */
  backdropRef?: RefObject<HTMLElement | null>;
  /** Only true for phone sheets that are open and not closing. */
  enabled: boolean;
  /** Fraction of the panel height that triggers dismissal (default 0.32). */
  dismissFraction?: number;
  /** Downward flick velocity (px/ms) that triggers dismissal (default 0.5). */
  dismissVelocity?: number;
  /** Areas inside the panel that always start a drag (default '.sheet__grip'). */
  gripSelector?: string;
  /** Called after the fling-out animation so the owner can close. */
  onDragDismiss: () => void;
}

const DEFAULT_GRIP = '.sheet__grip';
/** Pointer must travel this far before we decide drag vs. scroll/tap. */
const DECISION_PX = 10;
/** Upward pushes get this resistance factor (rubber-band). */
const RUBBER_UP = 0.25;
const MAX_UP_PX = 72;
const FLING_MS = 220;
const SETTLE_MS = 300;

interface Sample {
  y: number;
  t: number;
}

/**
 * Pointer-Events drag-to-dismiss for phone bottom sheets.
 *
 * - Drag starts from grip areas (handle/header) or from content whose
 *   scrollable ancestor is already at the top, so scrolling still works.
 * - Downward drags follow the finger 1:1; upward drags rubber-band.
 * - Release past ~32% of the sheet height (or with a fast downward flick)
 *   flings the sheet out via WAAPI and then calls `onDragDismiss`;
 *   anything else springs back with `var(--sheet-ease)`.
 * - The backdrop fades proportionally to the drag progress.
 * - A click that ends a real drag is swallowed so buttons don't activate.
 */
export function useSheetDrag(options: SheetDragOptions): () => void {
  const optsRef = useRef(options);
  optsRef.current = options;
  const flingsRef = useRef<Animation[]>([]);

  const cancelFling = useCallback(() => {
    flingsRef.current.forEach((anim) => {
      try {
        anim.cancel();
      } catch {
        // Already finished — nothing to cancel.
      }
    });
    flingsRef.current = [];
  }, []);

  useEffect(() => {
    if (!optsRef.current.enabled) return;
    const panel = optsRef.current.panelRef.current;
    if (!panel) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let moved = false;
    let suppressClick = false;
    let samples: Sample[] = [];
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let unsuppressTimer: ReturnType<typeof setTimeout> | null = null;

    const opts = () => optsRef.current;
    const backdrop = () => opts().backdropRef?.current ?? null;

    const isScrollable = (node: HTMLElement): boolean => {
      const oy = window.getComputedStyle(node).overflowY;
      return (
        (oy === 'auto' || oy === 'scroll') &&
        node.scrollHeight > node.clientHeight + 1
      );
    };

    const canStartFrom = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return true;
      if (target.closest(opts().gripSelector ?? DEFAULT_GRIP)) return true;
      let node: HTMLElement | null = target as HTMLElement;
      while (node && node !== panel) {
        if (isScrollable(node)) return node.scrollTop <= 1;
        node = node.parentElement;
      }
      return true;
    };

    const setOffset = (dy: number) => {
      panel.style.transform = dy === 0 ? '' : `translateY(${dy}px)`;
      const bd = backdrop();
      if (bd) {
        if (dy <= 0) {
          bd.style.opacity = '';
        } else {
          const h = Math.max(1, panel.getBoundingClientRect().height);
          bd.style.opacity = String(Math.max(0.1, 1 - dy / (h * 1.2)));
        }
      }
    };

    const clearOffset = () => {
      panel.style.transition = '';
      panel.style.transform = '';
      const bd = backdrop();
      if (bd) {
        bd.style.transition = '';
        bd.style.opacity = '';
      }
    };

    const armClickSuppression = (ms: number) => {
      suppressClick = true;
      if (unsuppressTimer) clearTimeout(unsuppressTimer);
      unsuppressTimer = setTimeout(() => {
        suppressClick = false;
        unsuppressTimer = null;
      }, ms);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!opts().enabled) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (pointerId !== null) return;
      if (!canStartFrom(e.target)) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
      moved = false;
      samples = [{ y: e.clientY, t: performance.now() }];
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dy = e.clientY - startY;
      const dx = e.clientX - startX;
      samples.push({ y: e.clientY, t: performance.now() });
      if (samples.length > 6) samples.shift();
      if (!dragging) {
        if (Math.abs(dy) < DECISION_PX) return;
        // Only mostly-vertical downward gestures hijack the sheet;
        // anything else belongs to scrolling and aborts the attempt.
        if (dy < 0 || Math.abs(dx) > Math.abs(dy) * 1.2) {
          pointerId = null;
          return;
        }
        dragging = true;
        try {
          panel.setPointerCapture(e.pointerId);
        } catch {
          // Capture unsupported — the drag still works without it.
        }
        panel.style.transition = 'none';
      }
      moved = true;
      setOffset(dy < 0 ? Math.max(-MAX_UP_PX, dy * RUBBER_UP) : dy);
    };

    const velocity = (): number => {
      if (samples.length < 2) return 0;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.t - first.t;
      if (dt <= 0) return 0;
      return (last.y - first.y) / dt;
    };

    const finish = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (!dragging) return;
      dragging = false;
      const h = Math.max(1, panel.getBoundingClientRect().height);
      const dy = e.clientY - startY;
      const v = velocity();
      samples = [];
      const {
        dismissFraction = 0.32,
        dismissVelocity = 0.5,
      } = opts();
      if (dy >= h * dismissFraction || (dy > 24 && v > dismissVelocity)) {
        // Fling out with WAAPI so the end state survives the
        // inline-style cleanup and the CSS exit animation.
        armClickSuppression(600);
        panel.style.transition = '';
        panel.style.transform = '';
        const bd = backdrop();
        const anims: Animation[] = [];
        try {
          anims.push(
            panel.animate(
              [
                { transform: `translateY(${Math.max(0, dy)}px)` },
                { transform: 'translateY(110%)' },
              ],
              {
                duration: FLING_MS,
                easing: 'cubic-bezier(0.4, 0, 1, 1)',
                fill: 'forwards',
              },
            ),
          );
          if (bd) {
            anims.push(
              bd.animate(
                [{ opacity: bd.style.opacity || '1' }, { opacity: '0' }],
                { duration: FLING_MS, easing: 'ease-out', fill: 'forwards' },
              ),
            );
          }
        } catch {
          // WAAPI unavailable — fall through to a plain close.
        }
        flingsRef.current = anims;
        window.setTimeout(
          () => opts().onDragDismiss(),
          anims.length > 0 ? FLING_MS : 0,
        );
      } else {
        // Spring back to rest.
        if (moved) armClickSuppression(150);
        panel.style.transition =
          'transform 300ms var(--sheet-ease, cubic-bezier(0.32, 0.72, 0, 1))';
        const bd = backdrop();
        if (bd) bd.style.transition = 'opacity 300ms ease';
        setOffset(0);
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          clearOffset();
          settleTimer = null;
        }, SETTLE_MS + 30);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      // Only after the drag won: stop scroll/overscroll takeover mid-gesture.
      if (dragging && e.cancelable) e.preventDefault();
    };

    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    panel.addEventListener('pointerdown', onPointerDown);
    panel.addEventListener('pointermove', onPointerMove);
    panel.addEventListener('pointerup', finish);
    panel.addEventListener('pointercancel', finish);
    panel.addEventListener('touchmove', onTouchMove, { passive: false });
    panel.addEventListener('click', onClickCapture, true);

    return () => {
      panel.removeEventListener('pointerdown', onPointerDown);
      panel.removeEventListener('pointermove', onPointerMove);
      panel.removeEventListener('pointerup', finish);
      panel.removeEventListener('pointercancel', finish);
      panel.removeEventListener('touchmove', onTouchMove);
      panel.removeEventListener('click', onClickCapture, true);
      if (settleTimer) clearTimeout(settleTimer);
      if (unsuppressTimer) clearTimeout(unsuppressTimer);
      clearOffset();
    };
    // Re-attach whenever the sheet opens/closes; the panel only exists then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enabled]);

  return cancelFling;
}

export default useSheetDrag;
