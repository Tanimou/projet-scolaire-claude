import type { AcademicYearScope } from '@pilotage/contracts';
import {
  AcademicYearScopeBadge,
  EmptyState,
  KpiCard,
  PageHeader,
  academicYearScopeState,
} from '@pilotage/ui';
import { BookOpen, GraduationCap, Layers, Users } from 'lucide-react';
import type { Metadata } from 'next';

import { TeacherClassesGrid, type ClassCardData } from './TeacherClassesGrid';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';


export const metadata: Metadata = { title: 'Mes classes' };
export const dynamic = 'force-dynamic';

interface AssignmentRow {
  id: string;
  isMainTeacher: boolean;
  weeklyHours: string | null;
  classSection: {
    id: string;
    name: string;
    maxStudents: number;
    gradeLevel: { name: string; cycle: { name: string; color: string | null } };
    _count: { enrollments: number };
  };
  subject: {
    id: string;
    code: string;
    name: string;
    color: string | null;
    defaultCoefficient: string;
  };
  academicYear: { id: string; name: string; status: string };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/**
 * La PORTÉE d'année de cette page (S-E03-16 / ADR-090).
 *
 * `activeAcademicYearId` reste l'id nu que la page ignorait ; `activeAcademicYear`
 * porte la résolution complète — nom, bornes, `isStale`, `staleByDays` — calculée
 * UNE fois par `SchoolContextService` et jusqu'ici JETÉE.
 *
 * ⛔ Rien ici ne FILTRE, ne trie ni ne masque sur `isStale` ou
 * `containsReferenceDate` : sur les données mesurées le 2026-08-30, AUCUNE des
 * deux années actives ne contient aujourd'hui (56 et 786 jours après leur fin),
 * donc sélectionner sur la vétusté viderait le portail. La vétusté est
 * RAPPORTÉE, jamais CHOISIE (ADR-070, ADR-090). Les seules lectures de ces
 * champs ci-dessous sont des choix de LIBELLÉ.
 */
interface AssignmentsResponse {
  data: AssignmentRow[];
  activeAcademicYearId: string | null;
  activeAcademicYear: AcademicYearScope | null;
}

export default async function TeacherClassesPage() {
  const resp = await safe(
    api<AssignmentsResponse>('/api/v1/teachers/me/assignments', { cache: 'no-store' }),
  );
  const assignments = resp?.data ?? [];

  // TROIS cas, tenus distincts, parce que le badge les rend différemment :
  //   • `undefined` — la lecture a ÉCHOUÉ (`safe()` avale l'`ApiError`) ou le champ
  //     est absent (fenêtre de déploiement web-neuf / api-ancienne) ⇒ « portée
  //     indisponible ». Un échec de lecture n'est jamais un fait métier.
  //   • `null`      — l'API a résolu et répond « aucune année active ».
  //   • un objet    — la portée résolue.
  // Aucun de ces cas ne cache la moindre classe : la liste rendue est exactement
  // celle d'avant cette tranche.
  const yearScope: AcademicYearScope | null | undefined =
    resp === null ? undefined : resp.activeAcademicYear;
  const scopeState = academicYearScopeState(yearScope);
  const yearName = yearScope?.name ?? null;

  // Group assignments by class section. We keep `primaryAssignmentId` (the first
  // teachingAssignment.id we see for this class) so the action buttons have a
  // sensible default; individual subject chips link to their own assignment.
  const byClass = new Map<string, ClassCardData>();
  for (const a of assignments) {
    const key = a.classSection.id;
    const cur =
      byClass.get(key) ??
      ({
        classSectionId: a.classSection.id,
        primaryAssignmentId: a.id,
        className: a.classSection.name,
        gradeLevelName: a.classSection.gradeLevel.name,
        cycleName: a.classSection.gradeLevel.cycle.name,
        cycleColor: a.classSection.gradeLevel.cycle.color,
        enrolledCount: a.classSection._count.enrollments,
        maxStudents: a.classSection.maxStudents,
        subjects: [] as ClassCardData['subjects'],
        isMainTeacher: false,
        weeklyHours: 0,
      } as ClassCardData);
    cur.subjects.push({
      id: a.subject.id,
      code: a.subject.code,
      name: a.subject.name,
      coefficient: Number(a.subject.defaultCoefficient),
      assignmentId: a.id,
    });
    if (a.isMainTeacher) cur.isMainTeacher = true;
    cur.weeklyHours += Number(a.weeklyHours ?? 0);
    byClass.set(key, cur);
  }

  const classes = [...byClass.values()].sort((a, b) => a.className.localeCompare(b.className));

  const totalClasses = classes.length;
  const totalSubjects = new Set(assignments.map((a) => a.subject.id)).size;
  // SOMME d'effectifs — donc des INSCRIPTIONS, pas des élèves (S-E03-7 / ADR-079).
  //
  // La valeur ne change pas dans cette tranche ; c'est son NOM qui était faux.
  // Un élève inscrit dans deux des classes de l'enseignant compte deux fois
  // ici, et rien en base ne l'en empêche : l'index unique partiel promis par
  // `schema.prisma` (« au plus une inscription active par élève et par année »)
  // n'existe pas (PF-361/PF-409). Cette somme est donc honnête comme somme de
  // LIGNES d'inscription, et fausse comme nombre d'élèves. Le nombre d'élèves
  // distincts est une LECTURE, jamais une somme : il est rendu par la carte
  // matière du tableau de bord (`distinctStudentCount`).
  const totalEnrolments = classes.reduce((s, c) => s + c.enrolledCount, 0);
  const mainTeacherOf = classes.filter((c) => c.isMainTeacher).length;

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Mes classes' },
        ]}
        title="Mes classes"
        subtitle={
          yearName
            ? `Toutes les classes où vous intervenez sur l'année ${yearName} — cliquez pour la gradebook, la présence et le cahier de texte`
            : 'Toutes les classes où vous intervenez — cliquez pour la gradebook, la présence et le cahier de texte'
        }
      />

      {/* UNE pastille, pas deux. La phrase de portée n'apparaît que quand elle apprend
          quelque chose : sur une année en cours elle répète la pastille et devient du
          bruit. Le renvoi est une PHRASE et non un lien — un enseignant n'ouvre pas une
          année scolaire, coder ici l'action d'administration serait faux pour ce portail. */}
      <div className="mt-3">
        <AcademicYearScopeBadge
          year={yearScope}
          variant={scopeState === 'current' || scopeState === 'last_day' ? 'inline' : 'block'}
          action={
            scopeState === 'stale' || scopeState === 'none' ? (
              <span className="text-slate-600">
                Contactez l&apos;administration de l&apos;établissement.
              </span>
            ) : undefined
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Users}
          tone="blue"
          label="CLASSES"
          value={totalClasses}
          scope={
            yearName
              ? `Classes où vous intervenez sur l'année ${yearName}.`
              : 'Classes où vous intervenez.'
          }
        />
        {/* `INSCRIPTIONS`, pas `ÉLÈVES` : la valeur est un `reduce(+)` d'effectifs.
            Une carte étiquetée « ÉLÈVES » ne doit jamais porter un cumul — la
            portée sous le nombre ne rattrape pas un nom déjà faux, elle ne fait
            que le rendre à moitié honnête. */}
        <KpiCard
          icon={Layers}
          tone="violet"
          label="INSCRIPTIONS"
          value={totalEnrolments}
          scope={`Somme des effectifs de vos ${totalClasses} classe${
            totalClasses > 1 ? 's' : ''
          }. Un élève inscrit dans deux d'entre elles est compté deux fois.`}
        />
        <KpiCard
          icon={BookOpen}
          tone="green"
          label="MATIÈRES"
          value={totalSubjects}
          scope="Matières distinctes que vous enseignez."
        />
        <KpiCard
          icon={GraduationCap}
          tone="amber"
          label="PROF PRINCIPAL"
          value={mainTeacherOf}
          scope={
            mainTeacherOf > 0
              ? 'Classes dont vous êtes le professeur principal.'
              : 'Vous n’êtes professeur principal d’aucune classe.'
          }
        />
      </div>

      {classes.length === 0 ? (
        <section className="mt-6">
          {/* Le diagnostic dépend de la PORTÉE, pas seulement du vide : « aucune
              classe ne vous a été assignée » est faux quand la vraie cause est
              qu'aucune année plus récente n'a été ouverte. On change le TEXTE,
              jamais la visibilité — l'état vide s'affiche exactement dans les
              mêmes cas qu'avant. */}
          <EmptyState
            icon={Users}
            title={yearName ? `Aucune affectation sur l'année ${yearName}` : 'Aucune affectation'}
            description={
              scopeState === 'stale'
                ? "Aucune classe ne vous a été assignée sur cette année, et aucune année plus récente n'a été ouverte. Contactez l'administration de l'établissement."
                : "Aucune classe ne vous a été assignée. Contactez l'administration de l'établissement."
            }
            tone="slate"
          />
        </section>
      ) : (
        <TeacherClassesGrid classes={classes} />
      )}
    </PortalShell>
  );
}
