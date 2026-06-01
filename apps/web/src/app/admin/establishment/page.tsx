import {
  BookOpen,
  Building2,
  Calendar,
  ChevronRight,
  FileText,
  Globe2,
  GraduationCap,
  Languages,
  Layers,
  MapPin,
  Palette,
  School,
  Sparkles,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { BrandingForm } from '@/app/admin/school/branding/BrandingForm';
import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { fetchBranding, fetchMe } from '@/lib/me';
import {
  KpiCard,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@pilotage/ui';

export const metadata: Metadata = { title: "Établissement" };
export const dynamic = 'force-dynamic';

/** Adresse géographique structurée, alignée avec SchoolAddressSchema des contracts. */
interface SchoolAddress {
  continent?: string;
  country: string;
  city?: string;
  quartier?: string;
  line1?: string;
  postalCode?: string;
}

interface SchoolItem {
  id: string;
  name: string;
  schoolCode: string;
  country: string;
  timezone: string;
  locale: string;
  status: 'active' | 'closed';
  createdAt: string;
  /** Adresse structurée (JSON normalisé par l'API). */
  address: SchoolAddress | null;
}

interface AcademicYearItem {
  id: string;
  name: string;
  status: 'active' | 'closed' | 'archived';
  startDate: string;
  endDate: string;
}

interface CycleItem {
  id: string;
  code: string;
  name: string;
  orderIndex: number;
  color: string | null;
  _count: { gradeLevels: number };
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
 * Cycles standards du système éducatif français.
 * Sert de référence visuelle pour expliquer la hiérarchie pédagogique.
 */
const STANDARD_CYCLES = [
  {
    label: 'Maternelle',
    code: 'maternelle',
    ageRange: '3–6 ans',
    levels: 'PS, MS, GS',
    color: 'oklch(0.75 0.16 140)',
  },
  {
    label: 'Primaire',
    code: 'primaire',
    ageRange: '6–11 ans',
    levels: 'CP, CE1, CE2, CM1, CM2',
    color: 'oklch(0.68 0.18 200)',
  },
  {
    label: 'Collège',
    code: 'college',
    ageRange: '11–15 ans',
    levels: '6ème, 5ème, 4ème, 3ème',
    color: 'oklch(0.62 0.18 250)',
  },
  {
    label: 'Lycée',
    code: 'lycee',
    ageRange: '15–18 ans',
    levels: '2nde, 1ère, Terminale',
    color: 'oklch(0.58 0.20 280)',
  },
  {
    label: 'Université',
    code: 'universite',
    ageRange: '18 ans et +',
    levels: 'Licence, Master, Doctorat',
    color: 'oklch(0.55 0.18 320)',
  },
] as const;

export default async function EstablishmentPage() {
  const [branding, schools, years, cycles, me] = await Promise.all([
    fetchBranding(),
    safe(api<{ data: SchoolItem[] }>('/api/v1/schools', { cache: 'no-store' })),
    safe(
      api<{ data: AcademicYearItem[] }>('/api/v1/academic-years', { cache: 'no-store' }),
    ),
    safe(api<{ data: CycleItem[] }>('/api/v1/cycles', { cache: 'no-store' })),
    fetchMe(),
  ]);

  // Sélectionne l'école active (préférence utilisateur ou première de la liste).
  const activeSchoolId = (me?.preferences as Record<string, unknown> | undefined)
    ?.activeSchoolId as string | undefined;
  const school =
    (activeSchoolId && schools?.data.find((s) => s.id === activeSchoolId)) ||
    schools?.data[0];
  const activeYear = years?.data.find((y) => y.status === 'active') ?? years?.data[0];
  const schoolCycles = cycles?.data ?? [];

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Établissement' },
        ]}
        title="Établissement"
        subtitle="Configurez l'identité, l'année active, le système de notation et les paramètres généraux"
      />

      {/* Bande KPI */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Building2}
          tone="blue"
          label="ÉTABLISSEMENT"
          value={branding?.displayName ?? school?.name ?? '—'}
        >
          Code : {school?.schoolCode ?? '—'}
        </KpiCard>
        <KpiCard
          icon={Calendar}
          tone="green"
          label="ANNÉE EN COURS"
          value={activeYear?.name ?? '—'}
        >
          {activeYear?.startDate
            ? `Du ${new Date(activeYear.startDate).toLocaleDateString('fr-FR')} au ${new Date(activeYear.endDate).toLocaleDateString('fr-FR')}`
            : '—'}
        </KpiCard>
        <KpiCard
          icon={Languages}
          tone="violet"
          label="LANGUE & FUSEAU"
          value={school?.locale ?? 'fr-FR'}
        >
          {school?.timezone ?? 'Europe/Paris'}
        </KpiCard>
        <KpiCard
          icon={Globe2}
          tone="orange"
          label="PAYS"
          value={school?.country ?? 'FR'}
        >
          {school?.status === 'active' ? 'Actif' : 'Fermé'}
        </KpiCard>
      </div>

      <div className="mt-6">
        <Tabs defaultValue="general" variant="underline">
          <TabsList>
            <TabsTrigger value="general">Général</TabsTrigger>
            <TabsTrigger value="address">Adresse & localisation</TabsTrigger>
            <TabsTrigger value="hierarchy">Hiérarchie & cycles</TabsTrigger>
            <TabsTrigger value="branding">Identité visuelle</TabsTrigger>
            <TabsTrigger value="grading">Notation</TabsTrigger>
            <TabsTrigger value="academic">Année active</TabsTrigger>
          </TabsList>

          {/* ── Onglet Général ─────────────────────────────────────────── */}
          <TabsContent value="general">
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
              <h2 className="text-base font-bold text-slate-900">Informations générales</h2>
              <p className="mt-1 text-xs text-slate-500">
                Nom, code, pays, fuseau horaire et langue de l&apos;établissement.
              </p>
              <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field icon={Building2} label="Nom" value={school?.name ?? '—'} />
                <Field icon={FileText} label="Code école" value={school?.schoolCode ?? '—'} />
                <Field icon={Globe2} label="Pays" value={school?.country ?? '—'} />
                <Field icon={MapPin} label="Fuseau horaire" value={school?.timezone ?? '—'} />
                <Field icon={Languages} label="Langue" value={school?.locale ?? '—'} />
                <Field
                  icon={Sparkles}
                  label="Statut"
                  value={school?.status === 'active' ? 'Actif' : 'Fermé'}
                />
              </dl>
              <p className="mt-5 text-xs text-slate-500">
                Pour modifier ces informations, ouvrez la fiche de l&apos;école dans{' '}
                <Link href="/admin/schools" className="font-bold accent-text hover:underline">
                  /admin/schools
                </Link>
                .
              </p>
            </section>
          </TabsContent>

          {/* ── Onglet Adresse & localisation ──────────────────────────── */}
          <TabsContent value="address">
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
              <div className="mb-5 flex items-center gap-2">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                  <MapPin className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Adresse & localisation</h2>
                  <p className="text-xs text-slate-500">
                    Hiérarchie géographique : continent → pays → ville → quartier → établissement.
                  </p>
                </div>
              </div>

              {school?.address ? (
                <>
                  {/* Fil d'Ariane géographique */}
                  <div className="mb-6 flex flex-wrap items-center gap-1 rounded-xl bg-slate-50 px-4 py-3 text-sm">
                    {school.address.continent && (
                      <>
                        <span className="font-medium text-slate-600">{school.address.continent}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      </>
                    )}
                    <span className="font-semibold text-slate-800">{school.address.country}</span>
                    {school.address.city && (
                      <>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="font-semibold text-slate-800">{school.address.city}</span>
                      </>
                    )}
                    {school.address.quartier && (
                      <>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="font-semibold text-slate-800">{school.address.quartier}</span>
                      </>
                    )}
                    <>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="font-bold text-blue-700">{school.name}</span>
                    </>
                  </div>

                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {school.address.continent && (
                      <Field icon={Globe2} label="Continent" value={school.address.continent} />
                    )}
                    <Field icon={Globe2} label="Pays (ISO)" value={school.address.country} />
                    {school.address.city && (
                      <Field icon={MapPin} label="Ville" value={school.address.city} />
                    )}
                    {school.address.quartier && (
                      <Field icon={MapPin} label="Quartier / arrondissement" value={school.address.quartier} />
                    )}
                    {school.address.line1 && (
                      <Field icon={FileText} label="Adresse (ligne 1)" value={school.address.line1} />
                    )}
                    {school.address.postalCode && (
                      <Field icon={FileText} label="Code postal" value={school.address.postalCode} />
                    )}
                  </dl>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <MapPin className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm font-semibold text-slate-600">
                    Aucune adresse structurée configurée
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    L&apos;adresse peut être renseignée via l&apos;API (champ{' '}
                    <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[11px]">address</code>)
                    lors de la création ou modification de l&apos;école.
                  </p>
                </div>
              )}
            </section>
          </TabsContent>

          {/* ── Onglet Hiérarchie & cycles ──────────────────────────────── */}
          <TabsContent value="hierarchy">
            <div className="space-y-6">
              {/* Hiérarchie académique de l'établissement */}
              <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
                <div className="mb-5 flex items-center gap-2">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <School className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Hiérarchie académique</h2>
                    <p className="text-xs text-slate-500">
                      Structure pédagogique de l&apos;établissement : cycles → niveaux → classes.
                    </p>
                  </div>
                </div>

                {/* Fil d'Ariane pédagogique */}
                <div className="mb-6 flex flex-wrap items-center gap-1 rounded-xl bg-slate-50 px-4 py-3 text-sm">
                  <span className="font-medium text-slate-500">Groupe scolaire</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="font-semibold text-blue-700">{school?.name ?? 'Établissement'}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="font-semibold text-slate-800">Cycles</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="font-semibold text-slate-800">Niveaux</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="font-semibold text-slate-800">Classes</span>
                </div>

                {/* Cycles configurés dans cet établissement (priorité d'affichage) */}
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-600">
                    <Layers className="h-4 w-4" />
                    Cycles configurés
                    {schoolCycles.length > 0 && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                        {schoolCycles.length}
                      </span>
                    )}
                  </h3>
                  <Link
                    href="/admin/levels"
                    className="text-xs font-bold accent-text hover:underline"
                  >
                    Gérer les cycles & niveaux →
                  </Link>
                </div>

                {schoolCycles.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                    <Layers className="mx-auto h-7 w-7 text-slate-300" />
                    <p className="mt-2 text-sm font-semibold text-slate-600">Aucun cycle défini</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <Link href="/admin/levels" className="font-bold accent-text hover:underline">
                        Créer les cycles
                      </Link>{' '}
                      pour structurer l&apos;établissement en niveaux et classes.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {schoolCycles
                      .sort((a, b) => a.orderIndex - b.orderIndex)
                      .map((cycle) => (
                        <div
                          key={cycle.id}
                          className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3"
                        >
                          <div
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white shadow-sm"
                            style={{ background: cycle.color ?? 'oklch(0.62 0.18 250)' }}
                          >
                            <Layers className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-sm font-bold text-slate-900">{cycle.name}</span>
                              <code className="font-mono text-[10px] text-slate-500">{cycle.code}</code>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {cycle._count.gradeLevels} niveau{cycle._count.gradeLevels > 1 ? 'x' : ''}
                            </div>
                          </div>
                          <Link
                            href="/admin/levels"
                            className="shrink-0 text-xs font-bold accent-text hover:underline"
                          >
                            Niveaux →
                          </Link>
                        </div>
                      ))}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href="/admin/school/structure"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <School className="h-3.5 w-3.5" />
                    Vue structure complète
                  </Link>
                  <Link
                    href="/admin/classes"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <GraduationCap className="h-3.5 w-3.5" />
                    Gérer les classes
                  </Link>
                </div>
              </section>

              {/* Référentiel des cycles standards */}
              <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
                <div className="mb-5 flex items-center gap-2">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <BookOpen className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Cycles standards</h2>
                    <p className="text-xs text-slate-500">
                      Référentiel du système éducatif — à utiliser comme modèle pour créer vos cycles.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  {STANDARD_CYCLES.map((cycle) => (
                    <div
                      key={cycle.code}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                    >
                      <div
                        className="px-4 py-2.5 text-sm font-bold text-white"
                        style={{ background: cycle.color }}
                      >
                        {cycle.label}
                      </div>
                      <div className="px-4 py-3">
                        <div className="text-[11px] font-semibold text-slate-600">
                          {cycle.ageRange}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">{cycle.levels}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="mt-4 text-xs text-slate-500">
                  Ces cycles sont fournis à titre indicatif. Votre établissement peut avoir une
                  organisation différente — créez vos propres cycles dans{' '}
                  <Link href="/admin/levels" className="font-bold accent-text hover:underline">
                    Cycles & niveaux
                  </Link>
                  .
                </p>
              </section>
            </div>
          </TabsContent>

          {/* ── Onglet Identité visuelle ────────────────────────────────── */}
          <TabsContent value="branding">
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
              <div className="mb-5 flex items-center gap-2">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                  <Palette className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Identité visuelle</h2>
                  <p className="text-xs text-slate-500">
                    Logo, couleurs et police affichés sur tous les portails.
                  </p>
                </div>
              </div>
              {branding ? (
                <BrandingForm initial={branding} />
              ) : (
                <p className="text-sm text-amber-700">
                  Impossible de charger le branding actuel. Vérifiez que l&apos;API est joignable.
                </p>
              )}
            </section>
          </TabsContent>

          {/* ── Onglet Notation ─────────────────────────────────────────── */}
          <TabsContent value="grading">
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
              <h2 className="text-base font-bold text-slate-900">Système de notation</h2>
              <p className="mt-1 text-xs text-slate-500">
                Barème par défaut et seuil de réussite global.
              </p>
              <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field icon={FileText} label="Barème par défaut" value="/ 20" />
                <Field icon={FileText} label="Seuil de réussite" value="10 / 20" />
                <Field icon={FileText} label="Nb décimales affichées" value="1" />
              </dl>
              <p className="mt-5 text-xs text-slate-500">
                Les barèmes spécifiques par matière sont configurables dans{' '}
                <Link href="/admin/subjects" className="font-bold accent-text hover:underline">
                  /admin/subjects
                </Link>
                .
              </p>
            </section>
          </TabsContent>

          {/* ── Onglet Année active ─────────────────────────────────────── */}
          <TabsContent value="academic">
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
              <h2 className="text-base font-bold text-slate-900">Année académique active</h2>
              <p className="mt-1 text-xs text-slate-500">
                Une seule année peut être active à la fois.
              </p>
              {activeYear ? (
                <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field icon={Calendar} label="Année" value={activeYear.name} />
                  <Field
                    icon={Calendar}
                    label="Début"
                    value={new Date(activeYear.startDate).toLocaleDateString('fr-FR')}
                  />
                  <Field
                    icon={Calendar}
                    label="Fin"
                    value={new Date(activeYear.endDate).toLocaleDateString('fr-FR')}
                  />
                </dl>
              ) : (
                <p className="mt-4 text-sm text-amber-700">
                  Aucune année active. Activez-en une via{' '}
                  <Link
                    href="/admin/academic-years"
                    className="font-bold accent-text hover:underline"
                  >
                    /admin/academic-years
                  </Link>
                  .
                </p>
              )}
              <Link
                href="/admin/academic-years"
                className="mt-4 inline-flex items-center text-xs font-bold accent-text hover:underline"
              >
                Gérer les années académiques →
              </Link>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </PortalShell>
  );
}

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
