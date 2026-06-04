import {
  Cake,
  ExternalLink,
  GraduationCap,
  Languages,
  Lock,
  Mail,
  Settings,
  ShieldCheck,
  Sparkles,
  User,
  UserCircle2,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { fetchMe, type MeResponse } from '@/lib/me';
import {
  Avatar,
  EmptyState,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatDateShort,
} from '@pilotage/ui';

import { DisplayPreferencesPanel } from '../../admin/settings/DisplayPreferencesPanel';
import {
  DISPLAY_PREFS_DEFAULTS,
  type DisplayPreferences,
} from '../../admin/settings/display-prefs-types';
import {
  PreferencesPanel,
  type PreferenceRow,
} from '../../admin/settings/PreferencesPanel';

export const metadata: Metadata = { title: 'Paramètres' };
export const dynamic = 'force-dynamic';

interface ChildEnrollment {
  classSection: {
    id: string;
    name: string;
    gradeLevel?: {
      name: string;
      cycle?: { name: string; color: string | null };
    };
  };
  academicYear: { name: string; status: string };
}

interface Child {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  birthDate: string | null;
  externalRef: string | null;
  enrollments: ChildEnrollment[];
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
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

function localeLabel(code: string | null | undefined): string {
  if (!code) return 'Français (par défaut)';
  if (code.startsWith('fr')) return `Français (${code})`;
  if (code.startsWith('en')) return `English (${code})`;
  return code;
}

export default async function ParentSettingsPage() {
  const [me, prefsResp, childrenResp, displayResp] = await Promise.all([
    fetchMe(),
    safe(
      api<{ data: PreferenceRow[] }>('/api/v1/notifications/preferences', {
        cache: 'no-store',
      }),
    ),
    safe(
      api<{ data: Child[]; total: number }>('/api/v1/students', {
        cache: 'no-store',
      }),
    ),
    safe(
      api<{ data: DisplayPreferences }>('/api/v1/me/display-preferences', {
        cache: 'no-store',
      }),
    ),
  ]);

  const preferences = prefsResp?.data ?? [];
  const children = childrenResp?.data ?? [];
  const display: DisplayPreferences = displayResp?.data ?? DISPLAY_PREFS_DEFAULTS;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Paramètres' },
        ]}
        title="Paramètres du compte"
        subtitle="Profil familial, préférences de notification, enfants rattachés et sécurité"
      />

      <div className="mt-6">
        <Tabs defaultValue="notifications" variant="underline">
          <TabsList>
            <TabsTrigger value="profile">Mon profil</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="family">Ma famille</TabsTrigger>
            <TabsTrigger value="display">Affichage</TabsTrigger>
            <TabsTrigger value="security">Sécurité</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfilePanel me={me} childCount={children.length} />
          </TabsContent>

          <TabsContent value="notifications">
            <div className="space-y-4">
              <PreferencesPanel initial={preferences} recipientEmail={me?.email} />
              <section className="rounded-2xl bg-gradient-to-br from-violet-50 via-white to-blue-50 p-5 ring-1 ring-violet-100">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-violet-600 ring-1 ring-violet-200">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900">
                      Pourquoi activer les notifications ?
                    </h3>
                    <ul className="mt-2 space-y-1 text-xs text-slate-600">
                      <li className="flex gap-1.5">
                        <span className="text-violet-600">•</span> Soyez prévenu dès qu&apos;une
                        nouvelle note est publiée pour votre enfant
                      </li>
                      <li className="flex gap-1.5">
                        <span className="text-violet-600">•</span> Recevez les alertes du moteur
                        de suivi scolaire (baisse de moyenne, absences répétées)
                      </li>
                      <li className="flex gap-1.5">
                        <span className="text-violet-600">•</span> Ne manquez plus les annonces
                        importantes de l&apos;établissement
                      </li>
                      <li className="flex gap-1.5">
                        <span className="text-violet-600">•</span> Recevez chaque lundi un résumé
                        clair de la semaine — sans ouvrir l&apos;application
                      </li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="family">
            <FamilyPanel items={children} />
          </TabsContent>

          <TabsContent value="display">
            <DisplayPreferencesPanel initial={display} portal="parent" />
          </TabsContent>

          <TabsContent value="security">
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold text-slate-900">Sécurité du compte</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Changement de mot de passe, activation de la double authentification (MFA) et
                    gestion des sessions actives. Ces réglages sont gérés par votre portail de
                    compte sécurisé.
                  </p>
                  <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field
                      icon={Lock}
                      label="Mot de passe"
                      value="Modifiable via le portail compte"
                    />
                    <Field
                      icon={ShieldCheck}
                      label="Double authentification"
                      value="Recommandée pour protéger vos enfants"
                    />
                    <Field
                      icon={UserCircle2}
                      label="Sessions actives"
                      value="Consultables dans le portail compte"
                    />
                    <Field
                      icon={Mail}
                      label="Email de contact"
                      value={me?.email ?? 'Non disponible'}
                    />
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
          </TabsContent>
        </Tabs>
      </div>

      <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-slate-500">
        <Settings className="h-3 w-3" />
        L&apos;onglet <strong className="mx-1">Notifications</strong> est entièrement éditable.
        Vos préférences contrôlent la cloche du topbar et la page{' '}
        <Link
          href="/parent/notifications"
          className="font-bold accent-text hover:underline"
        >
          /parent/notifications
        </Link>
        .
      </p>
    </PortalShell>
  );
}

// =============================================================================
// Profile tab — read-only summary of the parent user with avatar + meta chips
// =============================================================================

function ProfilePanel({ me, childCount }: { me: MeResponse | null; childCount: number }) {
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
  const initialBadge =
    childCount === 0
      ? 'Aucun enfant rattaché'
      : childCount === 1
        ? '1 enfant rattaché'
        : `${childCount} enfants rattachés`;

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <div className="relative isolate bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 p-6 sm:p-7">
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
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-100">
              Compte famille
            </p>
            <h2 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{fullName}</h2>
            <p className="mt-1 text-sm text-blue-100">{me.email}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20 backdrop-blur-sm">
                <Users className="h-3 w-3" />
                {initialBadge}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20 backdrop-blur-sm">
                <Languages className="h-3 w-3" />
                {localeLabel(me.locale)}
              </span>
              {me.mfaEnabled && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2.5 py-1 text-[11px] font-bold text-emerald-100 ring-1 ring-emerald-300/30 backdrop-blur-sm">
                  <ShieldCheck className="h-3 w-3" />
                  MFA actif
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
        <Field icon={User} label="Prénom" value={me.firstName || '—'} />
        <Field icon={User} label="Nom" value={me.lastName || '—'} />
        <Field icon={Mail} label="Adresse email" value={me.email} />
        <Field icon={Languages} label="Langue" value={localeLabel(me.locale)} />
      </div>

      <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-4">
        <p className="text-xs text-slate-600">
          Pour modifier votre nom ou votre email, contactez le secrétariat de l&apos;établissement.
          Le mot de passe et la double authentification se gèrent depuis le portail compte
          sécurisé (onglet <strong>Sécurité</strong>).
        </p>
      </div>
    </section>
  );
}

// =============================================================================
// Family tab — list of guardian children with class info + quick CTA
// =============================================================================

function FamilyPanel({ items }: { items: Child[] }) {
  if (items.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <EmptyState
          icon={Users}
          title="Aucun enfant rattaché"
          description="Aucun enfant n'est encore rattaché à votre compte. Faites une demande de rattachement auprès du secrétariat de l'établissement pour suivre la scolarité de votre enfant."
          tone="slate"
          action={{ label: 'Comment rattacher un enfant ?', href: '/parent/children' }}
        />
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <div className="border-b border-slate-100 px-6 py-4">
        <h2 className="text-base font-bold text-slate-900">Enfants rattachés à votre compte</h2>
        <p className="mt-1 text-xs text-slate-500">
          Vous suivez la scolarité de {items.length === 1 ? 'cet enfant' : 'ces enfants'} via
          votre portail famille. Les notifications et alertes ci-dessus s&apos;appliquent à
          chaque enfant.
        </p>
      </div>

      <ul className="divide-y divide-slate-100">
        {items.map((c) => {
          const active = c.enrollments.find((e) => e.academicYear.status === 'active');
          const age = computeAge(c.birthDate);
          const cycleColor = active?.classSection.gradeLevel?.cycle?.color ?? '#3b82f6';
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-4 px-6 py-5">
              <Avatar
                src={c.photoUrl}
                firstName={c.firstName}
                lastName={c.lastName}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-base font-bold text-slate-900">
                    {c.firstName} {c.lastName}
                  </h3>
                  {c.externalRef && (
                    <span className="text-[11px] font-semibold text-slate-400">
                      · {c.externalRef}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                  {active ? (
                    <>
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                        <GraduationCap className="h-3.5 w-3.5" style={{ color: cycleColor }} />
                        {active.classSection.gradeLevel?.name ?? active.classSection.name} ·{' '}
                        {active.classSection.name}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span>{active.academicYear.name}</span>
                    </>
                  ) : (
                    <span className="italic text-slate-400">
                      Pas d&apos;inscription active
                    </span>
                  )}
                  {age !== null && (
                    <>
                      <span className="text-slate-400">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Cake className="h-3.5 w-3.5 text-rose-500" />
                        {age} ans
                      </span>
                    </>
                  )}
                  {c.birthDate && (
                    <span className="text-slate-400">
                      (né{' '}
                      {formatDateShort(c.birthDate)})
                    </span>
                  )}
                </div>
              </div>
              <Link
                href={`/parent/dashboard?studentId=${c.id}`}
                className="inline-flex items-center gap-1 rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 ring-1 ring-blue-100 transition-colors hover:bg-blue-100"
              >
                Ouvrir le tableau de bord →
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-3 text-[11px] text-slate-500">
        Pour ajouter ou retirer un rattachement, contactez le secrétariat. Toutes les
        modifications sont consignées dans le journal d&apos;audit de l&apos;établissement.
      </div>
    </section>
  );
}

// =============================================================================
// Reusable small bits
// =============================================================================

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
      <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <Icon className="h-3 w-3" />
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
