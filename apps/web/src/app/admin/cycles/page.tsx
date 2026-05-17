import { redirect } from 'next/navigation';

/**
 * Legacy route — Cycles & niveaux is now hosted at `/admin/levels` (EN-aligned
 * per spec §5). The `CyclesManager` component is still imported from this
 * directory by the new page (kept as the single source of truth).
 */
export default function LegacyCyclesRedirect() {
  redirect('/admin/levels');
}
