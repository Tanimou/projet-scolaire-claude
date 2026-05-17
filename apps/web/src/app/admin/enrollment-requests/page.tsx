import { redirect } from 'next/navigation';

/**
 * Legacy route — Demandes d'inscription is now hosted at `/admin/enrollments`
 * (EN-aligned per spec §5) with the richer Tabs UX (Toutes / En attente / À vérifier
 * / Approuvées / Rejetées).
 */
export default function LegacyEnrollmentRequestsRedirect() {
  redirect('/admin/enrollments');
}
