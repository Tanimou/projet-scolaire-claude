import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        neutral: 'bg-ink-100 text-ink-700',
        brand: 'bg-brand-50 text-brand-700',
        success: 'bg-success-100 text-success-700',
        warning: 'bg-warning-100 text-warning-700',
        danger: 'bg-danger-100 text-danger-700',
        outline: 'border border-ink-200 text-ink-700',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
