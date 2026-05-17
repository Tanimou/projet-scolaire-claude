import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-10 w-full rounded-lg border bg-white px-3 py-2 text-sm placeholder:text-ink-400',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:border-brand-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid
          ? 'border-danger-500 focus-visible:ring-danger-500/30 focus-visible:border-danger-500'
          : 'border-ink-200',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
