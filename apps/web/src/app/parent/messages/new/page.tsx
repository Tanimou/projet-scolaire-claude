import { ArrowLeft, UserRoundX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { EmptyState, PageHeader } from '@pilotage/ui';

import { ComposeForm, type ComposeChild } from '../ComposeForm';

export const metadata: Metadata = { title: 'Nouveau message' };
export const dynamic = 'force-dynamic';

interface ChildEnrollment {
  classSection: { name: string; gradeLevel?: { name: string } };
  academicYear: { status: string };
}

interface Child {
  id: string;
  firstName: string;
  lastName: string;
  enrollments: ChildEnrollment[];
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

function classLabel(c: Child): string | null {
  const active = c.enrollments.find((e) => e.academicYear.status === 'active');
  if (!active) return null;
  const grade = active.classSection.gradeLevel?.name;
  return grade ? `${active.classSection.name} · ${grade}` : active.classSection.name;
}

/**
 * Parent compose — the relocated E2-S1 compose surface, now living at
 * `/parent/messages/new` (the inbox at `/parent/messages` is the list). It
 * doubles as the alert-seeded compose landing: the E1 `AlertNextSteps`
 * "Discuter avec l'enseignant·e" CTA deep-links here with
 * `?alertId=&studentId=(&subjectId&alertTitle)`, and the `ComposeForm` pre-fills
 * the child + a kind body and forwards `alertId`/`subjectId` to the create
 * action so the resulting thread is alert-seeded (the visionary E1→E2 loop).
 *
 * Server-fetches the parent's guarded children (the scoped `/students`
 * aggregate, no client N+1); the dual-wall ABAC + alert re-check (guardianship ∩
 * teaching, alert.studentId === studentId) are enforced entirely by the backend.
 */
export default async function ParentNewMessagePage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    alertId?: string;
    subjectId?: string;
    alertTitle?: string;
  }>;
}) {
  const sp = await searchParams;

  const resp = await safe(api<{ data: Child[] }>('/api/v1/students', { cache: 'no-store' }));
  const children: ComposeChild[] = (resp?.data ?? []).map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim(),
    classLabel: classLabel(c),
  }));

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Messages', href: '/parent/messages' },
          { label: 'Nouveau message' },
        ]}
        title="Nouveau message"
        subtitle="Contactez un·e enseignant·e qui suit votre enfant"
      />

      <div className="mt-6 max-w-2xl space-y-6">
        <Link
          href="/parent/messages"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour aux messages
        </Link>

        {children.length === 0 ? (
          <EmptyState
            icon={UserRoundX}
            tone="slate"
            title="Aucun enfant rattaché"
            description="La messagerie s'ouvre une fois un enfant rattaché à votre compte. Contactez l'administration de l'établissement pour rattacher le dossier de votre enfant."
          />
        ) : (
          <ComposeForm
            students={children}
            initialStudentId={sp.studentId ?? null}
            alertId={sp.alertId ?? null}
            subjectId={sp.subjectId ?? null}
            alertTitle={sp.alertTitle ?? null}
          />
        )}
      </div>
    </PortalShell>
  );
}
