import { MessagesSquare, UserRoundX } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { EmptyState, PageHeader } from '@pilotage/ui';

import { ComposeForm, type ComposeChild } from './ComposeForm';

export const metadata: Metadata = { title: 'Messages' };
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
 * Parent Messages — the E2-S1 thin compose entry (the only new UI this slice
 * ships; the full inbox/thread list lands in S2). The shell is intentionally
 * minimal so S2 can fill the body with the inbox without churning this markup.
 *
 * The page fetches the parent's guarded children server-side (same scoped
 * `/api/v1/students` aggregate the children page reads — no client N+1) and
 * hands them to the client `ComposeForm`, which lazily loads the
 * server-filtered eligible-teacher list per child. The dual-wall ABAC
 * (guardianship ∩ teaching) is enforced entirely by the backend; this surface
 * only ever offers eligible teachers.
 */
export default async function ParentMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const sp = await searchParams;
  const initialStudentId = sp.studentId ?? null;

  const resp = await safe(
    api<{ data: Child[] }>('/api/v1/students', { cache: 'no-store' }),
  );
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
          { label: 'Messages' },
        ]}
        title="Messages"
        subtitle="Échangez avec les enseignant·e·s de votre enfant"
      />

      <div className="mt-6 max-w-2xl space-y-6">
        <section className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:p-5">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <MessagesSquare className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm leading-relaxed text-slate-600">
            Contactez directement un·e enseignant·e qui suit votre enfant pour poser une
            question ou demander un point. La conversation reste privée et bienveillante.
          </p>
        </section>

        {children.length === 0 ? (
          <EmptyState
            icon={UserRoundX}
            tone="slate"
            title="Aucun enfant rattaché"
            description="La messagerie s'ouvre une fois un enfant rattaché à votre compte. Contactez l'administration de l'établissement pour rattacher le dossier de votre enfant."
          />
        ) : (
          <ComposeForm students={children} initialStudentId={initialStudentId} />
        )}
      </div>
    </PortalShell>
  );
}
