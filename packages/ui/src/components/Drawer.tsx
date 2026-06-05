'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '../lib/cn';

/** Selector for the tabbable elements a focus trap should cycle between. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl';
const SIZE_CLS: Record<DrawerSize, string> = {
  sm: 'w-full sm:w-[360px]',
  md: 'w-full sm:w-[480px]',
  lg: 'w-full sm:w-[640px]',
  xl: 'w-full sm:w-[800px]',
};

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  /** Optional sticky footer with action buttons */
  footer?: ReactNode;
  /** Drawer width — sm 360 / md 480 / lg 640 / xl 800 */
  size?: DrawerSize;
  /** Hide the close button (caller still must call `onClose`) */
  hideClose?: boolean;
  children: ReactNode;
}

/**
 * Drawer — right-side slide-in panel used by FormDrawer + DetailDrawer.
 * Shares the dialog accessibility primitives (role/aria-modal/Escape/scroll-lock).
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  hideClose,
  children,
}: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  // Remember the element focused before the drawer opened so focus can be
  // restored to the trigger when it closes (WCAG 2.4.3 Focus Order).
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Hold the latest onClose so the keydown handler can call it without making
  // onClose an effect dependency. Consumers routinely pass an inline arrow
  // `onClose` (new identity every render); keying the focus effect on it would
  // re-run capture/move-in/restore on every keystroke and steal focus out of
  // controlled inputs inside the drawer.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // One-shot focus capture, move-in, and restore — keyed on `open` ONLY. The
  // keydown listener (which can change behavior via onCloseRef) is wired in the
  // same effect, but the effect itself must not re-run on unrelated re-renders,
  // or the cleanup/restore would yank focus mid-typing (WCAG 2.4.3 + usability).
  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Move focus into the panel on open (first focusable, else the panel itself).
    const panel = panelRef.current;
    if (panel) {
      const focusables = getFocusable(panel);
      (focusables[0] ?? panel).focus();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // Focus trap: keep Tab / Shift+Tab cycling inside the panel.
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = getFocusable(panelRef.current);
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) {
          // Nothing tabbable yet — keep focus on the panel container.
          e.preventDefault();
          panelRef.current.focus();
          return;
        }
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !panelRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !panelRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      // Restore focus to the trigger that opened the drawer.
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      {/* Panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        className={cn(
          'relative ml-auto flex h-full flex-col bg-white shadow-2xl ring-1 ring-black/5',
          // tabIndex=-1 is a focus fallback for an empty/initial trap target;
          // suppress its outline so the container focus is invisible (real
          // controls keep their own focus-visible rings).
          'focus:outline-none',
          SIZE_CLS[size],
        )}
      >
        {(title || description || !hideClose) && (
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id="drawer-title" className="text-base font-bold text-slate-900">
                  {title}
                </h2>
              )}
              {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
            </div>
            {!hideClose && (
              <button
                type="button"
                aria-label="Fermer"
                onClick={onClose}
                className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}
