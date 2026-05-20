import { Lock, Settings, User } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
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

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function TeacherSettingsPage() {
  const [prefsResp, displayResp] = await Promise.all([
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
  ]);
  const preferences = prefsResp?.data ?? [];
  const display: DisplayPreferences = displayResp?.data ?? DISPLAY_PREFS_DEFAULTS;

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Paramètres' },
        ]}
        title="Paramètres"
        subtitle="Préférences personnelles, notifications, sécurité du compte"
      />

      <div className="mt-6">
        <Tabs defaultValue="notifications" variant="underline">
          <TabsList>
            <TabsTrigger value="profile">Profil</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="display">Affichage</TabsTrigger>
            <TabsTrigger value="security">Sécurité</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
              <EmptyState
                icon={User}
                title="Édition du profil bientôt disponible"
                description="Mise à jour de votre photo, spécialité, biographie et coordonnées professionnelles. Pour modifier votre nom ou email, contactez l'administration."
                tone="slate"
              />
            </section>
          </TabsContent>

          <TabsContent value="notifications">
            <PreferencesPanel initial={preferences} />
          </TabsContent>

          <TabsContent value="display">
            <DisplayPreferencesPanel initial={display} portal="teacher" />
          </TabsContent>

          <TabsContent value="security">
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
              <EmptyState
                icon={Lock}
                title="Sécurité du compte"
                description="Changement de mot de passe, activation MFA, sessions actives — gérés depuis votre portail compte Keycloak."
                tone="slate"
                action={{
                  label: 'Ouvrir le portail compte Keycloak',
                  href: `${process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? 'http://localhost:8180'}/realms/pilotage-scolaire/account/`,
                }}
              />
            </section>
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
