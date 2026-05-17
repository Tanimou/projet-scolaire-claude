'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '../lib/cn';

export interface YearOption {
  id: string;
  name: string;
  status?: 'active' | 'closed' | 'planned' | 'archived';
}

export interface YearSelectorProps {
  options: YearOption[];
  /** Currently selected option id */
  value: string;
  /** Called when user picks another year */
  onChange?: (id: string) => void;
  /** Disable interactivity */
  disabled?: boolean;
  /** Visual size */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * YearSelector — dropdown of academic years for the topbar.
 * Custom-styled (no native <select>) for visual control.
 */
export function YearSelector({
  options,
  value,
  onChange,
  disabled,
  size = 'md',
  className,
}: YearSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    function onClickOut(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOut);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOut);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50',
          size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-3 text-sm',
        )}
      >
        <span>{selected?.name ?? '—'}</span>
        <ChevronDown className={cn('h-4 w-4 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Sélectionner une année scolaire"
          className="absolute right-0 z-40 mt-1 max-h-64 min-w-[180px] overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          {options.map((o) => {
            const active = o.id === value;
            return (
              <li
                key={o.id}
                role="option"
                aria-selected={active}
                tabIndex={0}
                onClick={() => {
                  onChange?.(o.id);
                  setOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onChange?.(o.id);
                    setOpen(false);
                  }
                }}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm transition',
                  active ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span className="flex items-center gap-2">
                  {o.status === 'active' && (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  )}
                  {o.name}
                </span>
                {active && <Check className="h-4 w-4" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
