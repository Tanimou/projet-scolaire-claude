'use client';

import { PortalErrorState } from '@/components/PortalErrorState';

/**
 * Root error boundary — catches throws from any page that has no closer
 * `error.tsx` (e.g. the public `/` and the per-portal login pages).
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PortalErrorState error={error} reset={reset} />;
}
