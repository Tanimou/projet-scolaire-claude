import { redirect } from 'next/navigation';

/**
 * Legacy route — branding is now an "Identité visuelle" tab inside
 * `/admin/establishment`. We redirect rather than dual-host the form so the
 * BrandingForm component stays single-source (re-used by the new page).
 */
export default function LegacyBrandingRedirect() {
  redirect('/admin/establishment');
}
