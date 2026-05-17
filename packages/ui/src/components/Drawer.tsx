'use client';

import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

import { cn } from '../lib/cn';

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
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

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
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className={cn(
          'relative ml-auto flex h-full flex-col bg-white shadow-2xl ring-1 ring-black/5',
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
