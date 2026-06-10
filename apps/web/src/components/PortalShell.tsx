/**
 * PortalShell — legacy alias kept for backward compatibility with 40+ existing pages.
 * Delegates to the new AppShellRoot (R2 — sidebar + topbar pattern).
 *
 * New pages should import `AppShellRoot` directly when they need title/subtitle overrides.
 */
import type { ReactNode } from 'react';

import { AppShellRoot, getCurrentUser as appShellGetCurrentUser } from './shell/AppShellRoot';

type Portal = 'admin' | 'teacher' | 'parent' | 'student';

export async function PortalShell({
  portal,
  children,
  contentClassName,
  title,
  subtitle,
  topbarExtras,
}: {
  portal: Portal;
  children: ReactNode;
  contentClassName?: string;
  title?: string;
  subtitle?: string;
  /** Pre-bell extras (e.g. YearSelector) injected into the topbar actions slot */
  topbarExtras?: ReactNode;
}) {
  return (
    <AppShellRoot
      portal={portal}
      title={title}
      subtitle={subtitle}
      contentClassName={contentClassName}
      topbarExtras={topbarExtras}
    >
      {children}
    </AppShellRoot>
  );
}

export const getCurrentUser = appShellGetCurrentUser;
