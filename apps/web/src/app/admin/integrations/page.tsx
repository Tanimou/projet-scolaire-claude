import { Plug, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { PageHeader } from '@pilotage/ui';

import { IntegrationsManager } from './IntegrationsManager';
import type { RosterSourceDto } from './types';

export const metadata: Metadata = { title: 'Intégrations · OneRoster' };
export const dynamic = 'force-dynamic';

/**
 * E11-S3 — "/admin/integrations" — the OneRoster roster-sync surface.
 *
 * Admin-only (server-gated on `integrations.write`). Lists connected sources +
 * lets an admin connect a new source and "Synchroniser" a OneRoster CSV bundle,
 * which lands on a normal validated ImportBatch (origin = oneroster) that
 * inherits the S1 async apply + the S2 reconciliation panel.
 *
 * Degrades kindly when the additive S3 schema isn't applied yet: the list read
 * fails (no `roster_source` table) → `unavailable`, and the page shows a calm
 * "indisponible" notice instead of crashing (the E7/E8/E9 precedent).
 */
export default async function IntegrationsPage() {
  let sources: RosterSourceDto[] | null = null;
  let unavailable = false;
  try {
    const resp = await api<{ data: RosterSourceDto[] }>('/api/v1/integrations/oneroster', {
      cache: 'no-store',
    });
    sources = resp.data;
  } catch (err) {
    if (err instanceof ApiError) {
      unavailable = true;
    } else {
      throw err;
    }
  }

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Intégrations' },
        ]}
        title="Intégrations · OneRoster"
        subtitle="Connectez une source OneRoster et synchronisez votre roster (élèves, classes, inscriptions) sans saisie manuelle — chaque synchronisation devient un import vérifié, réversible et auditable."
      />

      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:p-5">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-sm leading-relaxed text-slate-600">
          Une synchronisation OneRoster est mappée vers un import standard, puis{' '}
          <strong className="font-semibold text-slate-800">validée ligne par ligne</strong> avant toute
          écriture. Vous gardez le contrôle&nbsp;: examinez le bilan d&apos;import, appliquez quand vous
          êtes prêt·e, et annulez sous 24&nbsp;h si besoin. Le matricule unique de chaque élève
          (<code className="rounded bg-slate-100 px-1 text-[11px]">sourcedId</code>) sert d&apos;ancre
          d&apos;idempotence&nbsp;: re-synchroniser ne crée jamais de doublon.
        </p>
      </div>

      {unavailable ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-10 text-center">
          <Plug className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-slate-700">
            La synchronisation OneRoster est momentanément indisponible
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Cette fonctionnalité nécessite une mise à jour de la base de données qui n&apos;a pas encore
            été appliquée par votre administrateur système. Réessayez une fois la migration effectuée.
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <IntegrationsManager sources={sources ?? []} />
        </div>
      )}
    </PortalShell>
  );
}
