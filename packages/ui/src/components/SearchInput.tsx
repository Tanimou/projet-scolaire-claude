'use client';

import { Search, X } from 'lucide-react';
import { forwardRef, useState, type InputHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type' | 'size'> {
  placeholder?: string;
  /** Controlled value (optional) */
  value?: string;
  /** onChange handler — fires on every keystroke */
  onChange?: (next: string) => void;
  /** Visual size */
  size?: 'sm' | 'md';
  /** Set true to disable the clear button */
  noClear?: boolean;
  className?: string;
}

/**
 * SearchInput — image-prescriptive search field with leading magnifier + trailing clear.
 * Works in both controlled and uncontrolled modes.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { placeholder = 'Rechercher…', value, onChange, size = 'md', noClear, className, ...rest },
  ref,
) {
  const [internal, setInternal] = useState(value ?? '');
  const current = value ?? internal;
  const setValue = (next: string) => {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  };

  return (
    <div className={cn('relative w-full', className)}>
      <Search
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400',
          size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4',
        )}
      />
      <input
        ref={ref}
        type="search"
        value={current}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        // Edge / Word Online inject `data-ms-editor="true"` + flip `spellcheck`
        // on inputs before React hydrates → suppressed here. Functional impact: none.
        suppressHydrationWarning
        className={cn(
          'block w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 transition focus-visible:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30',
          size === 'sm' ? 'h-8 text-xs' : 'h-10',
        )}
        {...rest}
      />
      {!noClear && current && (
        <button
          type="button"
          aria-label="Effacer la recherche"
          onClick={() => setValue('')}
          className={cn(
            'absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700',
          )}
        >
          <X className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </button>
      )}
    </div>
  );
});
