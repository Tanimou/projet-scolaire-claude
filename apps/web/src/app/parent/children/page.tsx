import {
  EmptyState,
  EnrollmentStatusBadge,
  KpiCard,
  PageHeader,
  formatDateShort,
} from '@pilotage/ui';
import {
  ArrowRight,
  Cake,
  Calendar,
  GraduationCap,
  Layers,
  User,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import type { ChildLinksView, ParentChildLinksResponse } from './claim-types';

import { PortalShell } from '@/components/PortalShell';
import { ChildClaimDrawer } from '@/components/parent/ChildClaimDrawer';
import { ChildLinksPanel } from '@/components/parent/ChildLinksPanel';
import { api, ApiError } from '@/lib/api-client';
import {
  enrollmentDecor,
  isActivelyEnrolled,
  resolveEnrollmentActivity,
  type CarriesEnrollmentActivity,
  type EnrollmentDecor,
  type EnrollmentDecorRow,
  type EnrollmentDisplay,
} from '@/lib/enrollment-activity';
import { isAccessDenied, read } from '@/lib/read-result';


export const metadata: Metadata = { title: 'Mes enfants' };
export const dynamic = 'force-dynamic';

/**
 * S-E03-3 / `PF-12` — la forme de `enrollments` a changé, et c'est le
 * changement porteur de charge.
 *
 * L'ancienne déclaration annonçait `academicYear: { name: string; status: string }`
 * alors que `GET /students` ne projette que `{ id, name }` : `status` valait
 * `undefined` au runtime, donc `e.academicYear.status === 'active'` était
 * **toujours faux, pour tout enfant**. Les deux KPI ci-dessous étaient
 * structurellement à `0` et chaque carte portait le libellé binaire
 * stigmatisant supprimé par cette tranche. `DNC-06` (l'interface promet ce que
 * le runtime ne livre pas) et `DNC-01` (le KPI en désaccord avec les badges de
 * sa propre page) au même endroit.
 *
 * Les lignes sont désormais typées `EnrollmentDecorRow`, qui ne porte **ni
 * `status`, ni `academicYear.status`** : la re-dérivation est *inexprimable*
 * ici, pas seulement absente. Elles ne servent plus qu'à retrouver les
 * attributs d'affichage (identifiant de classe, cycle, couleur) de la ligne que
 * le serveur a déjà retenue. Le verdict, lui, arrive tout fait dans
 * `enrollmentActivity` (`ADR-072`, `AC-2`).
 */
interface Child extends CarriesEnrollmentActivity {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  birthDate: string | null;
  externalRef: string | null;
  gender: string | null;
  enrollments: EnrollmentDecorRow[];
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
 * S-E03-3b / `PF-357` — reads the parent's own child LINKS
 * (`GET /parent/child-claims`) and returns a **discriminated** outcome.
 *
 * ## What it replaces, and why the old shape could not be repaired in place
 *
 * `fetchClaims` returned `{ claims, available }`. Every failure therefore had
 * to invent an empty `claims` array to fill that field — and the panel renders
 * an empty array as the school fact *"you have not attached any child"*. A 403
 * (guardianship revoked), a 422 (this account has no parent profile) and a 500
 * all arrived at the panel wearing the same clothes as a genuinely empty
 * account. That is `PF-05`'s class on this page, and no amount of care inside
 * the old return type removes it: the type itself has nowhere to put "we do
 * not know". `ChildLinksView` has no array outside its `ok` member, so the
 * emptiness statement is now unreachable from a failure — structurally, not by
 * vigilance.
 *
 * ## The status routing, and the 404 collision it settles (FM-5)
 *
 * Two rules of the story overlapped on `404`: "a 404 means the route family
 * isn't migrated yet" (calm banner) and "a 404 is an access answer" (denied).
 * The written tie-break was *"calm banner only when the response carries no
 * JSON body"* — and that test is **inexpressible here**: `read()` yields
 * `ApiFailure & { status }`, and `ApiFailure` drops `ApiError.body`
 * (`api-client.ts`). Evaluating it would mean editing `read-result.ts`, which
 * the other parent pages share.
 *
 * Settled by measurement instead: the `@Get()` handler behind this route
 * throws **no** `NotFoundException` — the only one in that controller is on
 * `:id/withdraw` — so its real failures are 403 (permission guard) and 422
 * (`resolveGuardian`, "this account has no parent profile"). A 404 reaching
 * here is an access answer, not a missing deployment, and the deployment case
 * keeps its own signal in `501/503`.
 *
 * Branch ORDER is load-bearing: `isAccessDenied` is true for 404, so the
 * `501/503` term must be evaluated first or the calm banner becomes
 * unreachable.
 *
 * `422` gets its own explicit term beside `isAccessDenied` rather than being
 * folded into it. `isAccessDenied` is `403 || 404` and is shared with the
 * other parent pages `ADR-071` converted; widening it there would silently
 * change how *those* pages render, so the widening lives at this call site
 * only.
 *
 * A `200` whose payload has no `links` array is a **failed** read, never an
 * empty one: that is exactly the deploy-skew shape (new page, un-restarted
 * API) that would otherwise reproduce this slice's own bug while every gate
 * stayed green. Hence no `?? []` anywhere on this path.
 */
async function readChildLinks(): Promise<ChildLinksView> {
  const result = await read(
    'parent-children/child-links',
    api<ParentChildLinksResponse>('/api/v1/parent/child-claims', { cache: 'no-store' }),
  );

  if (result.ok) {
    return Array.isArray(result.data?.links)
      ? { kind: 'ok', rows: result.data.links }
      : { kind: 'failure' };
  }
  if (result.status === 501 || result.status === 503) return { kind: 'unavailable' };
  if (isAccessDenied(result) || result.status === 422) return { kind: 'denied' };
  return { kind: 'failure' };
}

function computeAge(birthIso: string | null | undefined): number | null {
  if (!birthIso) return null;
  const birth = new Date(birthIso);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function initials(first?: string | null, last?: string | null): string {
  return `${(first ?? '?')[0]}${(last ?? '')[0] ?? ''}`.toUpperCase();
}

export default async function ParentChildrenPage() {
  const [resp, linksView] = await Promise.all([
    safe(api<{ data: Child[]; total: number }>('/api/v1/students', { cache: 'no-store' })),
    readChildLinks(),
  ]);
  const children = resp?.data ?? [];

  // The submit drawer is disabled ONLY when the route family genuinely is not
  // there yet. A 403 / 422 / 5xx leaves it ENABLED: disabling it would print
  // « Le rattachement en ligne n'est pas encore disponible » — a failed read
  // rendered as a fact about the school, which is `ADR-071 §D5` at the
  // inverse polarity `PF-346` already cost a land pass.
  const attachFormAvailable = linksView.kind !== 'unavailable';

  const total = children.length;

  // ─────────────────────────────────────────────────────────────────────────
  // S-E03-3 / `PF-12` — un verdict, calculé UNE fois par enfant, partagé par
  // les KPI et par les badges des cartes.
  //
  // Avant, les compteurs et les badges posaient la même question deux fois
  // (`children.flatMap(...).filter(...)` ici, `c.enrollments.find(...)` plus
  // bas). Deux copies d'un prédicat finissent toujours par diverger : c'est
  // `DNC-01`, et c'est `PF-12` reproduit à l'intérieur de son propre correctif.
  // Le prédicat est maintenant `isActivelyEnrolled`, énoncé une seule fois dans
  // `@/lib/enrollment-activity`.
  // ─────────────────────────────────────────────────────────────────────────
  const enrollmentByChild = new Map<string, { display: EnrollmentDisplay; decor: EnrollmentDecor }>(
    children.map((c) => [
      c.id,
      { display: resolveEnrollmentActivity(c), decor: enrollmentDecor(c, c.enrollments) },
    ]),
  );
  const activeEntries = Array.from(enrollmentByChild.values()).filter((e) =>
    isActivelyEnrolled(e.display),
  );

  const activeClasses = new Set(
    activeEntries.map((e) => e.decor.classSectionId).filter((id): id is string => Boolean(id)),
  ).size;

  // Distinct cycles across all active enrollments — replaces the previous
  // "ÉTABLISSEMENT — —" placeholder KPI with something real.
  const activeCycles = new Set(
    activeEntries.map((e) => e.decor.cycleName).filter((n): n is string => Boolean(n)),
  );

  // Le sous-titre des KPI NOMME l'année canonique au lieu de dire « Année en
  // cours » : un compteur qui dit « en cours » alors que l'année canonique
  // s'est terminée en juin est `DNC-01` reformulé (`ADR-041 §D3`).
  const scopeYearName = activeEntries[0]?.display.academicYearLabel ?? null;
  const kpiScopeCaption = scopeYearName
    ? `Année ${scopeYearName}`
    : total > 0
      ? 'Hors année en cours'
      : 'Aucun enfant rattaché';

  const avgAge =
    children.length > 0
      ? children.reduce((s, c) => s + (computeAge(c.birthDate) ?? 0), 0) /
        children.length
      : null;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Mes enfants' },
        ]}
        title="Mes enfants"
        subtitle="Tous les enfants rattachés à votre compte parent — cliquez pour voir le profil complet"
        actions={<ChildClaimDrawer available={attachFormAvailable} />}
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={User} tone="blue" label="ENFANTS" value={total}>
          Rattachés à votre compte
        </KpiCard>
        <KpiCard icon={GraduationCap} tone="violet" label="CLASSES ACTIVES" value={activeClasses}>
          {kpiScopeCaption}
        </KpiCard>
        <KpiCard
          icon={Cake}
          tone="amber"
          label="ÂGE MOYEN"
          value={avgAge != null ? Math.round(avgAge) : '—'}
        >
          {avgAge != null ? 'ans · âges arrondis' : 'Pas de date de naissance'}
        </KpiCard>
        <KpiCard
          icon={Layers}
          tone="teal"
          label="CYCLES SUIVIS"
          value={activeCycles.size}
        >
          {activeCycles.size > 0
            ? `${Array.from(activeCycles).slice(0, 2).join(', ')} · ${kpiScopeCaption}`
            : kpiScopeCaption}
        </KpiCard>
      </div>

      <section className="mt-6">
        {children.length === 0 ? (
          <EmptyState
            icon={User}
            title="Aucun enfant rattaché"
            description="Aucun enfant n'est lié à votre compte parent. Rattachez le dossier de votre enfant, ou contactez l'administration de l'établissement."
            tone="amber"
          >
            <div className="mt-2">
              <ChildClaimDrawer available={attachFormAvailable} />
            </div>
          </EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {children.map((c) => {
              // Le verdict est LU, jamais recalculé — même objet que celui qui
              // a alimenté les KPI ci-dessus, donc désaccord impossible.
              const { display: enrolment, decor } = enrollmentByChild.get(c.id)!;
              const cycleColor = decor.accentColor;
              const age = computeAge(c.birthDate);
              const detailHref = `/parent/children/${c.id}`;
              return (
                <li
                  key={c.id}
                  className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60 transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-slate-300"
                >
                  {/* Colored band by cycle */}
                  <div
                    aria-hidden
                    className="h-1.5 w-full"
                    style={{ background: cycleColor }}
                  />
                  <Link
                    href={detailHref}
                    aria-label={`Voir le profil de ${c.firstName} ${c.lastName}`}
                    className="flex flex-col gap-4 p-5"
                  >
                    <div className="flex items-center gap-3">
                      {c.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.photoUrl}
                          alt={`${c.firstName} ${c.lastName}`}
                          className="h-14 w-14 shrink-0 rounded-xl object-cover ring-2 ring-white"
                        />
                      ) : (
                        <div
                          aria-hidden
                          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white shadow"
                          style={{ background: cycleColor }}
                        >
                          {initials(c.firstName, c.lastName)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-bold text-slate-900">
                          {c.firstName} {c.lastName}
                        </h3>
                        {/*
                          Le libellé binaire précédent ne survit pas à cette
                          tranche : appliqué à un enfant, il se lisait comme un
                          jugement sur la *personne* et non sur une ligne de
                          base — la violation la plus nette de la règle
                          « non-stigmatisant » du portail parent. Le badge et sa
                          ligne de portée nomment désormais l'année, et la
                          portée est dans le DOM, jamais dans un `title`.
                        */}
                        <div className="mt-1.5">
                          <EnrollmentStatusBadge
                            state={enrolment.state}
                            classLabel={enrolment.classLabel}
                            academicYearLabel={enrolment.academicYearLabel}
                            lastStatus={enrolment.lastStatus}
                            size="sm"
                          />
                        </div>
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3 text-slate-400" />
                        <div>
                          <dt className="text-slate-500">Date de naissance</dt>
                          <dd className="font-semibold text-slate-800">
                            {formatDateShort(c.birthDate)}
                          </dd>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Cake className="h-3 w-3 text-slate-400" />
                        <div>
                          <dt className="text-slate-500">Âge</dt>
                          <dd className="font-semibold text-slate-800">
                            {age != null ? `${age} ans` : '—'}
                          </dd>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-slate-500">Identifiant</dt>
                        <dd className="font-mono text-[10px] text-slate-700">
                          {c.externalRef ?? '—'}
                        </dd>
                      </div>
                    </dl>
                  </Link>

                  <div className="mt-auto flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-3">
                    <Link
                      href={detailHref}
                      className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 transition group-hover:underline"
                    >
                      Voir le profil
                      <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/parent/grades?studentId=${c.id}`}
                        className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                      >
                        Notes
                      </Link>
                      <Link
                        href={`/parent/attendance?studentId=${c.id}`}
                        className="rounded-md bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                      >
                        Absences
                      </Link>
                      <Link
                        href={`/parent/dashboard?studentId=${c.id}`}
                        className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                      >
                        Tableau
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/*
        S-E03-3b — « Rattachements et demandes » : la contrepartie
        administrative de la liste ci-dessus, projetée depuis le MÊME fait
        (`Guardianship`) qu'elle. Le panneau reçoit un résultat discriminé et
        non « une liste plus un drapeau » : une lecture qui échoue n'a plus de
        tableau vide à rendre comme « vous n'avez rattaché aucun enfant ».
      */}
      <ChildLinksPanel view={linksView} />
    </PortalShell>
  );
}
