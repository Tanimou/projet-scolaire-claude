import { redirect } from 'next/navigation';

/**
 * Legacy route — the list view is now hosted at `/admin/communications`
 * (spec §10.12). The `/admin/announcements/new` form is kept as the canonical
 * create page since the rebrand only renames the list, not the form.
 */
export default function LegacyAnnouncementsRedirect() {
  redirect('/admin/communications');
}
