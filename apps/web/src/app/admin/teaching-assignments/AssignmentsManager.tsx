'use client';

import { ErrorState, Pagination } from '@pilotage/ui';
import { Crown, Loader2, Plus, Star, Trash2, UserCheck, UserCog } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition } from 'react';

import { createAssignment, deleteAssignment, updateAssignment } from './actions';
import type {
  Assignment,
  AssignmentRole,
  AssignmentsCoverage,
  ClassOption,
  SubjectOption,
  TeacherOption,
} from './types';

// Re-export so the new `/admin/assignments` page can import types via this module
export type {
  Assignment,
  AssignmentRole,
  AssignmentsCoverage,
  AssignmentsTotals,
  ClassOption,
  SubjectOption,
  TeacherOption,
  TeachingAssignmentsResponse,
} from './types';

/** Libellés FR des rôles d'affectation. */
const ROLE_LABELS: Record<AssignmentRole, string> = {
  principal: 'Professeur principal',
  assistant: 'Assistant',
  subject_teacher: 'Prof. de matière',
};

/**
 * Détecte les cycles primaire / maternelle à partir du nom du cycle (les écoles
 * nomment librement leurs cycles, mais les libellés usuels contiennent l'un de
 * ces mots-clés). Sert à exiger un assistant sur ces cycles.
 */
export function isPrimaryOrKindergarten(cycleName: string): boolean {
  const n = cycleName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return (
    n.includes('matern') ||
    n.includes('primaire') ||
    n.includes('elementaire') ||
    n.includes('prescol')
  );
}

/**
 * S-E03-9 (PF-50) — le contrat de ce composant a CHANGÉ.
 *
 * Avant : « donne-moi tout » — `assignments` était l'ensemble des affectations
 * du tenant, et chaque chiffre rendu ici était une longueur de tableau.
 * Depuis que `GET /api/v1/teaching-assignments` est borné, `assignments` est
 * **une page**. Trois conséquences, toutes appliquées ci-dessous :
 *
 *  1. Le compteur d'en-tête lit `total` (agrégat serveur), pas `assignments.length`.
 *  2. Le panneau de couverture lit `coverage` (agrégats serveur de portée
 *     établissement : classes avec PP, classes avec assistant, matières
 *     pourvues) et jamais `assignments`. Une
 *     alerte « classe sans professeur principal » déduite d'une page serait une
 *     fausse accusation sur une surface de gouvernance, et la bannière verte
 *     « Couverture complète » une affirmation d'ensemble tirée de 100 lignes
 *     sur 290.
 *  3. Les filtres classe/professeur passent par l'URL et par l'API (paramètres
 *     `classSectionId` / `teacherProfileId`, déjà acceptés) : filtrer dans le
 *     navigateur ne verrait que la page courante et rendrait « aucune
 *     affectation » sur un établissement non vide.
 *
 * `total` et `coverage` sont `null` quand la lecture a échoué. Un
 * `0` de repli serait une invention : chaque surface concernée le dit alors en
 * toutes lettres au lieu d'afficher un chiffre.
 */
export function AssignmentsManager({
  assignments,
  teachers,
  classes,
  subjects,
  total,
  coverage,
  page,
  pageSize,
  totalPages,
  filterClass,
  filterTeacher,
  listState,
}: {
  /** La **page** courante, pas l'ensemble. */
  assignments: Assignment[];
  teachers: TeacherOption[];
  classes: ClassOption[];
  subjects: SubjectOption[];
  /** `count(where)` serveur sur l'ensemble filtré. `null` = lecture échouée. */
  total: number | null;
  coverage: AssignmentsCoverage | null;
  page: number;
  pageSize: number;
  totalPages: number;
  filterClass: string;
  filterTeacher: string;
  listState: 'ok' | 'error' | 'out-of-range';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Un changement de filtre est une navigation serveur, et il **remet la
   * pagination à 1** : rester en page 7 après avoir restreint le jeu à trois
   * lignes rendrait une page vide qui ressemble à « il n'y a rien ».
   */
  const setFilter = useCallback(
    (key: 'classSectionId' | 'teacherProfileId', value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (value) params.set(key, value);
      else params.delete(key);
      params.delete('page');
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [router, pathname, searchParams],
  );

  const resetFilters = useCallback(() => {
    startTransition(() => {
      router.push(pathname);
    });
  }, [router, pathname]);

  const filtersApplied = Boolean(filterClass || filterTeacher);

  // Regroupement par classe **de la page courante**. Aucun filtrage ici : le
  // serveur a déjà appliqué `classSectionId` / `teacherProfileId`.
  const grouped = useMemo(() => {
    const byClass = new Map<string, { cls: Assignment['classSection']; year: Assignment['academicYear']; items: Assignment[] }>();
    for (const a of assignments) {
      if (!byClass.has(a.classSection.id))
        byClass.set(a.classSection.id, { cls: a.classSection, year: a.academicYear, items: [] });
      byClass.get(a.classSection.id)!.items.push(a);
    }
    return [...byClass.values()];
  }, [assignments]);

  const truncated = total !== null && assignments.length < total;
  const rangeStart = total === null || total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = total === null ? assignments.length : Math.min(total, page * pageSize);

  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>
      )}

      <CoveragePanel classes={classes} subjects={subjects} coverage={coverage} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="filter-class">
          Filtrer par classe
        </label>
        <select
          id="filter-class"
          value={filterClass}
          disabled={pending}
          onChange={(e) => setFilter('classSectionId', e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 sm:w-auto"
        >
          <option value="">Toutes les classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.gradeLevel.cycle.name} · {c.name} ({c.gradeLevel.name})
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="filter-teacher">
          Filtrer par professeur
        </label>
        <select
          id="filter-teacher"
          value={filterTeacher}
          disabled={pending}
          onChange={(e) => setFilter('teacherProfileId', e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 sm:w-auto"
        >
          <option value="">Tous les professeurs</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.userProfile.lastName.toUpperCase()} {t.userProfile.firstName}
            </option>
          ))}
        </select>
        {filtersApplied && (
          <button
            type="button"
            onClick={resetFilters}
            disabled={pending}
            className="inline-flex min-h-8 items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
          >
            Réinitialiser les filtres
          </button>
        )}
        {/* Un seul total, dérivé de l'agrégat serveur — jamais `assignments.length`. */}
        <span className="ml-auto text-xs text-slate-500">
          {total === null ? 'Total indisponible' : `${total.toLocaleString('fr-FR')} affectation(s)`}
        </span>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-500/30 focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-auto"
          >
            <Plus className="h-4 w-4" /> Nouvelle affectation
          </button>
        )}
      </div>

      {truncated && (
        <p className="text-[11px] text-slate-600">
          Affichage des {assignments.length} affectations de cette page sur{' '}
          {total?.toLocaleString('fr-FR')}. Affinez les filtres ou changez de page pour voir les
          autres.
        </p>
      )}

      {creating && (
        <NewAssignmentForm
          teachers={teachers}
          classes={classes}
          subjects={subjects}
          onCancel={() => setCreating(false)}
          onSuccess={() => {
            setCreating(false);
            router.refresh();
          }}
          onError={setError}
        />
      )}

      {/* SC 4.1.3 — le résultat d'un changement de filtre ou de page est annoncé.
          `Pagination` masque son résumé quand tout tient sur une page : cette
          région, elle, existe toujours. */}
      <p role="status" aria-live="polite" className="sr-only">
        {total === null
          ? 'Le nombre d’affectations n’a pas pu être lu.'
          : `Affichage de ${rangeStart} à ${rangeEnd} sur ${total} affectations.`}
      </p>

      <section
        aria-label="Affectations"
        aria-busy={pending ? 'true' : undefined}
        className={pending ? 'opacity-70 transition-opacity' : 'transition-opacity'}
      >
        {listState === 'error' ? (
          // Une lecture échouée n'est PAS une affirmation de vide : rendre une
          // liste vide dirait « cette école n'a aucune affectation ».
          <ErrorState
            title="Impossible de charger les affectations."
            description="La lecture a échoué. Aucun chiffre n’est affiché tant que la liste n’a pas pu être lue."
          />
        ) : listState === 'out-of-range' ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm text-slate-600">
              Cette page n’existe plus ({totalPages} page(s) au total).
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-3 inline-flex min-h-8 items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Revenir à la première page
            </button>
          </div>
        ) : grouped.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <UserCheck className="mx-auto h-10 w-10 text-slate-300" />
            {/* Deux phrases distinctes : un état de l'école ≠ un état de la requête. */}
            {filtersApplied ? (
              <>
                <p className="mt-3 text-sm text-slate-600">
                  Aucune affectation ne correspond à ces filtres.
                </p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 inline-flex min-h-8 items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Réinitialiser les filtres
                </button>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-slate-600">
                  Aucune affectation. Créez-en une pour démarrer.
                </p>
                {!creating && (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-500/30 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <Plus className="h-4 w-4" /> Nouvelle affectation
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(({ cls, year, items }) => (
            <section
              key={cls.id}
              className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200"
            >
              <header
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                style={{ background: `color-mix(in oklch, ${cls.gradeLevel.cycle.color ?? 'oklch(0.62 0.18 250)'} 10%, white)` }}
              >
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {cls.gradeLevel.cycle.name} · {cls.gradeLevel.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{cls.name}</h3>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      {year.name}
                    </span>
                  </div>
                </div>
                {/*
                  Les affectations d'une classe peuvent enjamber une frontière de
                  page : ce chiffre est donc reformulé, pas re-dérivé. Il dit ce
                  qu'il compte — les lignes rendues ici — et ne prétend plus
                  « matières couvertes / possibles », qui était une affirmation
                  d'ensemble.
                */}
                <span className="text-xs text-slate-500">
                  {items.length} affectation(s) sur cette page
                </span>
              </header>

              <ul className="divide-y divide-slate-100">
                {items.map((a) => (
                  <Row
                    key={a.id}
                    a={a}
                    onDelete={async () => {
                      if (!confirm(`Retirer ${a.teacherProfile.userProfile.firstName} de ${a.subject.name} en ${a.classSection.name} ?`)) return;
                      setBusy(true);
                      const res = await deleteAssignment(a.id);
                      setBusy(false);
                      if (!res.ok) setError(res.error);
                      else router.refresh();
                    }}
                    onChangeRole={async (role) => {
                      setBusy(true);
                      const res = await updateAssignment(a.id, { role });
                      setBusy(false);
                      if (!res.ok) setError(res.error);
                      else router.refresh();
                    }}
                    busy={busy}
                  />
                ))}
              </ul>
            </section>
            ))}
          </div>
        )}

        {listState === 'ok' && total !== null && (
          <Pagination
            page={page}
            total={total}
            pageSize={pageSize}
            itemLabel={{ singular: 'affectation', plural: 'affectations' }}
            className="mt-4 rounded-2xl border border-slate-200"
          />
        )}
      </section>
    </div>
  );
}

/** Badge visuel du rôle : principal = couronne ambre, assistant = bleu, matière = neutre. */
function RoleBadge({ role }: { role: AssignmentRole }) {
  if (role === 'principal') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
        <Crown className="h-3 w-3" /> Principal
      </span>
    );
  }
  if (role === 'assistant') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-700">
        <UserCog className="h-3 w-3" /> Assistant
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
      <Star className="h-3 w-3" /> Matière
    </span>
  );
}

function Row({
  a,
  onDelete,
  onChangeRole,
  busy,
}: {
  a: Assignment;
  onDelete: () => void;
  onChangeRole: (role: AssignmentRole) => void;
  busy: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-teal-100 to-emerald-100 text-xs font-bold text-emerald-700">
        {a.teacherProfile.userProfile.firstName[0]?.toUpperCase()}
        {a.teacherProfile.userProfile.lastName[0]?.toUpperCase()}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-slate-900">
          {a.teacherProfile.userProfile.lastName.toUpperCase()} {a.teacherProfile.userProfile.firstName}
        </div>
        <div className="text-xs text-slate-500">{a.teacherProfile.userProfile.email}</div>
      </div>
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold"
        style={{ background: `color-mix(in oklch, ${a.subject.color ?? 'oklch(0.6 0.15 250)'} 15%, white)`, color: `color-mix(in oklch, ${a.subject.color ?? 'oklch(0.6 0.15 250)'} 80%, black)` }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: a.subject.color ?? 'oklch(0.6 0.15 250)' }} />
        {a.subject.name}
      </span>
      {a.weeklyHours && (
        <span className="text-[11px] text-slate-500 font-mono">{Number(a.weeklyHours)}h/sem</span>
      )}
      <RoleBadge role={a.role} />
      <label className="sr-only" htmlFor={`role-${a.id}`}>
        Rôle de l&apos;enseignant
      </label>
      <select
        id={`role-${a.id}`}
        value={a.role}
        disabled={busy}
        onChange={(e) => onChangeRole(e.target.value as AssignmentRole)}
        title="Changer le rôle de l'enseignant sur cette affectation"
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 disabled:opacity-50"
      >
        <option value="principal">{ROLE_LABELS.principal}</option>
        <option value="assistant">{ROLE_LABELS.assistant}</option>
        <option value="subject_teacher">{ROLE_LABELS.subject_teacher}</option>
      </select>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        title="Supprimer cette affectation"
        className="grid h-7 w-7 place-items-center rounded-md text-red-500 hover:bg-red-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function NewAssignmentForm({
  teachers,
  classes,
  subjects,
  onCancel,
  onSuccess,
  onError,
}: {
  teachers: TeacherOption[];
  classes: ClassOption[];
  subjects: SubjectOption[];
  onCancel: () => void;
  onSuccess: () => void;
  onError: (e: string | null) => void;
}) {
  const [form, setForm] = useState<{
    teacherProfileId: string;
    classSectionId: string;
    subjectId: string;
    role: AssignmentRole;
    weeklyHours: string;
  }>({
    teacherProfileId: teachers[0]?.id ?? '',
    classSectionId: classes.find((c) => c.academicYear.status === 'active')?.id ?? '',
    subjectId: subjects[0]?.id ?? '',
    role: 'subject_teacher',
    weeklyHours: '',
  });
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        onError(null);
        const res = await createAssignment({
          teacherProfileId: form.teacherProfileId,
          classSectionId: form.classSectionId,
          subjectId: form.subjectId,
          role: form.role,
          ...(form.weeklyHours ? { weeklyHours: parseFloat(form.weeklyHours) } : {}),
        });
        setBusy(false);
        if (!res.ok) onError(res.error);
        else onSuccess();
      }}
      className="rounded-2xl bg-white p-6 ring-1 ring-slate-200"
    >
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Nouvelle affectation</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-bold text-slate-700 lg:col-span-2">
          Professeur
          <select
            value={form.teacherProfileId}
            onChange={(e) => setForm((f) => ({ ...f, teacherProfileId: e.target.value }))}
            required
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            {teachers.length === 0 && <option value="">— Aucun professeur dans l&apos;école —</option>}
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.userProfile.lastName.toUpperCase()} {t.userProfile.firstName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-700 lg:col-span-2">
          Classe (année active)
          <select
            value={form.classSectionId}
            onChange={(e) => setForm((f) => ({ ...f, classSectionId: e.target.value }))}
            required
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            {classes
              .filter((c) => c.academicYear.status === 'active' && c.status === 'active')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.gradeLevel.cycle.name} · {c.name} · {c.gradeLevel.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-700">
          Matière
          <select
            value={form.subjectId}
            onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))}
            required
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-700">
          Heures/sem (optionnel)
          <input
            type="number"
            step="0.5"
            min="0"
            max="40"
            value={form.weeklyHours}
            onChange={(e) => setForm((f) => ({ ...f, weeklyHours: e.target.value }))}
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-bold text-slate-700 lg:col-span-2">
          Rôle
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AssignmentRole }))}
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="subject_teacher">{ROLE_LABELS.subject_teacher} (collège/lycée)</option>
            <option value="principal">{ROLE_LABELS.principal} (un seul par classe)</option>
            <option value="assistant">{ROLE_LABELS.assistant} (primaire/maternelle)</option>
          </select>
        </label>
        <p className="self-end text-[11px] text-slate-500 lg:col-span-3">
          Le professeur principal est unique par classe : désigner un nouveau PP rétrograde
          l&apos;ancien en prof. de matière.
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy || !form.teacherProfileId || !form.classSectionId || !form.subjectId}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Créer
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

/**
 * Panneau « alertes de couverture ». Trois familles d'alertes :
 *   1. classe (active) sans professeur principal ;
 *   2. classe de cycle primaire/maternelle (active) sans assistant ;
 *   3. matière sans aucun enseignant affecté.
 * (La surcharge enseignant est traitée dans une autre unité.)
 *
 * **S-E03-9 / AC-5b — d'où viennent ces trois listes.** Elles sont la différence
 * entre deux ensembles de **portée globale** : le tableau `classes` (resp.
 * `subjects`), lu entier, et les listes d'ids renvoyées par les agrégats serveur
 * `coverage` (les trois listes d'ids), calculées sur tout l'ensemble
 * filtré et scopées `tenantId`.
 *
 * Elles ne touchent **jamais** le tableau `assignments`, qui n'est plus qu'une
 * page. Une alerte dérivée d'une page nommerait des classes qui ont bel et bien
 * un professeur principal, simplement absentes de la fenêtre courante : sur une
 * surface de gouvernance, c'est une fausse accusation qui génère du travail
 * humain. Et la bannière verte « Couverture complète » est le cas le plus
 * dangereux dans l'autre sens — un fait d'ensemble affirmé à partir de 100
 * lignes sur 290. Test de relecture : s'il existe une fenêtre de pagination sous
 * laquelle ce panneau change, cette règle est violée.
 *
 * Quand l'agrégat n'a pas pu être lu, le panneau le DIT. Il ne rend ni alertes
 * ni bannière verte : « nous n'avons pas pu lire » et « tout est couvert » sont
 * deux phrases différentes.
 */
function CoveragePanel({
  classes,
  subjects,
  coverage,
}: {
  classes: ClassOption[];
  subjects: SubjectOption[];
  /** Agrégat serveur sur tout l'ensemble filtré. `null` = lecture échouée. */
  coverage: AssignmentsCoverage | null;
}) {
  const alerts = useMemo(() => {
    if (!coverage) return null;

    const activeClasses = classes.filter(
      (c) => c.status === 'active' && c.academicYear.status === 'active',
    );

    // Ensembles d'ids de PORTÉE GLOBALE (agrégats serveur), pas des index
    // construits sur la page.
    const withPrincipal = new Set(coverage.classSectionIdsWithPrincipal);
    const withAssistant = new Set(coverage.classSectionIdsWithAssistant);
    const assigned = new Set(coverage.subjectIdsWithTeacher);

    const classLabel = (c: ClassOption) => `${c.gradeLevel.cycle.name} · ${c.name}`;

    const noPrincipal = activeClasses
      .filter((c) => !withPrincipal.has(c.id))
      .map((c) => classLabel(c));

    const noAssistant = activeClasses
      .filter((c) => isPrimaryOrKindergarten(c.gradeLevel.cycle.name))
      .filter((c) => !withAssistant.has(c.id))
      .map((c) => classLabel(c));

    const subjectsWithoutTeacher = subjects
      .filter((s) => !assigned.has(s.id))
      .map((s) => s.name);

    return { noPrincipal, noAssistant, subjectsWithoutTeacher };
  }, [classes, subjects, coverage]);

  if (!alerts) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
        <span className="font-bold">Couverture indisponible.</span> Les alertes de couverture
        portent sur l&apos;ensemble de l&apos;établissement et sont calculées côté serveur ; cette
        mesure n&apos;a pas pu être lue. Aucune alerte n&apos;est affichée — ni son contraire.
      </div>
    );
  }

  const total =
    alerts.noPrincipal.length + alerts.noAssistant.length + alerts.subjectsWithoutTeacher.length;

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <span className="font-bold">Couverture complète.</span> Toutes les classes actives ont un
        professeur principal, les cycles primaire/maternelle ont un assistant, et chaque matière a au
        moins un enseignant.
        <span className="mt-1 block text-xs text-emerald-700">
          Portée : tout l&apos;établissement, agrégat serveur — pas la page affichée.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-amber-800">
          Alertes de couverture
        </h3>
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-900">
          {total}
        </span>
      </div>
      <p className="mt-1 text-xs text-amber-900">
        Portée : tout l&apos;établissement (agrégat serveur), pas la page affichée.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <CoverageGroup
          title="Classes sans professeur principal"
          items={alerts.noPrincipal}
          empty="Toutes les classes ont un PP."
        />
        <CoverageGroup
          title="Primaire/maternelle sans assistant"
          items={alerts.noAssistant}
          empty="Tous les cycles concernés ont un assistant."
        />
        <CoverageGroup
          title="Matières sans enseignant"
          items={alerts.subjectsWithoutTeacher}
          empty="Toutes les matières sont couvertes."
        />
      </div>
    </div>
  );
}

function CoverageGroup({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-amber-100">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700">{title}</span>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
            items.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-[11px] text-slate-400">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((label) => (
            <li key={label} className="truncate text-xs text-slate-600" title={label}>
              • {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
