import { redirect } from 'next/navigation';

/**
 * Legacy route — Affectations are now hosted at `/admin/assignments` (EN-aligned
 * per spec §5). The `AssignmentsManager` component is still imported from this
 * directory by the new page (kept as the single source of truth).
 */
export default function LegacyTeachingAssignmentsRedirect() {
  redirect('/admin/assignments');
}
