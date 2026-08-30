import type { AcademicYearScope } from '@pilotage/contracts';
import { AcademicYearScopeBadge, academicYearScopeState } from '@pilotage/ui';
import {
  Building2,
  ChevronRight,
  GraduationCap,
  Layers,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

export const metadata: Metadata = { title: 'Structure de l\'école' };
export const dynamic = 'force-dynamic';

interface ClassNode {
  id: string;
  name: string;
  status: 'active' | 'closed';
  maxStudents: number;
  activeEnrollments: number;
  fillRate: number;
}

interface LevelNode {
  id: string;
  code: string;
  name: string;
  orderIndex: number;
  coefficientCount: number;
  subjectsCount: number;
  classes: ClassNode[];
  totalClasses: number;
  totalStudents: number;
  capacity: number;
}

interface CycleNode {
  id: string;
  code: string;
  name: string;
  color: string | null;
  icon: string | null;
  orderIndex: number;
  gradeLevels: LevelNode[];
}

interface StructureResponse {
  school: {
    id: string;
    name: string;
    schoolCode: string;
    country: string;
    academicYears: Array<{ id: string; name: string; status: string; startDate: string; endDate: string }>;
  };
  activeAcademicYearId: string | null;
  /**
   * La PORTÉE de l'année ACTIVE de l'établissement (S-E03-16 / ADR-090) — nom,
   * bornes, `isStale`, `staleByDays`. Elle décrit l'année active, PAS forcément
   * l'année que cette page affiche : le sélecteur ci-dessous peut pointer
   * ailleurs, et c'est `selectedYearId` qui porte les chiffres de l'arbre.
   *
   * ⛔ Aucune sélection, aucun filtre, aucun tri sur `isStale` ni sur
   * `containsReferenceDate` : 0/2 tenants contiennent aujourd'hui (mesuré le
   * 2026-08-30), filtrer viderait la page. La vétusté est RAPPORTÉE (ADR-070).
   */
  activeAcademicYear: AcademicYearScope | null;
  selectedYearId: string | null;
  cycles: CycleNode[];
  subjects: Array<{ id: string; code: string; name: string; color: string | null; defaultCoefficient: string }>;
  stats: {
    totalCycles: number;
    totalLevels: number;
    totalClasses: number;
    totalSubjects: number;
    /**
     * Élèves de l'ÉCOLE COURANTE (S-E03-7 / ADR-079).
     *
     * Ce total était compté sans clause d'école : il portait tout le tenant,
     * arbre compris et hors-arbre compris, sous un en-tête qui décrit une seule
     * école. Il BAISSE donc, ou reste égal, et s'accorde enfin avec la somme des
     * niveaux affichés en dessous — l'écart entre l'en-tête et l'arbre était
     * précisément le symptôme. La portée est désormais écrite à l'écran.
     */
    totalStudents: number;
    totalGuardians: number;
    activeEnrollments: number;
  };
}

export default async function StructurePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const sp = await searchParams;
  const qs = sp.year ? `?academicYearId=${sp.year}` : '';
  const data = await api<StructureResponse>(`/api/v1/school/structure${qs}`, { cache: 'no-store' });
  // Anciennement nommée `activeYear` — un nom faux : c'est l'année SÉLECTIONNÉE
  // (`?year=`), celle dont l'arbre et les compteurs ci-dessous portent les
  // chiffres. L'année ACTIVE de l'établissement est `data.activeAcademicYear`,
  // et les deux ne coïncident pas dès qu'un admin clique une autre pastille.
  const selectedYear = data.school.academicYears.find((y) => y.id === data.selectedYearId);

  // La NUANCE compte, et elle n'est pas écrasée ici : `undefined`
  // (champ absent — une `api` antérieure à S-E03-16 pendant la fenêtre de déploiement)
  // et `null` (l'API a résolu et répond « aucune année active ») sont DEUX faits
  // différents, et le badge les rend différemment. On ne les écrase donc pas l'un sur
  // l'autre ici. Le seul cas normalisé est celui d'une lecture réussie.
  const yearScope: AcademicYearScope | null | undefined = data.activeAcademicYear;
  const scopeState = academicYearScopeState(yearScope);

  /**
   * ⚠ DNC-01 — le badge décrit l'année dont cette page affiche les chiffres, jamais une autre.
   *
   * Cette page a un SÉLECTEUR d'année : l'arbre, les compteurs et les taux de remplissage
   * portent sur `selectedYearId`, qui n'est pas forcément l'année active. Poser
   * « 2025-2026 · terminée il y a 56 jours » en tête d'un arbre qui montre 2023–2024
   * mettrait deux portées contradictoires sur un même écran.
   *
   * On ne fabrique PAS la portée de l'année sélectionnée côté client : `isStale` et
   * `containsReferenceDate` se recalculeraient sur une horloge de navigateur, c'est-à-dire
   * une deuxième dérivation du fait unique que cette tranche existe pour arrêter de perdre.
   * Quand la sélection s'écarte de l'année active, le badge quitte donc la position
   * « portée de la page » et redescend à côté d'une phrase qui nomme explicitement les deux
   * années — son sujet devient l'établissement, pas le tableau.
   */
  const offActiveYear = yearScope != null && data.selectedYearId !== yearScope.id;

  return (
    <PortalShell portal="admin">
      <div>
        <div className="text-xs text-slate-500">École · Structure pédagogique</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{data.school.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Hiérarchie complète : <strong>école</strong> → <strong>cycles</strong> → <strong>niveaux</strong> → <strong>classes</strong> →{' '}
          <strong>élèves inscrits</strong>. Les coefficients de matières s&apos;appliquent par niveau.
        </p>
      </div>

      {/* La PORTÉE, juste sous le titre et AVANT tout chiffre : un lecteur d'écran
          entend sur quelle année portent les nombres avant de les entendre. */}
      <div className="mt-4">
        {offActiveYear ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-slate-600">
              Vous consultez <strong>{selectedYear?.name ?? 'une autre année'}</strong>. L&apos;année active
              de l&apos;établissement :
            </p>
            <AcademicYearScopeBadge size="sm" year={yearScope} />
          </div>
        ) : (
          <AcademicYearScopeBadge
            year={yearScope}
            variant={
              scopeState === 'current' || scopeState === 'last_day' ? 'inline' : 'block'
            }
            action={
              scopeState === 'stale' || scopeState === 'none' ? (
                <Link className="font-bold accent-text hover:underline" href="/admin/academic-years">
                  Ouvrir une année scolaire →
                </Link>
              ) : undefined
            }
          />
        )}
      </div>

      {/* Year filter */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Année scolaire :</span>
        {data.school.academicYears.map((y) => {
          const selected = y.id === data.selectedYearId;
          return (
            <Link
              key={y.id}
              href={`/admin/school/structure?year=${y.id}`}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-bold transition ${
                selected
                  ? 'bg-blue-600 text-white shadow'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {y.name}
              {y.status === 'active' && (
                <span className="rounded-full bg-emerald-500/20 px-1.5 py-0 text-[10px]">active</span>
              )}
            </Link>
          );
        })}
      </div>

      {/* High-level stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Layers className="h-4 w-4" />} label="Cycles" value={data.stats.totalCycles} tone="brand" />
        <Stat icon={<Layers className="h-4 w-4" />} label="Niveaux" value={data.stats.totalLevels} tone="ink" />
        <Stat
          icon={<GraduationCap className="h-4 w-4" />}
          label="Classes"
          value={data.stats.totalClasses}
          hint={selectedYear?.name}
          tone="ink"
        />
        <Stat
          icon={<Users className="h-4 w-4" />}
          label="Élèves inscrits"
          value={data.stats.activeEnrollments}
          hint={`${data.stats.totalStudents} élèves dans l'établissement`}
          tone="teacher"
        />
      </div>

      {/* The tree */}
      <section className="mt-8 space-y-4">
        {data.cycles.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
            <Layers className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Aucun cycle défini</p>
            <p className="mt-1 text-xs text-slate-500">
              Commencez par créer les cycles de votre établissement (ex. Collège, Lycée) depuis{' '}
              <Link className="font-bold accent-text hover:underline" href="/admin/cycles">
                Cycles & niveaux
              </Link>
              .
            </p>
          </div>
        ) : (
          data.cycles.map((cycle) => <CycleBlock key={cycle.id} cycle={cycle} />)
        )}
      </section>

      {/* Bottom: Subjects bar (school-wide) */}
      <section className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
              Matières de l&apos;école
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {data.subjects.length} matière(s) actives — leurs coefficients sont définis par niveau
            </p>
          </div>
          <Link href="/admin/subjects" className="text-xs font-bold accent-text hover:underline">
            Gérer les coefficients →
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.subjects.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1 text-xs ring-1 ring-slate-200"
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: s.color ?? 'oklch(0.65 0.15 250)' }}
              />
              <span className="font-bold text-slate-700">{s.name}</span>
              <span className="font-mono text-[10px] text-slate-500">coef défaut {Number(s.defaultCoefficient)}</span>
            </span>
          ))}
        </div>
      </section>
    </PortalShell>
  );
}

function CycleBlock({ cycle }: { cycle: CycleNode }) {
  const totalClasses = cycle.gradeLevels.reduce((s, l) => s + l.totalClasses, 0);
  const totalStudents = cycle.gradeLevels.reduce((s, l) => s + l.totalStudents, 0);
  const tint = cycle.color ?? 'oklch(0.62 0.18 250)';
  return (
    <article className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
      <header
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
        style={{ background: `color-mix(in oklch, ${tint} 10%, white)` }}
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-10 w-10 place-items-center rounded-xl text-white shadow-md"
            style={{ background: tint }}
          >
            <Layers className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-base font-bold tracking-tight text-slate-900">{cycle.name}</h3>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              code <code className="font-mono">{cycle.code}</code> · {cycle.gradeLevels.length} niveau{cycle.gradeLevels.length > 1 ? 'x' : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Chip label="Classes" value={totalClasses} />
          <Chip label="Élèves" value={totalStudents} tone="teal" />
          <Link
            href={`/admin/cycles`}
            className="ml-2 inline-flex items-center gap-1 text-xs font-bold accent-text hover:underline"
          >
            Niveaux <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </header>

      {cycle.gradeLevels.length === 0 ? (
        <p className="px-5 py-4 text-xs italic text-slate-500">Aucun niveau dans ce cycle.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {cycle.gradeLevels.map((lv) => (
            <li key={lv.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-8 w-12 place-items-center rounded-lg bg-slate-100 font-mono text-xs font-bold text-slate-700">
                  {lv.code}
                </span>
                <span className="text-sm font-bold text-slate-900">{lv.name}</span>
                <span className="text-[11px] text-slate-500">
                  {lv.totalClasses} classe(s) · {lv.totalStudents}/{lv.capacity || '–'} élèves · {lv.coefficientCount}/{lv.subjectsCount} coefs personnalisés
                </span>
              </div>
              {lv.classes.length === 0 ? (
                <p className="mt-2 ml-15 pl-15 text-[11px] italic text-slate-400">
                  Aucune classe pour cette année. <Link href="/admin/classes" className="font-bold accent-text hover:underline">Créer une classe →</Link>
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {lv.classes.map((c) => (
                    <Link
                      key={c.id}
                      href={`/admin/classes/${c.id}`}
                      className="group inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 transition hover:border-blue-300 hover:bg-blue-50"
                    >
                      <span className="text-sm font-bold text-slate-900 group-hover:text-blue-700">{c.name}</span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {c.activeEnrollments}/{c.maxStudents}
                      </span>
                      {c.fillRate > 0 && (
                        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200">
                          <span
                            className={`block h-full ${
                              c.fillRate >= 1
                                ? 'bg-rose-500'
                                : c.fillRate >= 0.85
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, c.fillRate * 100)}%` }}
                          />
                        </span>
                      )}
                      {c.status === 'closed' && (
                        <span className="rounded bg-slate-200 px-1 text-[9px] uppercase font-bold tracking-wider text-slate-600">
                          fermée
                        </span>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-700" />
                    </Link>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Chip({ label, value, tone }: { label: string; value: number; tone?: 'teal' }) {
  const toneClass = tone === 'teal' ? 'bg-teal-50 text-teal-700' : 'bg-blue-50 text-blue-700';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${toneClass}`}>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      <span className="font-mono text-xs font-bold tabular-nums">{value}</span>
    </span>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  tone: 'brand' | 'teacher' | 'ink';
}) {
  const toneMap = {
    brand: 'bg-blue-50 text-blue-700',
    teacher: 'bg-teal-50 text-teal-700',
    ink: 'bg-slate-100 text-slate-700',
  } as const;
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
        <div className={`grid h-8 w-8 place-items-center rounded-lg ${toneMap[tone]}`}>{icon}</div>
      </div>
      <div className="mt-3 font-mono text-3xl font-bold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}
