import { AlertTriangle, ChevronRight, Lock } from 'lucide-react';
import Link from 'next/link';

import type { ConversationDto } from '@pilotage/contracts';
import { formatRelativeTime } from '@pilotage/ui';

/**
 * TeacherThreadList — the E2-S3 teacher inbox rows. A pure, server-renderable
 * presentational component (no `'use client'`): each row is a `Link` to
 * `/teacher/conversations/[id]`, so the whole inbox renders from ONE aggregate
 * `GET /api/v1/conversations` call (role-scoped to teacherId = me server-side,
 * no client N+1).
 *
 * The teacher-side mirror of the parent `ThreadList` with the identity FLIPPED:
 * the row shows the PARENT (`c.parentName`) as the interlocutor and the child as
 * "Au sujet de {studentName}", since the teacher reads the family that wrote to
 * them. Same row anatomy + a11y: 64px-min rows, violet messaging accent, an
 * unread treatment conveyed by THREE non-colour cues (left accent bar + bold name
 * + count pill — WCAG 1.4.1), an amber "Alerte" chip for alert-seeded threads, a
 * slate "Lecture seule" chip for `read_only` threads, and an `aria-label`
 * combining parent + child + unread count so each row is intelligible out of
 * visual context.
 */

/** Parent initials for the leading avatar chip (max 2 glyphs). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  const last = parts[parts.length - 1] ?? first;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

function rowAriaLabel(c: ConversationDto): string {
  const base = `Conversation avec ${c.parentName} au sujet de ${c.studentName}`;
  if (c.unreadCount > 0) {
    return `${base}, ${c.unreadCount} message${c.unreadCount > 1 ? 's' : ''} non lu${c.unreadCount > 1 ? 's' : ''}`;
  }
  if (c.status === 'read_only') return `${base}, conversation en lecture seule`;
  return base;
}

export function TeacherThreadList({ conversations }: { conversations: ConversationDto[] }) {
  return (
    <ul role="list" className="space-y-2">
      {conversations.map((c) => {
        const unread = c.unreadCount > 0;
        const readOnly = c.status === 'read_only';
        return (
          <li key={c.id}>
            <Link
              href={`/teacher/conversations/${c.id}`}
              aria-label={rowAriaLabel(c)}
              className={[
                'group flex min-h-[64px] items-center gap-3 rounded-2xl p-3 shadow-sm ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-safe:hover:-translate-y-px motion-safe:hover:shadow-md sm:p-4',
                unread
                  ? 'border-l-2 border-violet-500 bg-violet-50/40 ring-slate-200/60'
                  : 'bg-white ring-slate-200/60 hover:bg-slate-50/60',
              ].join(' ')}
            >
              {/* Leading avatar chip — parent initials, violet messaging accent. */}
              <span
                aria-hidden
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-sm font-bold text-violet-700"
              >
                {initials(c.parentName)}
              </span>

              <span className="min-w-0 flex-1">
                {/* Line 1 — parent name + relative timestamp. */}
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={[
                      'truncate text-sm text-slate-800',
                      unread ? 'font-bold' : 'font-semibold',
                    ].join(' ')}
                  >
                    {c.parentName}
                  </span>
                  {c.lastMessageAt && (
                    <time
                      dateTime={c.lastMessageAt}
                      className="shrink-0 text-xs text-slate-400"
                    >
                      {formatRelativeTime(c.lastMessageAt)}
                    </time>
                  )}
                </span>

                {/* Line 2 — child + chips. */}
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-500">Au sujet de {c.studentName}</span>
                  {c.alertContext && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200/70">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      Alerte
                    </span>
                  )}
                  {readOnly && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                      <Lock className="h-3 w-3" aria-hidden />
                      Lecture seule
                    </span>
                  )}
                </span>

                {/* Line 3 — last-message preview. */}
                {c.lastMessagePreview && (
                  <span
                    className={[
                      'mt-0.5 block truncate text-xs leading-snug',
                      unread ? 'text-slate-600' : 'text-slate-400',
                    ].join(' ')}
                  >
                    {c.lastMessagePreview}
                  </span>
                )}
              </span>

              {/* Unread count pill (text + count, never colour alone). */}
              {unread && (
                <span
                  aria-hidden
                  className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 px-1.5 text-[11px] font-bold text-white"
                >
                  {c.unreadCount > 99 ? '99+' : c.unreadCount}
                </span>
              )}

              <ChevronRight
                className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-slate-600"
                aria-hidden
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
