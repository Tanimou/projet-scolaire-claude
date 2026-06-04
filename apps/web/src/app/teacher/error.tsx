'use client';

import { PortalErrorState } from '@/components/PortalErrorState';

export default function TeacherError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PortalErrorState error={error} reset={reset} portal="teacher" />;
}
