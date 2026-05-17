import { GraduationCap } from 'lucide-react';

import type { BrandingResponse } from '@/lib/me';

export interface PortalBrandProps {
  branding: BrandingResponse | null;
  portal: 'admin' | 'teacher' | 'parent';
  compact?: boolean;
}

const PORTAL_LABEL: Record<PortalBrandProps['portal'], string> = {
  admin: 'Administrateur',
  teacher: 'Enseignant',
  parent: 'Parent',
};

/**
 * PortalBrand — renders the dark-sidebar header brand (logo + name + role label).
 * Server-renderable.
 */
export function PortalBrand({ branding, portal, compact }: PortalBrandProps) {
  if (compact) {
    return (
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white"
        aria-label={branding?.displayName ?? 'Pilotage scolaire'}
      >
        <GraduationCap className="h-5 w-5" />
      </span>
    );
  }
  return (
    <a href={`/${portal}/dashboard`} className="flex items-center gap-2.5 text-white">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
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
