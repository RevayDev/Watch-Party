import { useEffect, useRef, type RefObject } from 'react';

/**
 * Swipe-down-to-dismiss for phone bottom sheets (touch only, desktop mouse is ignored).
 *
 * Attach the returned ref to the sheet element. The gesture only starts when the
 * content inside is scrolled to the top (or there is nothing scrollable), so normal
 * scrolling still works. Once the finger travels `threshold` px downwards the sheet
 * is closed via `onClose`.
 */
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

    const onStart = (e: TouchEvent) => {
      const scrollEl = findScrollable(e.target);
      if (scrollEl && scrollEl.scrollTop > 0) {
        active = false;
        return;
      }
      active = true;
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
        return;
      }
      el.style.transform = `translateY(${dy}px)`;
      if (e.cancelable) e.preventDefault();
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      const travelled = dy;
      dy = 0;
      el.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
      el.style.transform = '';
      if (travelled > 100) onCloseRef.current();
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
      el.style.animation = '';
      el.style.transition = '';
      el.style.transform = '';
    };
  }, [enabled]);

  return ref;
}
