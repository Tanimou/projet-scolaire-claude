'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { formatGrade } from '../lib/format';
import { gradeBucket } from '../lib/grade-bucket';

export interface GradePillProps {
  /** Numeric value 0..max */
  value: number | null;
  /** Maximum (default 20) */
  max?: number;
  /** Readonly = pill display only ; editable = pill becomes input on click */
  editable?: boolean;
  /** Called when user commits a new value (Enter / blur). */
  onCommit?: (next: number | null) => void;
  /** Absent flag (renders 'ABS' in muted style instead of value) */
  isAbsent?: boolean;
  /** Custom aria label */
  ariaLabel?: string;
  /** Visual size */
  size?: 'sm' | 'md';
  /** Force a specific tone (overrides bucket) */
  tone?: 'excellent' | 'satisfaisant' | 'insuffisant' | 'empty';
  className?: string;
}

const TONE_CLASS = {
  excellent: 'bg-emerald-100 text-emerald-700',
  satisfaisant: 'bg-amber-100 text-amber-700',
  insuffisant: 'bg-rose-100 text-rose-700',
  empty: 'bg-slate-100 text-slate-400',
} as const;

function parseInputValue(raw: string): number | null {
  const cleaned = raw.replace(',', '.').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return n;
}

export function GradePill({
  value,
  max = 20,
  editable,
  onCommit,
  isAbsent,
  ariaLabel,
  size = 'md',
  tone,
  className,
}: GradePillProps) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(value == null ? '' : formatGrade(value, 2).replace('.', ','));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    setRaw(value == null ? '' : formatGrade(value, 2).replace('.', ','));
  }, [value]);

  const info = gradeBucket(value, max);
  const finalTone = tone ?? info.bucket;
  const sizeClass = size === 'sm' ? 'min-w-12 px-2 py-0.5 text-xs' : 'min-w-14 px-2.5 py-1 text-sm';

  function commit() {
    setEditing(false);
    const parsed = parseInputValue(raw);
    // Clamp to [0, max]
    const clamped = parsed == null ? null : Math.min(max, Math.max(0, parsed));
    setRaw(clamped == null ? '' : formatGrade(clamped, 2).replace('.', ','));
    onCommit?.(clamped);
  }

  function cancel() {
    setEditing(false);
    setRaw(value == null ? '' : formatGrade(value, 2).replace('.', ','));
  }

  if (isAbsent) {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full font-bold tabular-nums',
          'bg-slate-100 text-slate-500',
          sizeClass,
          className,
        )}
        aria-label={ariaLabel ?? 'Absent'}
      >
        ABS
      </span>
    );
  }

  if (editable && editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
        }}
        aria-label={ariaLabel ?? 'Saisir la note'}
        className={cn(
          'w-16 rounded-full border-2 border-blue-500 bg-white text-center font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-blue-300',
          sizeClass,
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={!editable}
      onClick={() => editable && setEditing(true)}
      aria-label={ariaLabel ?? (value == null ? 'Saisir la note' : `Note ${formatGrade(value)}`)}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-bold tabular-nums transition',
        TONE_CLASS[finalTone],
        editable && 'cursor-text hover:ring-2 hover:ring-slate-200',
        !editable && 'cursor-default',
        sizeClass,
        className,
      )}
    >
      {value == null ? '—' : formatGrade(value, value % 1 === 0 ? 0 : 1)}
    </button>
  );
}
