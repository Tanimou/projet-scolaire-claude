import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export type IconButtonTone =
  | 'neutral'
  | 'blue'
  | 'cyan'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'violet'
  | 'sky';

export type IconButtonSize = 'sm' | 'md';

const TONE_CLS: Record<IconButtonTone, string> = {
  neutral: 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900',
  blue: 'bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700',
  cyan: 'bg-cyan-50 text-cyan-600 hover:bg-cyan-100 hover:text-cyan-700',
  emerald: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700',
  amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100 hover:text-amber-700',
  rose: 'bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700',
  violet: 'bg-violet-50 text-violet-600 hover:bg-violet-100 hover:text-violet-700',
  sky: 'bg-sky-50 text-sky-600 hover:bg-sky-100 hover:text-sky-700',
};

const SIZE_CLS: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ReactNode;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  /** Visual variant — `solid` (default tonal bg) or `ghost` (transparent) */
  variant?: 'solid' | 'ghost';
  /** Required for accessibility — describes what the button does */
  'aria-label': string;
}

/**
 * IconButton — square button with an icon, used in table row actions.
 * Tonal background per role (view=blue, edit=cyan, delete=rose, etc.)
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, tone = 'neutral', size = 'md', variant = 'solid', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-50',
        SIZE_CLS[size],
        variant === 'solid'
          ? TONE_CLS[tone]
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
