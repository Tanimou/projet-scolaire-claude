'use client';

import { Bell, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { formatRelativeTime } from '../lib/format';

export interface NotificationItem {
  id: string;
  title: string;
  body?: string;
  date: string | Date;
  href?: string;
  readAt?: string | Date | null;
  /** Optional tone for the leading dot */
  tone?: 'blue' | 'green' | 'amber' | 'rose' | 'violet';
}

export interface NotificationBellProps {
  items: NotificationItem[];
  unreadCount: number;
  /** Called when user opens the dropdown */
  onOpen?: () => void;
  /** Mark single notification as read */
  onMarkRead?: (id: string) => void;
  /** Mark all notifications as read */
  onMarkAllRead?: () => void;
  /** Link to full notifications page */
  seeAllHref?: string;
  className?: string;
}

const TONE_DOT: Record<NonNullable<NotificationItem['tone']>, string> = {
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
};

/**
 * NotificationBell — topbar bell with badge + dropdown panel.
 * Caller is responsible for fetching items + polling.
 */
export function NotificationBell({
  items,
  unreadCount,
  onOpen,
  onMarkRead,
  onMarkAllRead,
  seeAllHref,
  className,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOut(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOut);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOut);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) onOpen?.();
  }, [open, onOpen]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold tabular-nums text-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Centre de notifications"
          className="absolute right-0 z-40 mt-2 w-[360px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5"
        >
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-bold text-slate-900">Notifications</h3>
            {unreadCount > 0 && onMarkAllRead && (
              <button
                type="button"
                onClick={() => {
                  onMarkAllRead();
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Tout marquer comme lu
              </button>
            )}
          </header>
          <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-slate-500">
                Aucune notification pour le moment.
              </li>
            ) : (
              items.map((n) => {
                const unread = !n.readAt;
                const tone = n.tone ?? 'blue';
                const Inner = (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        unread ? TONE_DOT[tone] : 'bg-transparent',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <h4 className={cn('truncate text-sm', unread ? 'font-bold text-slate-900' : 'font-medium text-slate-700')}>
                          {n.title}
                        </h4>
                        <time
                          className="shrink-0 text-[11px] text-slate-400"
                          dateTime={typeof n.date === 'string' ? n.date : n.date.toISOString()}
                        >
                          {formatRelativeTime(n.date)}
                        </time>
                      </div>
                      {n.body && <p className="mt-0.5 line-clamp-2 text-[12px] text-slate-600">{n.body}</p>}
                    </div>
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.href ? (
                      <a
                        href={n.href}
                        onClick={() => onMarkRead?.(n.id)}
                        className={cn(
                          'flex gap-2 px-4 py-3 transition hover:bg-slate-50',
                          unread && 'bg-blue-50/40',
                        )}
                      >
                        {Inner}
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onMarkRead?.(n.id)}
                        className={cn(
                          'flex w-full gap-2 px-4 py-3 text-left transition hover:bg-slate-50',
                          unread && 'bg-blue-50/40',
                        )}
                      >
                        {Inner}
                      </button>
                    )}
                  </li>
                );
              })
            )}
          </ul>
          {seeAllHref && (
            <footer className="border-t border-slate-100 px-4 py-2.5 text-center">
              <a
                href={seeAllHref}
                className="text-xs font-bold text-blue-700 hover:underline"
              >
                Voir toutes les notifications →
              </a>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}
