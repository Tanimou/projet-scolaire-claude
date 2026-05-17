'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface ConfirmDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Close callback (backdrop click, Escape, or Cancel button) */
  onClose: () => void;
  /** Confirm action callback */
  onConfirm: () => void;
  /** Dialog title (h2) */
  title: string;
  /** Body content (description) */
  description?: ReactNode;
  /** Confirm button label (default "Confirmer") */
  confirmLabel?: string;
  /** Cancel button label (default "Annuler") */
  cancelLabel?: string;
  /** Disable confirm button while async action is running */
  busy?: boolean;
  /** Visual tone — `danger` shows red icon and red confirm button */
  tone?: 'default' | 'danger';
}

/**
 * ConfirmDialog — minimal confirmation modal for destructive actions
 * (archive, delete, deactivate, override capacity, etc.)
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  busy,
  tone = 'default',
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    // Focus the confirm button on open (or cancel for danger if we wanted)
    setTimeout(() => confirmRef.current?.focus(), 50);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  const danger = tone === 'danger';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fermer"
        onClick={busy ? undefined : onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          {danger && (
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="text-base font-bold text-slate-900">
              {title}
            </h2>
            {description && <div className="mt-1.5 text-sm text-slate-600">{description}</div>}
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60',
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700',
            )}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
