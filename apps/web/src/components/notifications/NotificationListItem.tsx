'use client';

import { Bell, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StatusBadge } from '@pilotage/ui';

import { markReadAction } from './actions';
import { KIND_ICON, type NotificationKind, type NotificationSeverity } from './NotificationCenter';

const SEVERITY_BG: Record<NotificationSeverity, string> = {
  info: 'bg-sky-50 text-sky-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-rose-50 text-rose-700',
};

export function NotificationListItem({
  id,
  kind,
  severity,
  title,
  body,
  link,
  createdAt,
  readAt,
  kindLabel,
  relativeTime,
}: {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
  kindLabel: string;
  relativeTime: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticRead, setOptimisticRead] = useState(!!readAt);

  const Icon = KIND_ICON[kind] ?? Bell;
  const isUnread = !optimisticRead;

  function handle() {
    if (pending) return;
    if (isUnread) {
      setOptimisticRead(true);
      startTransition(async () => {
        const res = await markReadAction(id);
        if (!res.ok) setOptimisticRead(false);
        else if (link) router.push(link);
      });
    } else if (link) {
      router.push(link);
    }
  }

  void createdAt; // already formatted into relativeTime by the server component

  return (
    <li>
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className={`flex w-full items-start gap-4 px-5 py-4 text-left transition hover:bg-slate-50/60 disabled:cursor-not-allowed ${
          isUnread ? 'bg-blue-50/30' : ''
        }`}
      >
        <span
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${SEVERITY_BG[severity]}`}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-5 w-5" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={`text-sm ${
                isUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'
              }`}
            >
              {title}
            </h3>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              {kindLabel}
            </span>
            {isUnread && (
              <StatusBadge label="Non lue" tone="danger" size="sm" withDot />
            )}
          </div>
          {body && (
            <p className="mt-1 text-xs text-slate-600 line-clamp-2">{body}</p>
          )}
          <p className="mt-1 text-[10px] text-slate-400">{relativeTime}</p>
        </div>

        {link && (
          <span className="shrink-0 text-[11px] font-bold text-blue-700">
            Voir →
          </span>
        )}
      </button>
    </li>
  );
}
