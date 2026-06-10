'use client';

import { AlertTriangle, Check, Loader2, Megaphone, Pin } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Badge, PreferredDate, cn } from '@pilotage/ui';

import { markStudentAnnouncementReadAction } from './actions';

/**
 * StudentAnnouncementCard — E8-S3 (the learner's own announcement card).
 *
 * A thin, student-scoped sibling of the parent `AnnouncementCard`: it never
 * imports the parent card (whose mark-read action + deep-links target /parent/*).
 * It renders the NARROWED, peer-free `StudentAnnouncementRow` and wires the ONE
 * student mutation — the self-scoped receipt mark-read (`POST /student/
 * announcements/:id/read`).
 *
 * Tone: the learner's OWN space — the unread accent uses the violet `student`
 * ramp (not parent blue). Mark-read is PASSIVE and unobtrusive ("Marquer lue"),
 * never framed as an action the learner must take.
 *
 * A11y: priority/unread state is icon + text (never colour alone); the
 * `role="status"` + `aria-live="polite"` region announces ONLY the read
 * transition (it is rendered solely while the optimistic flip is in flight),
 * never on every paint; `focus-visible` ring on the button; ≥44px target.
 */

type Priority = 'normal' | 'high' | 'urgent';

export interface StudentAnnouncementCardProps {
  id: string;
  title: string;
  body: string;
  priority: Priority;
  pinned: boolean;
  publishedAt: string | null;
  scopeLabel: string;
  audienceLabel: string | null;
  authorLabel: string | null;
  readAt: string | null;
}

const PRIORITY_META: Record<
  Priority,
  { label: string; variant: 'neutral' | 'warning' | 'danger'; icon: string }
> = {
  normal: { label: 'Normale', variant: 'neutral', icon: 'bg-violet-100 text-violet-700' },
  high: { label: 'Importante', variant: 'warning', icon: 'bg-amber-100 text-amber-700' },
  urgent: { label: 'Urgente', variant: 'danger', icon: 'bg-rose-100 text-rose-700' },
};

export function StudentAnnouncementCard(props: StudentAnnouncementCardProps) {
  const [pending, startTransition] = useTransition();
  const [optimisticRead, setOptimisticRead] = useState(!!props.readAt);
  const isUnread = !optimisticRead;
  const meta = PRIORITY_META[props.priority];
  const Icon = props.priority === 'urgent' ? AlertTriangle : Megaphone;

  function markRead() {
    if (pending || !isUnread) return;
    setOptimisticRead(true);
    startTransition(async () => {
      const res = await markStudentAnnouncementReadAction(props.id);
      if (!res.ok) setOptimisticRead(false);
    });
  }

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 transition hover:shadow-md',
        isUnread ? 'ring-violet-300/80 shadow-violet-100/40' : 'ring-slate-200/70',
      )}
    >
      {isUnread && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-violet-500 to-fuchsia-500"
        />
      )}
      <div className="flex items-start gap-4">
        <div
          className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', meta.icon)}
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {props.pinned && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200"
                title="Épinglée"
              >
                <Pin className="h-3 w-3" aria-hidden /> Épinglée
              </span>
            )}
            {props.priority !== 'normal' && (
              <Badge variant={meta.variant} className="text-[10px]">
                {meta.label}
              </Badge>
            )}
            {isUnread ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                Nouveau
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                <Check className="h-3 w-3" aria-hidden /> Lu
              </span>
            )}
          </div>

          <h3
            className={cn(
              'mt-1.5 text-base',
              isUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800',
            )}
          >
            {props.title}
          </h3>

          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-600">
            {props.body}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="font-medium text-slate-600">{props.scopeLabel}</span>
            {props.audienceLabel && (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">
                {props.audienceLabel}
              </span>
            )}
            {props.authorLabel && <span>• {props.authorLabel}</span>}
            {props.publishedAt && (
              <span className="ml-auto whitespace-nowrap">
                <PreferredDate value={props.publishedAt} />
              </span>
            )}
          </div>
        </div>
      </div>

      {isUnread && (
        <div className="mt-4 flex items-center justify-end border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={markRead}
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden />
            )}
            Marquer lue
          </button>
        </div>
      )}

      {/* Polite live region: present ONLY while the read transition is in flight,
          so it announces the change once, never on every paint. */}
      {pending && (
        <span role="status" aria-live="polite" className="sr-only">
          Annonce marquée comme lue.
        </span>
      )}
    </article>
  );
}
