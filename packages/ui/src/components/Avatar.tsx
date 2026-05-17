import type { CSSProperties } from 'react';

import { cn } from '../lib/cn';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type AvatarTone = 'auto' | 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'slate' | 'teal';

export interface AvatarProps {
  /** Image src (optional) */
  src?: string | null;
  /** First name (for initials + tone hashing) */
  firstName?: string | null;
  /** Last name (for initials + tone hashing) */
  lastName?: string | null;
  /** Explicit alt text (overrides composed default) */
  alt?: string;
  size?: AvatarSize;
  tone?: AvatarTone;
  className?: string;
}

const SIZE_MAP: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
  '2xl': 'h-24 w-24 text-2xl',
};

const TONE_CLASSES: Record<Exclude<AvatarTone, 'auto'>, string> = {
  blue: 'bg-gradient-to-br from-blue-100 to-blue-200 text-blue-700',
  green: 'bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700',
  amber: 'bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700',
  rose: 'bg-gradient-to-br from-rose-100 to-rose-200 text-rose-700',
  violet: 'bg-gradient-to-br from-violet-100 to-violet-200 text-violet-700',
  slate: 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-700',
  teal: 'bg-gradient-to-br from-teal-100 to-teal-200 text-teal-700',
};

const TONE_ORDER: Array<Exclude<AvatarTone, 'auto'>> = [
  'blue',
  'green',
  'amber',
  'rose',
  'violet',
  'teal',
  'slate',
];

/** Stable hash of a string into a small int (no crypto, just for color picking). */
function hashStringToInt(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

function pickTone(firstName?: string | null, lastName?: string | null): Exclude<AvatarTone, 'auto'> {
  const composed = `${firstName ?? ''}${lastName ?? ''}`;
  const seed = composed === '' ? 'anon' : composed;
  return TONE_ORDER[hashStringToInt(seed) % TONE_ORDER.length] ?? 'slate';
}

export function Avatar({
  src,
  firstName,
  lastName,
  alt,
  size = 'md',
  tone = 'auto',
  className,
}: AvatarProps) {
  const rawInitials = [(firstName ?? '').charAt(0), (lastName ?? '').charAt(0)]
    .join('')
    .toUpperCase();
  const initials = rawInitials === '' ? '?' : rawInitials;
  const composedAltFromName = `${firstName ?? ''} ${lastName ?? ''}`.trim();
  const composedAlt = alt ?? (composedAltFromName === '' ? 'Avatar' : composedAltFromName);
  const resolvedTone = tone === 'auto' ? pickTone(firstName, lastName) : tone;

  if (src) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 overflow-hidden rounded-full ring-1 ring-slate-200/60',
          SIZE_MAP[size],
          className,
        )}
      >
        {/* Plain <img> intentionally — works in server components and storybook */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={composedAlt} className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={composedAlt}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold',
        SIZE_MAP[size],
        TONE_CLASSES[resolvedTone],
        className,
      )}
    >
      {initials}
    </span>
  );
}

export interface AvatarGroupProps {
  members: Array<Pick<AvatarProps, 'src' | 'firstName' | 'lastName'>>;
  max?: number;
  size?: AvatarSize;
  className?: string;
}

const STACK_OFFSET: Record<AvatarSize, string> = {
  xs: '-ml-1.5',
  sm: '-ml-2',
  md: '-ml-2.5',
  lg: '-ml-3',
  xl: '-ml-4',
  '2xl': '-ml-5',
};

export function AvatarGroup({ members, max = 4, size = 'sm', className }: AvatarGroupProps) {
  const visible = members.slice(0, max);
  const overflow = members.length - visible.length;
  return (
    <div
      className={cn('flex items-center', className)}
      style={{ '--avatar-offset': STACK_OFFSET[size] } as CSSProperties}
    >
      {visible.map((m, i) => (
        <Avatar
          key={i}
          {...m}
          size={size}
          className={cn(i > 0 && STACK_OFFSET[size], 'ring-2 ring-white')}
        />
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-slate-100 font-bold text-slate-600 ring-2 ring-white',
            SIZE_MAP[size],
            STACK_OFFSET[size],
          )}
          aria-label={`et ${overflow} autres`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
