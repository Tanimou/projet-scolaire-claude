'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Parent-scoped clone of the admin `ExportsRefresher`. Auto-polls the server
 * every `intervalMs` to refresh the bulletin list while at least one of the
 * parent's own jobs is `pending`/`running`. Calls `router.refresh()` (re-renders
 * the server component without changing the URL) and pauses when the tab is
 * hidden, so a parent on mobile isn't drained while the page is backgrounded.
 *
 * Polling stops automatically once nothing is in-flight (`hasInflight` flips
 * false on the next server render), which gives a built-in attempt cap: a job
 * that reaches a terminal `succeeded`/`failed` state ends the loop.
 */
export function ParentExportsRefresher({
  hasInflight,
  intervalMs = 3000,
}: {
  hasInflight: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  const visibleRef = useRef(true);

  useEffect(() => {
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!hasInflight) return;
    const id = setInterval(() => {
      if (!visibleRef.current) return;
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [hasInflight, intervalMs, router]);

  return null;
}
