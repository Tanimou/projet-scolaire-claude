'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Auto-polls the server every `intervalMs` to refresh the exports list while
 * at least one job is in `pending` or `running` state. We call
 * `router.refresh()` which re-renders the server component without changing
 * the URL — cheap incremental update.
 */
export function ExportsRefresher({
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
