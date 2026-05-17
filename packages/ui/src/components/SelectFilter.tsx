'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** Optional secondary description shown under the label */
  hint?: string;
  /** Disable this option */
  disabled?: boolean;
}

export interface SelectFilterProps {
  /** Field label rendered above the trigger (optional) */
  label?: string;
  /** Placeholder shown when no value is selected */
  placeholder?: string;
  /** Available options */
  options: SelectOption[];
  /** Currently selected value */
  value?: string;
  /** Called when the user picks an option */
  onChange?: (next: string) => void;
  /** Allow clearing the selection (adds an "Aucun" first item) */
  clearable?: boolean;
  /** Pre-defined clear label */
  clearLabel?: string;
  /** Visual size */
  size?: 'sm' | 'md';
  /** Disable the dropdown */
  disabled?: boolean;
  /** Full-width trigger (default true) */
  fullWidth?: boolean;
  className?: string;
}

/**
 * SelectFilter — custom dropdown matching the admin filter bar style.
 * Used in pages like Élèves / Classes / Enseignants for filter selects.
 */
export function SelectFilter({
  label,
  placeholder = 'Sélectionner…',
  options,
  value,
  onChange,
  clearable,
  clearLabel = 'Tous',
  size = 'md',
  disabled,
  fullWidth = true,
  className,
}: SelectFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

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

  function pick(v: string) {
    onChange?.(v);
    setOpen(false);
  }

  return (
    <div ref={ref} className={cn('relative', fullWidth && 'w-full', className)}>
      {label && (
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {label}
        </div>
      )}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left font-medium text-slate-700 transition hover:border-slate-300 focus-visible:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30 disabled:cursor-not-allowed disabled:opacity-50',
          size === 'sm' ? 'h-8 text-xs' : 'h-10 text-sm',
        )}
      >
        <span className={cn('truncate', !selected && 'text-slate-400')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={label ?? placeholder}
          className="absolute left-0 right-0 z-40 mt-1 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          {clearable && (
            <li
              role="option"
              aria-selected={!value}
              tabIndex={0}
              onClick={() => pick('')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') pick('');
              }}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm transition',
                !value ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              <span>{clearLabel}</span>
              {!value && <Check className="h-4 w-4" />}
            </li>
          )}
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={active}
                aria-disabled={o.disabled || undefined}
                tabIndex={o.disabled ? -1 : 0}
                onClick={() => !o.disabled && pick(o.value)}
                onKeyDown={(e) => {
                  if (!o.disabled && (e.key === 'Enter' || e.key === ' ')) pick(o.value);
                }}
                className={cn(
                  'flex items-center justify-between gap-2 px-3 py-2 text-sm transition',
                  o.disabled
                    ? 'cursor-not-allowed text-slate-300'
                    : active
                      ? 'cursor-pointer bg-blue-50 text-blue-700'
                      : 'cursor-pointer text-slate-700 hover:bg-slate-50',
                )}
              >
                <div className="min-w-0">
                  <div className="truncate">{o.label}</div>
                  {o.hint && <div className="truncate text-[11px] text-slate-500">{o.hint}</div>}
                </div>
                {active && <Check className="h-4 w-4 shrink-0" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
