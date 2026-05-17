'use client';

import { useEffect, useState } from 'react';

import { NotificationBell, type NotificationItem } from '@pilotage/ui';

export interface TopbarBellProps {
  portal: 'admin' | 'teacher' | 'parent';
}

const POLL_INTERVAL_MS = 30_000;

/**
 * TopbarBell — fetches notifications from /api/v1/notifications via the local Next.js proxy.
 * In phase R8 the polling will be replaced with SSE. Until then, polls every 30s.
 */
export function TopbarBell({ portal }: TopbarBellProps) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  async function fetchUnread() {
    try {
      const res = await fetch('/api/proxy/v1/notifications/unread-count', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { count?: number };
      setUnreadCount(typeof data.count === 'number' ? data.count : 0);
    } catch {
      // Silent — bell is best-effort, the API may not be ready in dev
    }
  }

  async function fetchList() {
    try {
      const res = await fetch('/api/proxy/v1/notifications?limit=20', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { data?: Array<Record<string, unknown>> };
      if (!Array.isArray(data.data)) return;
      setItems(
        data.data.map((n) => ({
          id: String(n.id ?? ''),
          title: String(n.title ?? ''),
          body: typeof n.body === 'string' ? n.body : undefined,
          date: String(n.createdAt ?? new Date().toISOString()),
          href: typeof n.link === 'string' ? n.link : undefined,
          readAt: typeof n.readAt === 'string' ? n.readAt : null,
        })),
      );
    } catch {
      // Silent
    }
  }

  useEffect(() => {
    fetchUnread();
    const i = setInterval(fetchUnread, POLL_INTERVAL_MS);
    return () => clearInterval(i);
  }, []);

  return (
    <NotificationBell
      items={items}
      unreadCount={unreadCount}
      onOpen={fetchList}
      onMarkRead={async (id) => {
        try {
          await fetch(`/api/proxy/v1/notifications/${id}/read`, { method: 'POST' });
          setItems((prev) =>
            prev.map((n) =>
              n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n,
            ),
          );
          setUnreadCount((c) => Math.max(0, c - 1));
        } catch {
          /* ignore */
        }
      }}
      onMarkAllRead={async () => {
        try {
          await fetch('/api/proxy/v1/notifications/read-all', { method: 'POST' });
          setItems((prev) =>
            prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
          );
          setUnreadCount(0);
        } catch {
          /* ignore */
        }
      }}
      seeAllHref={`/${portal}/notifications`}
    />
  );
}
