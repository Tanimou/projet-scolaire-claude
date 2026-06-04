'use client';

import { PortalErrorState } from '@/components/PortalErrorState';

export default function ParentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PortalErrorState error={error} reset={reset} portal="parent" />;
}
