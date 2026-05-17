import { AlertCircle, ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';

import { Gradebook } from './Gradebook';

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

  return (
    <PortalShell portal="teacher">
      <Link
        href={`/teacher/classes/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à la classe
      </Link>
      <div className="mt-4">
        <div className="text-xs text-slate-500">
          {data.assignment.classSection.gradeLevel.cycle?.name} ·{' '}
          {data.assignment.classSection.name} · {data.assignment.subject.name}
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Notes & évaluations</h1>
        <p className="mt-1 text-sm text-slate-600">
          Coefficient de base de la matière à ce niveau : <strong>{data.assignment.baseCoefficient}</strong>.
          Vous pouvez surcharger ce coefficient sur chaque évaluation individuelle.
        </p>
      </div>
      <div className="mt-6">
        <Gradebook initial={data} teachingAssignmentId={id} />
      </div>
    </PortalShell>
  );
}
