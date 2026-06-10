import { GraduationCap } from 'lucide-react';

import type { BrandingResponse } from '@/lib/me';

export interface PortalBrandProps {
  branding: BrandingResponse | null;
  portal: 'admin' | 'teacher' | 'parent' | 'student';
  compact?: boolean;
}

const PORTAL_LABEL: Record<PortalBrandProps['portal'], string> = {
  admin: 'Administrateur',
  teacher: 'Enseignant',
  parent: 'Parent',
  student: 'Élève',
};

/** Where the brand pill links (most portals → dashboard; student → "Mes notes"). */
const PORTAL_HOME: Record<PortalBrandProps['portal'], string> = {
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  parent: '/parent/dashboard',
  student: '/student/grades',
};

/**
 * PortalBrand — renders the dark-sidebar header brand (logo + name + role label).
 * The logo sits in an accent-gradient pill (swaps per portal) with a soft glow.
 * Server-renderable.
 */
export function PortalBrand({ branding, portal, compact }: PortalBrandProps) {
  if (compact) {
    return (
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/15"
        style={{ background: 'var(--accent-gradient)' }}
        aria-label={branding?.displayName ?? 'Pilotage scolaire'}
      >
        <GraduationCap className="h-5 w-5" />
      </span>
    );
  }
  return (
    <a href={PORTAL_HOME[portal]} className="group flex items-center gap-2.5 text-white">
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md ring-1 ring-white/15 transition-transform duration-300 group-hover:scale-105"
        style={{ background: 'var(--accent-gradient)' }}
      >
        <GraduationCap className="h-5 w-5" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[13px] font-bold uppercase tracking-wider">
          Pilotage scolaire
        </span>
        <span className="block truncate text-[11px] font-medium text-[color:var(--ink-on-sidebar-muted)]">
          {branding?.displayName ?? PORTAL_LABEL[portal]}
        </span>
      </span>
    </a>
  );
}
