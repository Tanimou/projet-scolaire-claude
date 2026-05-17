import { BookOpen, GraduationCap, Layers, UserX } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { KpiCard, PageHeader } from '@pilotage/ui';

import { SubjectsManager } from './SubjectsManager';

export const metadata: Metadata = { title: 'Matières & coefficients' };
export const dynamic = 'force-dynamic';

export interface SubjectItem {
  id: string;
  code: string;
  name: string;
  defaultCoefficient: number;
  color: string | null;
  icon: string | null;
  active: boolean;
}

export interface CoefficientMatrix {
  subjects: SubjectItem[];
  gradeLevels: { id: string; code: string; name: string; orderIndex: number; cycleId: string }[];
  coefficients: { gradeLevelId: string; subjectId: string; coefficient: number }[];
}

interface SubjectListItem extends SubjectItem {
  _count?: { teachingAssignments?: number };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function SubjectsPage() {
  const [matrix, subjects] = await Promise.all([
    safe(
      api<CoefficientMatrix>('/api/v1/subjects/coefficients/matrix', { cache: 'no-store' }),
    ),
    safe(api<{ data: SubjectListItem[] }>('/api/v1/subjects', { cache: 'no-store' })),
  ]);

  const subjectList = subjects?.data ?? [];
  const matrixCoefs = matrix?.coefficients ?? [];
  const matrixLevels = matrix?.gradeLevels ?? [];

  const activeSubjects = subjectList.filter((s) => s.active).length;
  const coefsConfigured = matrixCoefs.length;
  const levelsCovered = new Set(matrixCoefs.map((c) => c.gradeLevelId)).size;
  const subjectsWithoutTeacher = subjectList.filter(
    (s) => (s._count?.teachingAssignments ?? 0) === 0,
  ).length;
  void matrixLevels; // referenced for clarity even when unused below

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Matières' },
        ]}
        title="Matières & coefficients"
        subtitle="Définissez les matières enseignées et leur coefficient par niveau pour le calcul des moyennes pondérées"
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={BookOpen} tone="blue" label="MATIÈRES ACTIVES" value={activeSubjects}>
          {subjectList.length} matières au total
        </KpiCard>
        <KpiCard
          icon={Layers}
          tone="green"
          label="COEFFICIENTS CONFIGURÉS"
          value={coefsConfigured}
        >
          Croisements matière × niveau
        </KpiCard>
        <KpiCard
          icon={GraduationCap}
          tone="violet"
          label="NIVEAUX COUVERTS"
          value={levelsCovered}
        >
          Avec au moins un coefficient
        </KpiCard>
        <KpiCard
          icon={UserX}
          tone="orange"
          label="MATIÈRES SANS ENSEIGNANT"
          value={subjectsWithoutTeacher}
        >
          À pourvoir
        </KpiCard>
      </div>

      <p className="mt-6 text-sm text-slate-600">
        Les coefficients sont utilisés dans le calcul des moyennes pondérées. Une matière peut
        avoir un coefficient par défaut, surchargé par niveau.
      </p>

      <div className="mt-6">
        {matrix ? (
          <SubjectsManager allSubjects={subjectList} matrix={matrix} />
        ) : (
          <p className="text-sm text-amber-700">
            Impossible de charger la matrice des coefficients. Vérifiez que l&apos;API répond.
          </p>
        )}
      </div>
    </PortalShell>
  );
}
