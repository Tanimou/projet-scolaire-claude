import { KpiCard, PageHeader } from '@pilotage/ui';
import { BookOpen, ClipboardCheck, GraduationCap, UserX } from 'lucide-react';
import type { Metadata } from 'next';

import { AssignmentsManager } from '@/app/admin/teaching-assignments/AssignmentsManager';
import { teachingAssignmentsEnvelope } from '@/app/admin/teaching-assignments/types';
import type {
  ClassOption,
  SubjectOption,
  TeacherOption,
} from '@/app/admin/teaching-assignments/types';
import { PortalShell } from '@/components/PortalShell';
import { api, apiEnvelope, ApiError } from '@/lib/api-client';

export const metadata: Metadata = { title: 'Affectations' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/**
 * Fenêtre demandée à `GET /api/v1/teaching-assignments`. L'endpoint accepte
 * `limit`/`offset` par le résolveur canonique (défaut 100, max 500) : la page
 * demande **explicitement** sa fenêtre plutôt que de dépendre du défaut serveur,
 * pour que le `pageSize` du pied de page et le `take` de la requête soient un
 * seul nombre écrit à un seul endroit.
 */
const PAGE_SIZE = 100;

/**
 * `?page=abc` donne `NaN`, et `NaN` donne un `offset` `NaN` — c'est le jumeau
 * web du défaut que ce slice ferme côté API (AC-3). On normalise ici plutôt que
 * de laisser l'API rendre un 400 : le 400 est un contrat pour un appelant
 * d'API, pas un écran pour un administrateur.
 */
function safePage(raw: string | undefined): number {
  const n = Number(raw);
  return Math.max(1, Number.isFinite(n) ? Math.trunc(n) : 1);
}

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    classSectionId?: string;
    teacherProfileId?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = safePage(sp.page);
  const offset = (page - 1) * PAGE_SIZE;
  const filterClass = sp.classSectionId ?? '';
  const filterTeacher = sp.teacherProfileId ?? '';

  // Les filtres partent au serveur : l'endpoint accepte déjà `classSectionId`
  // et `teacherProfileId`. Filtrer dans le navigateur sur une page bornée
  // rendrait « Aucune affectation pour ces filtres » à partir d'une frontière de
  // page, c'est-à-dire une affirmation de vide sur un établissement non vide.
  const qs = new URLSearchParams();
  qs.set('limit', String(PAGE_SIZE));
  qs.set('offset', String(offset));
  if (filterClass) qs.set('classSectionId', filterClass);
  if (filterTeacher) qs.set('teacherProfileId', filterTeacher);

  const [assignmentsResp, teachersResp, classesResp, subjectsResp] = await Promise.all([
    // S-E03-11 / AC-3 — ANALYSÉE, plus affirmée. C'est précisément ici que le
    // renommage `totals` → `summary` du run 94 devient une erreur nommée au
    // lieu d'un `undefined` rendu en tirets cadratins. `ResponseShapeError`
    // n'est PAS une `ApiError`, donc `safe()` la re-jette vers
    // `app/admin/error.tsx` au lieu de la déguiser en panne d'API.
    safe(
      apiEnvelope(teachingAssignmentsEnvelope, `/api/v1/teaching-assignments?${qs.toString()}`, {
        cache: 'no-store',
      }),
    ),
    safe(api<{ data: TeacherOption[] }>('/api/v1/teachers', { cache: 'no-store' })),
    safe(api<{ data: ClassOption[] }>('/api/v1/classes', { cache: 'no-store' })),
    safe(api<{ data: SubjectOption[] }>('/api/v1/subjects', { cache: 'no-store' })),
  ]);

  const assignments = assignmentsResp?.data ?? [];
  const teachers = teachersResp?.data ?? [];
  const classes = classesResp?.data ?? [];
  const subjects = subjectsResp?.data ?? [];

  // ─────────────────────────────────────────────────────────────────────────
  // KPI — S-E03-9 / AC-5a. Chaque chiffre vient d'un agrégat SERVEUR calculé
  // sur l'ensemble filtré (`totals`), jamais du tableau `assignments`, qui est
  // désormais une page. Aucun `.length` et aucun `new Set(assignments…)` ne
  // subsiste dans ce fichier : c'est la règle DNC-01, et c'est exactement le
  // défaut que ce slice aurait fabriqué en bornant l'endpoint sans elle.
  //
  // Une lecture échouée (`safe()` → `null`) n'est PAS un zéro. Un `0` affiché
  // ici serait une invention : la carte passe en `unavailable` et affiche « — ».
  // ─────────────────────────────────────────────────────────────────────────
  // Le nom de ce bloc est `totals`, celui d'`ADR-080 §D4`. Il l'était déjà côté
  // API ; c'est cette page qui lisait `summary`, le nom du bloc `contract` de
  // l'histoire, et lisait donc `undefined` sur CHAQUE réponse réussie.
  const totals = assignmentsResp?.totals ?? null;
  const total = assignmentsResp?.total ?? null;

  // « MATIÈRES SANS ENSEIGNANT » est un agrégat serveur, pas une différence
  // faite ici entre deux lectures indépendamment bornées (ADR-080 §D4).
  const subjectsWithoutTeacher = totals ? totals.subjectsWithoutTeacher : null;

  const filtersApplied = Boolean(filterClass || filterTeacher);
  const filterScopeSuffix = filtersApplied ? ' Filtres appliqués.' : '';
  const UNAVAILABLE_SCOPE = "Mesure indisponible — aucun chiffre n'est affiché.";

  const totalPages = total === null ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));
  const listState: 'error' | 'out-of-range' | 'ok' =
    assignmentsResp === null ? 'error' : page > totalPages ? 'out-of-range' : 'ok';

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Affectations' },
        ]}
        title="Affectations professeurs"
        subtitle="Une affectation = un trio Professeur × Classe × Matière. Un PP par classe."
      />

      {/* KPI strip — portée écrite sur chaque carte (AC-5c). */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={ClipboardCheck}
          tone="blue"
          label="AFFECTATIONS ACTIVES"
          value={totals ? totals.assignments : '—'}
          state={totals ? 'measured' : 'unavailable'}
          scope={
            totals
              ? `Toutes les affectations de l'établissement — pas seulement cette page.${filterScopeSuffix}`
              : UNAVAILABLE_SCOPE
          }
        >
          Trios Prof × Classe × Matière
        </KpiCard>

        <KpiCard
          icon={GraduationCap}
          tone="green"
          label="ENSEIGNANTS AFFECTÉS"
          value={totals ? totals.teachers : '—'}
          state={totals ? 'measured' : 'unavailable'}
          scope={
            totals
              ? `Enseignants distincts sur l'ensemble des affectations.${filterScopeSuffix}`
              : UNAVAILABLE_SCOPE
          }
        >
          {teachersResp
            ? `${teachers.length} enseignants au total`
            : "Effectif enseignant non lu — non comparé"}
        </KpiCard>

        <KpiCard
          icon={BookOpen}
          tone="violet"
          label="CLASSES COUVERTES"
          value={totals ? totals.classes : '—'}
          state={totals ? 'measured' : 'unavailable'}
          scope={
            totals
              ? `Classes distinctes sur l'ensemble des affectations.${filterScopeSuffix}`
              : UNAVAILABLE_SCOPE
          }
        >
          {classesResp ? `${classes.length} classes au total` : 'Liste des classes non lue'}
        </KpiCard>

        <KpiCard
          icon={UserX}
          tone="orange"
          label="MATIÈRES SANS ENSEIGNANT"
          value={subjectsWithoutTeacher ?? '—'}
          state={subjectsWithoutTeacher === null ? 'unavailable' : 'measured'}
          scope={
            subjectsWithoutTeacher === null
              ? UNAVAILABLE_SCOPE
              : `Matières sans aucune affectation, comptées côté serveur sur l'établissement.${filterScopeSuffix}`
          }
        >
          À pourvoir
        </KpiCard>
      </div>

      <div className="mt-6">
        <AssignmentsManager
          assignments={assignments}
          teachers={teachers}
          classes={classes}
          subjects={subjects}
          total={total}
          coverage={assignmentsResp?.coverage ?? null}
          page={page}
          pageSize={PAGE_SIZE}
          totalPages={totalPages}
          filterClass={filterClass}
          filterTeacher={filterTeacher}
          listState={listState}
        />
      </div>
    </PortalShell>
  );
}
