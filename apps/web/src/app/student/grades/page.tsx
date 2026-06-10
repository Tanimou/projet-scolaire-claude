import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionHeader,
  SubjectChip,
  formatGrade,
  gradeVerdict,
} from '@pilotage/ui';
import type { StudentGradeRow, StudentGradesResponse } from '@pilotage/contracts';

import { StudentActivationGate } from '../_components/StudentActivationGate';
import { fetchStudentMe } from '../_lib/student-me';
import { StudentGradeCard } from './StudentGradeCard';
import { StudentTermFilter } from './StudentTermFilter';

export const metadata: Metadata = { title: 'Mes notes' };
export const dynamic = 'force-dynamic';

type GradesFetch = { data: StudentGradeRow[] } | { error: true };

async function fetchGrades(): Promise<GradesFetch> {
  try {
    const res = await api<StudentGradesResponse>('/api/v1/student/grades', { cache: 'no-store' });
    return { data: res.data ?? [] };
  } catch (err) {
    if (err instanceof ApiError) return { error: true };
    throw err;
  }
}

/** /20 equivalent for a single grade (null when absent / unscored). */
function valueOn20(g: StudentGradeRow): number | null {
  if (g.isAbsent || g.value == null) return null;
  const max = Number(g.assessment.maxScore);
  const raw = Number(g.value);
  if (!Number.isFinite(raw) || !Number.isFinite(max) || max <= 0) return null;
  return (raw / max) * 20;
}

export default async function StudentGradesPage({
  searchParams,
}: {
  searchParams: Promise<{ termId?: string }>;
}) {
  const sp = await searchParams;

  const me = await fetchStudentMe();

  // Unlinked account → the calm full-page activation gate, inside the shell so
  // the learner still sees they're in their own space. Never a leak, never a 500.
  if (!me.activated || !me.student) {
    return (
      <PortalShell portal="student" title="Mes notes" subtitle="Ton espace élève">
        <StudentActivationGate />
      </PortalShell>
    );
  }

  const headerName = me.student.firstName || 'Élève';
  const classLabel = me.student.classSectionName;
  const shellSubtitle = classLabel
    ? `${headerName} · ${classLabel}`
    : headerName;

  const grades = await fetchGrades();

  if ('error' in grades) {
    return (
      <PortalShell portal="student" title="Mes notes" subtitle={shellSubtitle}>
        <PageHeader title="Mes notes" subtitle="Tes notes publiées, matière par matière" />
        <ErrorState
          title="Impossible de charger tes notes pour le moment"
          description="Réessaie dans un instant."
          className="mt-6"
        />
      </PortalShell>
    );
  }

  const allGrades = grades.data;

  // Derive the term filter options from the loaded set (always matches what the
  // learner can actually see).
  const termMap = new Map<string, { id: string; name: string }>();
  for (const g of allGrades) {
    if (g.assessment.term && !termMap.has(g.assessment.term.id)) {
      termMap.set(g.assessment.term.id, { id: g.assessment.term.id, name: g.assessment.term.name });
    }
  }
  const terms = Array.from(termMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const activeTermId = sp.termId && termMap.has(sp.termId) ? sp.termId : '';

  const filtered = activeTermId
    ? allGrades.filter((g) => g.assessment.term?.id === activeTermId)
    : allGrades;

  // Group by subject, preserving a stable French sort.
  const bySubject = new Map<
    string,
    { id: string; name: string; color: string | null; rows: StudentGradeRow[] }
  >();
  for (const g of filtered) {
    const s = g.assessment.subject;
    const entry = bySubject.get(s.id) ?? { id: s.id, name: s.name, color: s.color, rows: [] };
    entry.rows.push(g);
    bySubject.set(s.id, entry);
  }
  const subjects = Array.from(bySubject.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );

  return (
    <PortalShell portal="student" title="Mes notes" subtitle={shellSubtitle}>
      <PageHeader
        title="Mes notes"
        subtitle="Tes notes publiées, matière par matière"
        actions={<StudentTermFilter terms={terms} termId={activeTermId} />}
      />

      {allGrades.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          tone="violet"
          title="Tes notes apparaîtront ici"
          description="Dès qu'un professeur publie une note, tu la retrouveras ici, matière par matière."
          className="mt-6"
        />
      ) : subjects.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          tone="slate"
          title="Aucune note pour ce trimestre"
          description="Choisis un autre trimestre ou reviens à « Toute l'année » pour voir toutes tes notes."
          className="mt-6"
        />
      ) : (
        <div className="mt-6 space-y-8">
          {subjects.map((subject) => {
            // The learner's OWN subject average — no class-average / rank chip.
            const values = subject.rows
              .map(valueOn20)
              .filter((v): v is number => v != null);
            const avg =
              values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
            const verdict = gradeVerdict(avg);

            return (
              <section key={subject.id} aria-label={subject.name}>
                <SectionHeader
                  title={
                    <span className="flex items-center gap-2">
                      <SubjectChip subjectCode={subject.name} label={subject.name} size="sm" />
                    </span>
                  }
                  rightSlot={
                    avg != null ? (
                      <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
                        <span className="font-mono text-lg font-bold tabular-nums text-slate-900">
                          {formatGrade(avg, 1)}
                          <span className="text-xs font-bold text-slate-400"> / 20</span>
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          {verdict}
                        </span>
                      </span>
                    ) : undefined
                  }
                />
                <div className="space-y-3">
                  {subject.rows.map((g) => (
                    <StudentGradeCard key={g.id} grade={g} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </PortalShell>
  );
}
