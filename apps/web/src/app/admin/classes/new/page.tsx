import { EmptyState } from '@pilotage/ui';
import { ArrowLeft, CalendarDays, GraduationCap } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ClassForm } from './ClassForm';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

/**
 * `/admin/classes/new` — the create surface for a class (PF-19).
 *
 * Until S-E06-3 this route did not exist: both links on `/admin/classes`
 * (the PageHeader action and the EmptyState action) fell through to
 * `/admin/classes/[id]` with `id = 'new'`, which is why a pure
 * route-existence check could not see the defect.
 *
 * Shape: the `admin/students/new` recipe (PortalShell + back link + eyebrow +
 * H1 + lede + a colocated `'use client'` form island) composed with the
 * `admin/roles/new` recipe (the server half fetches the form's option data).
 * `force-dynamic` is mandatory — the page reads per-tenant data and a
 * prerendered admin document is what the S-E06-2 CSP gate refuses.
 */
export const metadata: Metadata = { title: 'Nouvelle classe' };
export const dynamic = 'force-dynamic';

interface SimpleAcademicYear {
  id: string;
  name: string;
  status: 'active' | 'closed' | 'archived';
}

interface SimpleGradeLevel {
  id: string;
  code: string;
  name: string;
  cycleId: string;
}

interface SimpleCycle {
  id: string;
  name: string;
  color?: string | null;
  gradeLevels: SimpleGradeLevel[];
}

export default async function NewClassPage() {
  const [years, cycles] = await Promise.all([
    api<{ data: SimpleAcademicYear[] }>('/api/v1/academic-years', { cache: 'no-store' }),
    api<{ data: SimpleCycle[] }>('/api/v1/cycles', { cache: 'no-store' }),
  ]);

  // Same mapping the list page uses (`admin/classes/page.tsx`), so the selects
  // cannot offer a value `POST /classes` will reject — minus the archived years,
  // which the controller refuses with a 400. The server-side archived check is
  // untouched: this is prevention layered in front of it, never a replacement.
  const yearOptions = years.data
    .filter((y) => y.status !== 'archived')
    .map((y) => ({
      value: y.id,
      label: y.name,
      hint: y.status === 'active' ? 'En cours' : undefined,
    }));

  // The list page's default filter is the ACTIVE year; defaulting the form to
  // anything else would create the class into a year the list is not showing.
  const defaultYearId =
    yearOptions.find((o) => o.hint === 'En cours')?.value ?? yearOptions[0]?.value ?? '';

  const levelGroups = cycles.data
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color ?? null,
      levels: c.gradeLevels.map((l) => ({ value: l.id, label: l.name })),
    }))
    .filter((g) => g.levels.length > 0);

  const levelCount = levelGroups.reduce((n, g) => n + g.levels.length, 0);

  return (
    <PortalShell portal="admin">
      <Link
        href="/admin/classes"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux classes
      </Link>
      <div className="mt-4 max-w-3xl">
        <div className="text-xs text-slate-600">Structure · Classes</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Nouvelle classe</h1>
        <p className="mt-1 text-sm text-slate-600">
          Rattachez la classe à une année scolaire et à un niveau, puis nommez-la. Les élèves,
          matières et enseignants s&apos;ajoutent ensuite depuis la fiche de la classe.
        </p>

        <div className="mt-8">
          {/*
            DNC-09 — a missing prerequisite is named explicitly and linked to the
            surface that fixes it. Never a disabled form, never a silent empty
            select, never « bientôt disponible ».
          */}
          {yearOptions.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              tone="amber"
              title="Aucune année scolaire configurée"
              description="Créez d'abord une année scolaire (non archivée) pour pouvoir y rattacher des classes."
              action={{ label: 'Configurer les années scolaires', href: '/admin/academic-years' }}
            />
          ) : levelCount === 0 ? (
            <EmptyState
              icon={GraduationCap}
              tone="amber"
              title="Aucun niveau configuré"
              description="Une classe est rattachée à un niveau, lui-même rattaché à un cycle. Créez d'abord vos cycles et niveaux."
              action={{ label: 'Configurer les niveaux', href: '/admin/levels' }}
            />
          ) : (
            <ClassForm
              yearOptions={yearOptions}
              defaultYearId={defaultYearId}
              levelGroups={levelGroups}
            />
          )}
        </div>
      </div>
    </PortalShell>
  );
}
