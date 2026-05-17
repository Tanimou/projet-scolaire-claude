'use client';

import { AlertTriangle, ArrowRight, Check, Loader2, Megaphone, Pin } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StatusBadge } from '@pilotage/ui';

import { markAnnouncementReadAction } from './actions';

type Priority = 'normal' | 'high' | 'urgent';

export interface AnnouncementCardProps {
  id: string;
  title: string;
  body: string;
  priority: Priority;
  pinned: boolean;
  publishedAtLabel: string | null;
  scopeLabel: string;
  audienceLabel: string | null;
  authorLabel: string | null;
  readAt: string | null;
}

const PRIORITY_TONE: Record<Priority, { card: string; badge: 'neutral' | 'warning' | 'danger'; icon: string }> = {
  normal: {
    card: 'ring-slate-200/70',
    badge: 'neutral',
    icon: 'bg-blue-100 text-blue-700',
  },
  high: {
    card: 'ring-amber-200',
    badge: 'warning',
    icon: 'bg-amber-100 text-amber-700',
  },
  urgent: {
    card: 'ring-rose-300/80',
    badge: 'danger',
    icon: 'bg-rose-100 text-rose-700',
  },
};

const PRIORITY_LABEL: Record<Priority, string> = {
  normal: 'Normale',
  high: 'Importante',
  urgent: 'Urgente',
};

export function AnnouncementCard(props: AnnouncementCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticRead, setOptimisticRead] = useState(!!props.readAt);
  const isUnread = !optimisticRead;
  const tone = PRIORITY_TONE[props.priority];
  const Icon = props.priority === 'urgent' ? AlertTriangle : Megaphone;

  function openDetail() {
    router.push(`/parent/announcements/${props.id}`);
  }

  function markRead(e: React.MouseEvent) {
    e.stopPropagation();
    if (pending || !isUnread) return;
    setOptimisticRead(true);
    startTransition(async () => {
      const res = await markAnnouncementReadAction(props.id);
      if (!res.ok) setOptimisticRead(false);
    });
  }

  return (
    <article
      onClick={openDetail}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail();
        }
      }}
      className={`group relative cursor-pointer rounded-2xl bg-white p-5 shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
        isUnread ? 'ring-blue-300/80 shadow-blue-100/40' : tone.card
      }`}
    >
      {isUnread && (
        <span
          aria-hidden
          className="absolute left-0 top-5 h-8 w-1 rounded-r-full bg-gradient-to-b from-blue-500 to-indigo-500"
        />
      )}
      <div className="flex items-start gap-4">
        <div
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tone.icon}`}
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
                <Pin className="h-3 w-3" /> Épinglée
              </span>
            )}
            {props.priority !== 'normal' && (
              <StatusBadge
                label={PRIORITY_LABEL[props.priority]}
                tone={tone.badge}
                size="sm"
              />
            )}
            {isUnread ? (
              <StatusBadge label="Nouveau" tone="info" size="sm" withDot />
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                <Check className="h-3 w-3" /> Lu
              </span>
            )}
          </div>

          <h3
            className={`mt-1.5 text-base ${
              isUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'
            }`}
          >
            {props.title}
          </h3>

          <p className="mt-1.5 line-clamp-2 text-sm text-slate-600 whitespace-pre-line">
            {props.body}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1 font-medium text-slate-600">
              {props.scopeLabel}
            </span>
            {props.audienceLabel && (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">
                {props.audienceLabel}
              </span>
            )}
            {props.authorLabel && <span>• {props.authorLabel}</span>}
            {props.publishedAtLabel && (
              <span className="ml-auto whitespace-nowrap">{props.publishedAtLabel}</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
        {isUnread && (
          <button
            type="button"
            onClick={markRead}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Marquer lue
          </button>
        )}
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 group-hover:underline">
          Lire <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </article>
  );
}
