'use client';

import type { ReactNode } from 'react';

import { Drawer, type DrawerSize } from './Drawer';

export interface FormDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Form title (e.g. "Ajouter un élève") */
  title: string;
  /** Optional sub-description */
  description?: ReactNode;
  /** Submit button label (default "Enregistrer") */
  submitLabel?: string;
  /** Cancel button label (default "Annuler") */
  cancelLabel?: string;
  /** Submit handler (typically a form action wrapped via useFormStatus or onClick) */
  onSubmit?: () => void;
  /** Set true while async submission is running */
  busy?: boolean;
  /** Disable the submit button (validation gate) */
  disabledSubmit?: boolean;
  size?: DrawerSize;
  children: ReactNode;
}

/**
 * FormDrawer — right-side slide-in panel hosting a form (Add / Edit).
 * Composes the generic `Drawer` with a sticky Save/Cancel footer.
 *
 * Caller is responsible for wiring real form elements inside `children`; the
 * drawer just provides the chrome (header + scrollable body + footer buttons).
 */
export function FormDrawer({
  open,
  onClose,
  title,
  description,
  submitLabel = 'Enregistrer',
  cancelLabel = 'Annuler',
  onSubmit,
  busy,
  disabledSubmit,
  size = 'md',
  children,
}: FormDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || disabledSubmit}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? '…' : submitLabel}
          </button>
        </>
      }
    >
      {children}
    </Drawer>
  );
}
