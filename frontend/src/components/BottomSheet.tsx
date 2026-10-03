import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useSheetDrag } from '../hooks/useSheetDrag';

export type SheetHeight = 'auto' | 'half' | 'full' | number;

export interface BottomSheetProps {
  /** Controls visibility. The sheet owns enter/exit animations internally. */
  open: boolean;
  /** Called for every dismissal: backdrop tap, Esc, handle tap, drag fling. */
  onClose: () => void;
  children: React.ReactNode;
  /** Optional header row (also a drag grip). Omit for custom headers. */
  title?: React.ReactNode;
  /** Sheet height: content-driven, 50dvh, 100dvh, or a number in dvh. */
  height?: SheetHeight;
  /** Show the phone drag handle (hidden on desktop via CSS). Default true. */
  showHandle?: boolean;
  /** Tap on the backdrop closes the sheet. Default true. */
  closeOnBackdrop?: boolean;
  footer?: React.ReactNode;
  /** Extra classes for the panel (content hooks like `timeline-modal`). */
  className?: string;
  /**
   * 'modal': bottom sheet on phones, centered modal on desktop (portaled).
   * 'inline': bottom sheet on phones, rendered in place with
   * `desktopClassName` on desktop (drawer/popover-style UIs).
   */
  variant?: 'modal' | 'inline';
  /** Wrapper class for desktop `inline` rendering (e.g. `meet-drawer`). */
  desktopClassName?: string;
  role?: 'dialog' | 'alertdialog';
  /** Accessible name. Falls back to the title text or a generic label. */
  label?: string;
  /** Portal root stacking level. Default 1000 (DOM order wins ties). */
  zIndex?: number;
}

const EXIT_MS = 300;
const FAST_EXIT_MS = 140;
const PHONE_QUERY = '(max-width: 768px)';

interface StackEntry {
  id: number;
  close: () => void;
}

/** Open sheets, bottom = oldest. Only the topmost reacts to Esc. */
let sheetStack: StackEntry[] = [];
let sheetSeq = 0;

/** Balanced body scroll lock (StrictMode-safe: lock/unlock always pair up). */
let scrollLocks = 0;
let scrollPrevOverflow = '';

function lockBodyScroll() {
  scrollLocks += 1;
  if (scrollLocks === 1) {
    scrollPrevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}

function unlockBodyScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = scrollPrevOverflow;
}

function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia(PHONE_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = () => setIsPhone(mq.matches);
    mq.addEventListener('change', onChange);
    setIsPhone(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isPhone;
}

function focusablesIn(root: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), ' +
    '[tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

/**
 * Global bottom sheet: portal, Pointer-Events drag (phones), focus trap +
 * focus restore, top-most-only Esc, body scroll lock, safe-area padding.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  children,
  title,
  height = 'auto',
  showHandle = true,
  closeOnBackdrop = true,
  footer,
  className = '',
  variant = 'modal',
  desktopClassName = '',
  role = 'dialog',
  label,
  zIndex = 1000,
}) => {
  const isPhone = useIsPhone();
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  /** True when a drag fling already animated the exit (skip CSS exit). */
  const [noExit, setNoExit] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const noExitRef = useRef(false);
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = ++sheetSeq;
  const titleId = useId();

  const isModal = variant === 'modal' || isPhone;
  const usePortal = variant === 'modal' || isPhone;

  const cancelFling = useSheetDrag({
    panelRef,
    backdropRef,
    enabled: isPhone && mounted && open && !closing,
    onDragDismiss: useCallback(() => {
      noExitRef.current = true;
      setNoExit(true);
      onCloseRef.current();
    }, []),
  });

  // ── Presence: mount on open, play the exit, then unmount ──
  useEffect(() => {
    if (open) {
      cancelFling();
      noExitRef.current = false;
      setNoExit(false);
      setClosing(false);
      setMounted(true);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = window.setTimeout(
      () => {
        setMounted(false);
        setClosing(false);
      },
      noExitRef.current ? FAST_EXIT_MS : EXIT_MS,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  // ── Sheet stack: only the topmost sheet answers Esc ──
  useEffect(() => {
    if (!mounted) return;
    const entry: StackEntry = {
      id: idRef.current,
      close: () => onCloseRef.current(),
    };
    sheetStack.push(entry);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const top = sheetStack[sheetStack.length - 1];
      if (top && top.id === entry.id) {
        e.stopPropagation();
        entry.close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      sheetStack = sheetStack.filter((s) => s.id !== entry.id);
    };
  }, [mounted]);

  // ── Modal behavior: scroll lock, initial focus, Tab trap, focus restore ──
  useEffect(() => {
    if (!mounted || !isModal) return;
    const panel = panelRef.current;
    if (!panel) return;
    lockBodyScroll();
    const prevActive = document.activeElement as HTMLElement | null;
    const explicit = panel.querySelector<HTMLElement>(
      '[data-autofocus], [autofocus]',
    );
    const first = focusablesIn(panel)[0];
    (explicit ?? first ?? panel).focus({ preventScroll: true });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusablesIn(panel);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    panel.addEventListener('keydown', onKeyDown);
    return () => {
      panel.removeEventListener('keydown', onKeyDown);
      unlockBodyScroll();
      if (prevActive && typeof prevActive.focus === 'function') {
        prevActive.focus({ preventScroll: true });
      }
    };
  }, [mounted, isModal]);

  if (!mounted) return null;

  const labelledBy =
    !label && (typeof title === 'string' || typeof title === 'number')
      ? titleId
      : undefined;

  // ── Desktop `inline`: render in place, exit via `<first-token>--closing` ──
  if (!usePortal) {
    const firstToken = desktopClassName.split(' ').filter(Boolean)[0] ?? '';
    return (
      <div
        className={`${desktopClassName}${closing && firstToken ? ` ${firstToken}--closing` : ''}`}
      >
        {children}
      </div>
    );
  }

  // ── Portal sheet (phones always, desktop modals) ──
  const heightKey =
    height === 'half' ? 'half' : height === 'full' ? 'full' : 'auto';
  const heightStyle: React.CSSProperties =
    typeof height === 'number'
      ? { height: `${height}dvh` }
      : height === 'half'
        ? { height: '50dvh' }
        : height === 'full'
          ? { height: '100dvh' }
          : {};
  const showExit = closing && !noExit;

  return createPortal(
    <div className="sheet-root" style={{ zIndex }}>
      <div
        ref={backdropRef}
        className={`sheet__backdrop${showExit ? ' sheet__backdrop--closing' : ''}`}
        onClick={() => {
          if (closeOnBackdrop) onCloseRef.current();
        }}
      />
      <div className="sheet__dock">
        <div
          ref={panelRef}
          role={role}
          aria-modal={isModal}
          aria-label={label ?? (labelledBy ? undefined : 'Cuadro de diálogo')}
          aria-labelledby={labelledBy}
          tabIndex={-1}
          className={`sheet sheet--${heightKey} ${className}${showExit ? ' sheet--closing' : ''}`.trim()}
          style={heightStyle}
        >
          {showHandle && (
            <button
              type="button"
              className="sheet-handle sheet__grip"
              onClick={() => onCloseRef.current()}
              aria-label="Cerrar"
              title="Cerrar"
            />
          )}
          {title !== undefined && (
            <div className="sheet__grip sheet__header">
              <h2 id={titleId} className="sheet__title">
                {title}
              </h2>
            </div>
          )}
          <div className="sheet__body">{children}</div>
          {footer !== undefined && (
            <div className="sheet__footer">{footer}</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BottomSheet;
