import {
  Bell,
  Database,
  Download,
  FileText,
  Palette,
  PenTool,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { Tabs, TabsContent, TabsList, TabsTrigger, PageHeader } from '@pilotage/ui';

import { PreferencesPanel, type PreferenceRow } from './PreferencesPanel';

export const metadata: Metadata = { title: 'Paramètres' };
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
 * /admin/settings — image-prescribed multi-tab settings page (spec §10.18).
 *
 * Tab "Notifications" → fully functional (R8 — per-user preferences with
 * optimistic toggles backed by /api/v1/notifications/preferences).
 * Other tabs → curated read-only summary with deep links to the page where
 * each setting actually lives today.
 */
export default async function SettingsPage() {
  const prefsResp = await safe(
    api<{ data: PreferenceRow[] }>('/api/v1/notifications/preferences', {
      cache: 'no-store',
    }),
  );
  const preferences = prefsResp?.data ?? [];

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Paramètres' },
        ]}
        title="Paramètres"
        subtitle="Configurez l'établissement, le système de notation, la sécurité et les exports"
      />

      <div className="mt-6">
        <Tabs defaultValue="notifications" variant="underline">
          <TabsList>
            <TabsTrigger value="general">Général</TabsTrigger>
            <TabsTrigger value="branding">Identité visuelle</TabsTrigger>
            <TabsTrigger value="grading">Notation</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="security">Sécurité</TabsTrigger>
            <TabsTrigger value="data">Données & confidentialité</TabsTrigger>
            <TabsTrigger value="exports">Exports</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <SettingsCard
              icon={Sparkles}
              title="Paramètres généraux"
              description="Nom, fuseau, langue et préférences globales de l'établissement"
            >
              <Field label="Nom" value="Configurable depuis /admin/establishment" />
              <Field label="Fuseau" value="Europe/Paris" />
              <Field label="Langue" value="fr-FR" />
              <Field label="Année active" value="Configurée via /admin/academic-years" />
              <Link
                href="/admin/establishment"
                className="mt-3 inline-flex text-xs font-bold accent-text hover:underline"
              >
                Ouvrir Établissement →
              </Link>
            </SettingsCard>
          </TabsContent>

          <TabsContent value="branding">
            <SettingsCard
              icon={Palette}
              title="Identité visuelle"
              description="Logo, couleurs et police personnalisés"
            >
              <Field label="Logo" value="Configurable via Établissement" />
              <Field label="Couleur primaire" value="Configurable via Établissement" />
              <Field label="Police" value="Inter (par défaut)" />
              <Link
                href="/admin/establishment"
                className="mt-3 inline-flex text-xs font-bold accent-text hover:underline"
              >
                Ouvrir l&apos;onglet Identité visuelle →
              </Link>
            </SettingsCard>
          </TabsContent>

          <TabsContent value="grading">
            <SettingsCard
              icon={PenTool}
              title="Système de notation"
              description="Barème par défaut et seuil de réussite"
            >
              <Field label="Barème par défaut" value="/ 20" />
              <Field label="Seuil de réussite" value="10 / 20" />
              <Field label="Décimales affichées" value="1" />
              <Field label="Coefficients" value="Configurables par matière + niveau" />
              <Link
                href="/admin/subjects"
                className="mt-3 inline-flex text-xs font-bold accent-text hover:underline"
              >
                Configurer les matières →
              </Link>
            </SettingsCard>
          </TabsContent>

          <TabsContent value="notifications">
            <div className="space-y-4">
              <PreferencesPanel initial={preferences} />
              <SettingsCard
                icon={Bell}
                title="Paramètres globaux des notifications"
                description="Configuration côté établissement (digest, dedup, canaux)"
              >
                <Field label="Digest hebdomadaire parents" value="Activé (samedi 9h)" />
                <Field
                  label="Délai de re-notification"
                  value="7 jours par alerte (dedup sourceId)"
                />
                <Field label="SMS" value="Désactivé (canal non câblé)" />
                <Field
                  label="Centre de notifications"
                  value="Visible sur les 3 portails — /notifications"
                />
                <Link
                  href="/admin/notifications"
                  className="mt-3 inline-flex text-xs font-bold accent-text hover:underline"
                >
                  Ouvrir le centre de notifications →
                </Link>
              </SettingsCard>
            </div>
          </TabsContent>

          <TabsContent value="security">
            <SettingsCard
              icon={ShieldCheck}
              title="Sécurité"
              description="MFA, sessions et politiques de mot de passe (gérées par Keycloak)"
            >
              <Field label="MFA pour admins" value="Obligatoire (à configurer dans Keycloak)" />
              <Field label="MFA pour enseignants" value="Recommandé" />
              <Field label="Longueur min. mot de passe" value="12 caractères (policy realm)" />
              <Field label="Verrouillage automatique" value="5 tentatives" />
              <Field label="Durée session" value="8 h (refresh token : 30 j)" />
              <Link
                href={`${process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? 'http://localhost:8180'}/realms/pilotage-scolaire/account/`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex text-xs font-bold accent-text hover:underline"
              >
                Ouvrir le portail compte Keycloak ↗
              </Link>
            </SettingsCard>
          </TabsContent>

          <TabsContent value="data">
            <SettingsCard
              icon={Database}
              title="Données & confidentialité (RGPD)"
              description="Rétention, droit à l'oubli et partage de données"
            >
              <Field label="Rétention historique notes" value="5 ans après diplôme" />
              <Field label="Rétention audit log" value="10 ans (append-only)" />
              <Field label="Droit à l&apos;oubli" value="Pseudonymisation possible sur demande" />
              <Field label="Partage de données" value="Aucun export externe automatique" />
              <Link
                href="/admin/audit"
                className="mt-3 inline-flex text-xs font-bold accent-text hover:underline"
              >
                Consulter le journal d&apos;audit →
              </Link>
            </SettingsCard>
          </TabsContent>

          <TabsContent value="exports">
            <SettingsCard
              icon={Download}
              title="Exports"
              description="Configuration des formats et destinataires des exports"
            >
              <Field label="Format bulletin par défaut" value="PDF (pdfkit, A4)" />
              <Field label="Format grilles de notes" value="XLSX (exceljs)" />
              <Field label="Conservation des fichiers" value="MinIO bucket pilotage/exports" />
              <Field label="URL signée téléchargement" value="TTL 1 h (présigné AWS SDK)" />
              <Link
                href="/admin/exports"
                className="mt-3 inline-flex text-xs font-bold accent-text hover:underline"
              >
                Ouvrir Exports →
              </Link>
            </SettingsCard>
          </TabsContent>
        </Tabs>
      </div>

      <p className="mt-6 text-xs text-slate-500">
        💡 L&apos;onglet <strong>Notifications</strong> est éditable directement ici. Les autres
        onglets pointent vers les pages dédiées où chaque réglage se modifie (Établissement,
        Matières, Audit, Exports, Keycloak).
      </p>
    </PortalShell>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
      <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <FileText className="h-3 w-3" />
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
