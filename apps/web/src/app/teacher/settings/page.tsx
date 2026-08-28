import {
  Avatar,
  EmptyState,
  MfaStatusBadge,
  mfaAssuranceHint,
  mfaAssuranceLabel,
  mfaAssuranceState,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@pilotage/ui';
import {
  BookOpen,
  Clock,
  ExternalLink,
  GraduationCap,
  Languages,
  Lock,
  Mail,
  Settings,
  ShieldCheck,
  Star,
  User,
  UserCircle2,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { DisplayPreferencesPanel } from '../../admin/settings/DisplayPreferencesPanel';
import {
  PreferencesPanel,
  type PreferenceRow,
} from '../../admin/settings/PreferencesPanel';
import {
  DISPLAY_PREFS_DEFAULTS,
  type DisplayPreferences,
} from '../../admin/settings/display-prefs-types';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { fetchMe, type MeResponse } from '@/lib/me';


export const metadata: Metadata = { title: 'Paramètres' };
export const dynamic = 'force-dynamic';

interface TeacherAssignment {
  id: string;
  isMainTeacher: boolean;
  weeklyHours: string | null;
  classSection: {
    id: string;
    name: string;
    gradeLevel: { name: string; cycle: { name: string; color: string | null } };
    _count: { enrollments: number };
  };
  subject: { id: string; code: string; name: string; color: string | null };
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

function localeLabel(code: string | null | undefined): string {
  if (!code) return 'Français (par défaut)';
  if (code.startsWith('fr')) return `Français (${code})`;
  if (code.startsWith('en')) return `English (${code})`;
  return code;
}

interface TeachingSummary {
  subjects: Array<{ id: string; name: string; color: string | null }>;
  classCount: number;
  /**
   * SOMME des effectifs des sections de l'enseignant — donc un nombre
   * d'INSCRIPTIONS, pas un nombre d'élèves (S-E03-7 / ADR-079).
   *
   * QUATRIÈME dérivation cliente de « combien d'élèves ? » dans le portail
   * enseignant, et la seule qui reste hors du module canonique : elle est
   * ÉPINGLÉE par le cliquet R3 (plafond décroissant), pas convertie — la
   * convertir demanderait un endpoint agrégé que cette tranche n'ouvre pas
   * (PF-414). Le nom et le libellé disent désormais ce qu'elle compte
   * vraiment ; la valeur, elle, ne change pas.
   */
  enrolmentCount: number;
  weeklyHours: number;
  mainClassCount: number;
  yearName: string | null;
}

function summarize(assignments: TeacherAssignment[]): TeachingSummary {
  const active = assignments.filter((a) => a.academicYear.status === 'active');
  const scope = active.length > 0 ? active : assignments;

  const subjects = new Map<string, { id: string; name: string; color: string | null }>();
  const classes = new Map<string, number>();
  const mainClasses = new Set<string>();
  let weeklyHours = 0;

  for (const a of scope) {
    subjects.set(a.subject.id, {
      id: a.subject.id,
      name: a.subject.name,
      color: a.subject.color,
    });
    classes.set(a.classSection.id, a.classSection._count.enrollments);
    if (a.isMainTeacher) mainClasses.add(a.classSection.id);
    const h = a.weeklyHours ? Number.parseFloat(a.weeklyHours) : 0;
    if (Number.isFinite(h)) weeklyHours += h;
  }

  // `reduce(+)` sur des effectifs de sections DISJOINTES : le résultat est un
  // nombre de LIGNES d'inscription. Un élève inscrit dans deux des classes de
  // l'enseignant y compte deux fois, et rien en base ne l'interdit — l'index
  // unique partiel annoncé par `schema.prisma` n'existe pas (PF-361/PF-409).
  const enrolmentCount = [...classes.values()].reduce((sum, n) => sum + n, 0);

  // With no active year we fall back to ALL assignments, which may span several
  // years — only label the summary with a year when the scope is a single one,
  // otherwise the year chip would misrepresent the aggregated totals.
  const yearIds = new Set(scope.map((a) => a.academicYear.id));
  const yearName = yearIds.size === 1 ? (scope[0]?.academicYear.name ?? null) : null;

  return {
    subjects: [...subjects.values()],
    classCount: classes.size,
    enrolmentCount,
    weeklyHours,
    mainClassCount: mainClasses.size,
    yearName,
  };
}

export default async function TeacherSettingsPage() {
  const [me, prefsResp, displayResp, assignmentsResp] = await Promise.all([
    fetchMe(),
    safe(
      api<{ data: PreferenceRow[] }>('/api/v1/notifications/preferences', {
        cache: 'no-store',
      }),
    ),
    safe(
      api<{ data: DisplayPreferences }>('/api/v1/me/display-preferences', {
        cache: 'no-store',
      }),
    ),
    safe(
      api<{ data: TeacherAssignment[] }>('/api/v1/teachers/me/assignments', {
        cache: 'no-store',
      }),
    ),
  ]);

  const preferences = prefsResp?.data ?? [];
  const display: DisplayPreferences = displayResp?.data ?? DISPLAY_PREFS_DEFAULTS;
  const summary = summarize(assignmentsResp?.data ?? []);

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Paramètres' },
        ]}
        title="Paramètres"
        subtitle="Profil enseignant, notifications, affichage et sécurité du compte"
      />

      <div className="mt-6">
        <Tabs defaultValue="profile" variant="underline">
          <TabsList>
            <TabsTrigger value="profile">Mon profil</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="display">Affichage</TabsTrigger>
            <TabsTrigger value="security">Sécurité</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfilePanel me={me} summary={summary} />
          </TabsContent>

          <TabsContent value="notifications">
            <PreferencesPanel initial={preferences} recipientEmail={me?.email} />
          </TabsContent>

          <TabsContent value="display">
            <DisplayPreferencesPanel initial={display} portal="teacher" />
          </TabsContent>

          <TabsContent value="security">
            <SecurityPanel me={me} />
          </TabsContent>
        </Tabs>
      </div>

      <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-slate-500">
        <Settings className="h-3 w-3" />
        Onglet <strong className="mx-1">Notifications</strong> entièrement éditable — vos
        préférences contrôlent la cloche du topbar et le centre{' '}
        <Link href="/teacher/notifications" className="font-bold accent-text hover:underline">
          /teacher/notifications
        </Link>
        .
      </p>
    </PortalShell>
  );
}

// =============================================================================
// Profile tab — branded hero + teaching summary for the signed-in teacher
// =============================================================================

const ACCENT_HERO =
  'linear-gradient(120deg, var(--accent-700), var(--accent-500) 55%, color-mix(in oklch, var(--accent-500) 65%, white))';

function ProfilePanel({ me, summary }: { me: MeResponse | null; summary: TeachingSummary }) {
  if (!me) {
    return (
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <EmptyState
          icon={User}
          title="Profil indisponible"
          description="Impossible de charger votre profil pour l'instant. Réessayez dans quelques instants."
          tone="slate"
        />
      </section>
    );
  }

  const fullName = `${me.firstName ?? ''} ${me.lastName ?? ''}`.trim() || me.email;
  const subjectBadge =
    summary.subjects.length === 0
      ? 'Aucune matière assignée'
      : summary.subjects.length === 1
        ? '1 matière enseignée'
        : `${summary.subjects.length} matières enseignées`;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        <div className="relative isolate p-6 sm:p-7" style={{ backgroundImage: ACCENT_HERO }}>
          <div
            className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_top_right,white_0,transparent_50%)]"
            aria-hidden
          />
          <div className="relative flex flex-wrap items-center gap-5">
            <Avatar
              src={me.photoUrl}
              firstName={me.firstName}
              lastName={me.lastName}
              size="2xl"
              className="ring-4 ring-white/30"
            />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">
                Compte enseignant
              </p>
              <h2 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{fullName}</h2>
              <p className="mt-1 text-sm text-white/80">{me.email}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <HeroBadge icon={BookOpen}>{subjectBadge}</HeroBadge>
                <HeroBadge icon={Languages}>{localeLabel(me.locale)}</HeroBadge>
                {summary.mainClassCount > 0 && (
                  <HeroBadge icon={Star}>
                    Professeur principal · {summary.mainClassCount}
                  </HeroBadge>
                )}
                {/* S-E05-8 / PF-25 half (b). This was `{me.mfaEnabled && …}`
                    over a field the API hard-coded to `false`, so the badge was
                    unreachable for EVERY user — and now that the field is
                    `null` ("never measured"), a truthiness read would keep it
                    unreachable while silently meaning something else. The
                    verdict is derived once, by the shared rule, from the POLICY
                    (`mfaRequired`, always known) crossed with the FACT
                    (`mfaEnabled`, `null` = unmeasured); the badge renders
                    « MFA requis · non vérifié » for a teacher, which is the
                    user the audit complained about. */}
                <MfaStatusBadge
                  state={mfaAssuranceState({
                    mfaRequired: me.mfaRequired,
                    mfaEnabled: me.mfaEnabled,
                  })}
                  surface="on_gradient"
                  size="sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Teaching stat band */}
        <div className="grid grid-cols-2 gap-px border-y border-slate-100 bg-slate-100 sm:grid-cols-4">
          <StatCell icon={BookOpen} label="Matières" value={summary.subjects.length} />
          <StatCell icon={GraduationCap} label="Classes" value={summary.classCount} />
          {/* « Élèves suivis » est réservé au nombre d'élèves DISTINCTS. Cette
              valeur est un cumul d'effectifs : elle s'appelle donc
              « Inscriptions ». Deux noms, deux questions, aucun recouvrement. */}
          <StatCell
            icon={Users}
            label="Inscriptions"
            value={summary.enrolmentCount}
            hint="cumul des effectifs"
          />
          <StatCell
            icon={Clock}
            label="Heures / semaine"
            value={summary.weeklyHours > 0 ? `${summary.weeklyHours}h` : '—'}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
          <Field icon={User} label="Prénom" value={me.firstName || '—'} />
          <Field icon={User} label="Nom" value={me.lastName || '—'} />
          <Field icon={Mail} label="Adresse email" value={me.email} />
          <Field icon={Languages} label="Langue" value={localeLabel(me.locale)} />
        </div>

        {summary.subjects.length > 0 && (
          <div className="border-t border-slate-100 px-6 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Matières enseignées{summary.yearName ? ` · ${summary.yearName}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {summary.subjects.map((s) => {
                const color = s.color ?? '#10b981';
                return (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1"
                    style={{
                      color,
                      backgroundColor: `color-mix(in oklch, ${color} 12%, white)`,
                      borderColor: `color-mix(in oklch, ${color} 30%, white)`,
                    }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    {s.name}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <p className="text-xs text-slate-600">
            Pour modifier votre nom ou votre adresse email, contactez l&apos;administration de
            l&apos;établissement. Le mot de passe et la double authentification se gèrent depuis
            le portail compte sécurisé (onglet <strong>Sécurité</strong>).
          </p>
        </div>
      </section>
    </div>
  );
}

// =============================================================================
// Security tab — account hardening summary + link to the Keycloak account portal
// =============================================================================

function SecurityPanel({ me }: { me: MeResponse | null }) {
  // TWO different unknowns, deliberately not collapsed into one string:
  //  - `me === null` (401 / network — `fetchMe()` swallows a 401) → « Non
  //    disponible », the pattern the email row already uses. Something is wrong
  //    with the session.
  //  - `me.mfaEnabled === null` → « statut non vérifié ». Nothing is wrong; the
  //    platform simply never asked Keycloak (PF-443). Rendering the same words
  //    for both would be PF-25 reintroduced one field over.
  const assurance = me
    ? mfaAssuranceState({ mfaRequired: me.mfaRequired, mfaEnabled: me.mfaEnabled })
    : null;
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-900">Sécurité du compte</h2>
          <p className="mt-1 text-xs text-slate-500">
            Changement de mot de passe, activation de la double authentification (MFA) et gestion
            des sessions actives. Ces réglages sont gérés par votre portail de compte sécurisé.
          </p>
          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field icon={Lock} label="Mot de passe" value="Modifiable via le portail compte" />
            {/* Was `me?.mfaEnabled ? 'Activée' : 'Recommandée'` — a two-branch
                ternary over a THREE-state field, which told 100 % of teachers
                that MFA was merely « Recommandée » while `invite.controller`
                pushes `CONFIGURE_TOTP` for every one of them. The wording now
                comes from the shared table, so « Obligatoire · statut non
                vérifié » is derived, never hand-written here. */}
            <Field
              icon={ShieldCheck}
              label="Double authentification"
              value={assurance ? mfaAssuranceLabel(assurance) : 'Non disponible'}
              hint={assurance ? mfaAssuranceHint(assurance) : null}
            />
            <Field
              icon={UserCircle2}
              label="Sessions actives"
              value="Consultables dans le portail compte"
            />
            <Field icon={Mail} label="Email de contact" value={me?.email ?? 'Non disponible'} />
          </dl>
          <Link
            href={`${process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? 'http://localhost:8180'}/realms/pilotage-scolaire/account/`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-slate-800"
          >
            Ouvrir mon portail compte sécurisé
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// Reusable small bits
// =============================================================================

function HeroBadge({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20 backdrop-blur-sm">
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

function StatCell({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  /** Portée de la mesure, rendue sous le libellé — visible, jamais un tooltip. */
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 bg-white px-5 py-4">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teacher-50 text-teacher-600">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-bold leading-none tabular-nums text-slate-900">{value}</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {label}
        </p>
        {hint && <p className="mt-0.5 text-[10px] leading-tight text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /** One VISIBLE sentence under the value. Visible, not a `title`: help that
   *  exists only on hover is unreachable by touch and by keyboard, and « statut
   *  non vérifié » without it reads as an app defect rather than as an honest
   *  "we never asked". slate-500 on slate-50 ≈ 7:1. */
  hint?: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
      <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <Icon className="h-3 w-3" />
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
      {hint ? <dd className="mt-1 text-xs font-normal text-slate-500">{hint}</dd> : null}
    </div>
  );
}
