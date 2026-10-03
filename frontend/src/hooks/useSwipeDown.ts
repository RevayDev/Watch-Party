import { useEffect, useRef, type RefObject } from 'react';

/**
 * Swipe-down-to-dismiss for phone bottom sheets and popovers (touch only, desktop mouse is ignored).
 *
 * Attach the returned ref to the sheet element. The gesture only starts when the
 * content inside is scrolled to the top (or there is nothing scrollable), so normal
 * scrolling still works. A deliberate 64 px downward drag closes the sheet.
 *
 * Nested popups (rename dialog inside the participant sheet inside the drawer)
 * share one gesture owner, so a drag always closes only the innermost one.
 */
let gestureOwner: symbol | null = null;

export function useSwipeDown<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  enabled = true
): RefObject<T> {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    const owner = Symbol('swipe-down');
    let startY = 0;
    let dy = 0;
    let active = false;

    const isScrollable = (node: HTMLElement): boolean => {
      const oy = window.getComputedStyle(node).overflowY;
      return (oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1;
    };

    const findScrollable = (target: EventTarget | null): HTMLElement | null => {
      let node: HTMLElement | null =
        target instanceof Element ? target as HTMLElement : null;
      while (node && node !== el) {
        if (isScrollable(node)) return node;
        node = node.parentElement;
      }
      return isScrollable(el) ? el : null;
    };

    const releaseGesture = () => {
      if (gestureOwner === owner) gestureOwner = null;
    };

    const onStart = (e: TouchEvent) => {
      // An inner popup already claimed this touch: only that one may close.
      if (gestureOwner && gestureOwner !== owner) {
        active = false;
        return;
      }
      const scrollEl = findScrollable(e.target);
      if (scrollEl && scrollEl.scrollTop > 0) {
        active = false;
        return;
      }
      active = true;
      gestureOwner = owner;
      startY = e.touches[0].clientY;
      dy = 0;
      // The CSS entry animation owns `transform` while it runs — disable it for the drag
      el.style.animation = 'none';
      el.style.transition = 'none';
      el.style.transform = '';
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        active = false;
        el.style.transform = '';
        el.style.animation = '';
        el.style.transition = '';
        return;
      }
      el.style.transform = `translateY(${dy}px)`;
      if (e.cancelable) e.preventDefault();
    };

    const onEnd = () => {
      releaseGesture();
      if (!active) return;
      active = false;
      const travelled = dy;
      dy = 0;
      if (travelled === 0) {
        // A plain tap: release the overrides so a later close can still animate
        el.style.animation = '';
        el.style.transition = '';
        return;
      }
      el.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
      el.style.transform = '';
      if (travelled > 64) {
        // Release the inline overrides so the CSS exit animation can play
        el.style.animation = '';
        el.style.transition = '';
        onCloseRef.current();
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      releaseGesture();
      el.style.animation = '';
      el.style.transition = '';
      el.style.transform = '';
    };
  }, [enabled]);

  return ref;
}
