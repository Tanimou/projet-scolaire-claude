import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Avatar, type AvatarProps, type AvatarSize } from './Avatar';

export interface AvatarNameCellProps {
  /** Image src (optional, falls back to initials) */
  src?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Main display name override (used when first/last don't apply) */
  name?: string;
  /** Sub-line — typically email or role */
  sub?: ReactNode;
  /** Optional secondary line below sub */
  meta?: ReactNode;
  /** Avatar size (defaults to `md` = 40 px) */
  size?: AvatarSize;
  /** Forces a tone for the avatar fallback */
  tone?: AvatarProps['tone'];
  /** Optional href — wraps the whole cell in an anchor */
  href?: string;
  className?: string;
}

/**
 * AvatarNameCell — the avatar + name + sub-line pattern used in every admin table
 * (Élèves, Enseignants, Parents, Affectations, Inscriptions…).
 */
export function AvatarNameCell({
  src,
  firstName,
  lastName,
  name,
  sub,
  meta,
  size = 'md',
  tone,
  href,
  className,
}: AvatarNameCellProps) {
  const composed = name ?? [firstName, lastName].filter(Boolean).join(' ');
  const displayName = composed === '' ? '—' : composed;
  const inner = (
    <>
      <Avatar src={src} firstName={firstName} lastName={lastName} size={size} tone={tone} />
      <div className="min-w-0">
        <div className="truncate text-sm font-bold text-slate-900">{displayName}</div>
        {sub && <div className="truncate text-[11px] text-slate-500">{sub}</div>}
        {meta && <div className="truncate text-[11px] text-slate-400">{meta}</div>}
      </div>
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className={cn(
          'flex min-w-0 items-center gap-3 rounded hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:accent-outline',
          className,
        )}
      >
        {inner}
      </a>
    );
  }
  return <div className={cn('flex min-w-0 items-center gap-3', className)}>{inner}</div>;
}
