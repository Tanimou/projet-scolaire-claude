import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Avatar } from './Avatar';

export interface HeroMeta {
  label: string;
  value: ReactNode;
}

export interface ChildProfileHeroProps {
  photo?: string | null;
  firstName: string;
  lastName: string;
  classLabel?: string;
  schoolLabel?: string;
  meta?: HeroMeta[];
  /** Optional right-side slot (e.g. CTA, switcher) */
  rightSlot?: ReactNode;
  className?: string;
}

/**
 * ChildProfileHero — image 7 large profile card on the parent dashboard.
 */
export function ChildProfileHero({
  photo,
  firstName,
  lastName,
  classLabel,
  schoolLabel,
  meta,
  rightSlot,
  className,
}: ChildProfileHeroProps) {
  return (
    <article
      className={cn(
        'flex flex-col gap-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200/60 sm:flex-row sm:items-center',
        className,
      )}
    >
      <Avatar
        src={photo}
        firstName={firstName}
        lastName={lastName}
        size="2xl"
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-2xl font-bold text-slate-900">
          {firstName} {lastName}
        </h2>
        {(classLabel || schoolLabel) && (
          <p className="mt-1 truncate text-sm text-slate-600">
            {classLabel}
            {classLabel && schoolLabel && <span className="mx-1.5 text-slate-400">·</span>}
            {schoolLabel}
          </p>
        )}
        {meta && meta.length > 0 && (
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {meta.map((m, i) => (
              <div key={i} className="flex flex-col">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {m.label}
                </dt>
                <dd className="text-sm font-semibold text-slate-900">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {rightSlot && <div className="shrink-0">{rightSlot}</div>}
    </article>
  );
}
