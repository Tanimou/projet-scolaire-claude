import { Building2, Calendar, FileText, Globe2, Languages, MapPin, Palette, Sparkles } from 'lucide-react';
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

interface SchoolItem {
  id: string;
  name: string;
  schoolCode: string;
  country: string;
  timezone: string;
  locale: string;
  status: 'active' | 'closed';
  createdAt: string;
}

interface AcademicYearItem {
  id: string;
  name: string;
  status: 'active' | 'closed' | 'archived';
  startDate: string;
  endDate: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function EstablishmentPage() {
  const [branding, schools, years, me] = await Promise.all([
    fetchBranding(),
    safe(api<{ data: SchoolItem[] }>('/api/v1/schools', { cache: 'no-store' })),
    safe(
      api<{ data: AcademicYearItem[] }>('/api/v1/academic-years', { cache: 'no-store' }),
    ),
    fetchMe(),
  ]);

  // Pick the *active* school (per user preference), not blindly the first one.
  // Falls back to the first school if preference is unset/stale.
  const activeSchoolId = (me?.preferences as Record<string, unknown> | undefined)
    ?.activeSchoolId as string | undefined;
  const school =
    (activeSchoolId && schools?.data.find((s) => s.id === activeSchoolId)) ||
    schools?.data[0];
  const activeYear = years?.data.find((y) => y.status === 'active') ?? years?.data[0];

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

      {/* KPI strip */}
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
            <TabsTrigger value="branding">Identité visuelle</TabsTrigger>
            <TabsTrigger value="grading">Notation</TabsTrigger>
            <TabsTrigger value="academic">Année active</TabsTrigger>
          </TabsList>

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
