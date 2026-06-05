import { AlertCircle, ArrowLeft, BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { PageHeader } from '@pilotage/ui';

import { Gradebook } from './Gradebook';
import { GradebookInsights } from './GradebookInsights';

export const metadata: Metadata = { title: 'Notes' };
export const dynamic = 'force-dynamic';

export interface GradebookData {
  assignment: {
    id: string;
    classSection: {
      id: string;
      name: string;
      gradeLevel: { id: string; name: string; cycle?: { name: string } };
    };
    subject: { id: string; name: string; color: string | null };
    baseCoefficient: number;
  };
  assessments: Array<{
    id: string;
    title: string;
    kind: string;
    scheduledAt: string | null;
    maxScore: number;
    coefficientOverride: number | null;
    effectiveCoefficient: number;
    isPublished: boolean;
    termId: string | null;
  }>;
  rows: Array<{
    studentId: string;
    student: { id: string; firstName: string; lastName: string; externalRef: string | null };
    grades: Array<null | {
      id: string;
      value: number | null;
      isAbsent: boolean;
      status: string;
      comment: string | null;
      isFlagged: boolean;
      flagNote: string | null;
    }>;
    average: number | null;
    count: number;
  }>;
  classAverage: number | null;
}

export default async function GradebookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // `id` is the **teachingAssignmentId** (one teacher × one class × one subject).
  // If the user lands here with a `classSectionId` (legacy bookmark or wrong
  // link), the API returns 404 — we catch and render a friendly empty state
  // instead of crashing the whole page.
  let data: GradebookData | null = null;
  try {
    data = await api<GradebookData>(`/api/v1/grades/gradebook/${id}`, { cache: 'no-store' });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }

  if (!data) {
    return (
      <PortalShell portal="teacher">
        <Link
          href="/teacher/classes"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" /> Retour à mes classes
        </Link>
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h2 className="text-base font-bold text-amber-900">Gradebook introuvable</h2>
              <p className="mt-1 text-sm text-amber-900">
                Cette URL référence un identifiant d&apos;affectation enseignement qui
                n&apos;existe pas (ou ne vous appartient pas). L&apos;URL attend un
                <strong> teachingAssignmentId </strong>
                (un couple classe × matière × prof), pas un identifiant de classe.
              </p>
              <p className="mt-2 text-sm text-amber-900">
                Revenez à <Link href="/teacher/classes" className="font-bold underline">Mes classes</Link>{' '}
                et cliquez sur le chip de matière souhaitée — chaque chip ouvre la
                gradebook de cette matière.
              </p>
            </div>
          </div>
        </section>
      </PortalShell>
    );
  }

  const subjectColorStyle = data.assignment.subject.color
    ? { backgroundColor: `${data.assignment.subject.color}1A`, color: data.assignment.subject.color }
    : { backgroundColor: '#E2E8F0', color: '#475569' };

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Mes classes', href: '/teacher/classes' },
          {
            label: data.assignment.classSection.name,
            href: `/teacher/classes/${id}`,
          },
          { label: data.assignment.subject.name },
        ]}
        leading={
          <span
            aria-hidden
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-bold ring-1 ring-slate-200/60"
            style={subjectColorStyle}
          >
            <BookOpen className="h-5 w-5" />
          </span>
        }
        title="Notes & évaluations"
        subtitle={
          <>
            {data.assignment.classSection.gradeLevel.cycle?.name && (
              <>{data.assignment.classSection.gradeLevel.cycle.name} · </>
            )}
            {data.assignment.classSection.gradeLevel.name} ·{' '}
            {data.assignment.classSection.name} · {data.assignment.subject.name} · coef. de base{' '}
            <strong className="font-bold">{data.assignment.baseCoefficient}</strong>
          </>
        }
        actions={
          <Link
            href={`/teacher/classes/${id}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à la classe
          </Link>
        }
      />

      <div className="mt-6">
        <GradebookInsights data={data} />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">Carnet de notes</h2>
          <p className="text-[11px] text-slate-500">
            Saisissez les notes, créez de nouvelles évaluations et publiez vos brouillons
            ci-dessous.
          </p>
        </div>
        <Gradebook initial={data} teachingAssignmentId={id} />
      </section>
    </PortalShell>
  );
}
