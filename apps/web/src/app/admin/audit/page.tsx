import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  type SelectOption,
} from '@pilotage/ui';
import {
  CircleDashed,
  Download,
  Eye,
  FileSearch,
  History,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import type { Metadata } from 'next';


import type { AuditEntry } from './AuditDetailDrawer';
import { AuditPageFilters } from './AuditPageFilters';
import { AuditTable } from './AuditTable';
import { VocabularyMarker } from './VocabularyMarker';
import { exportAuditAction } from './actions';
// Modules neutres, jamais `'use client'` : cette page est un composant serveur
// et **appelle** ces fonctions (PF-14 / S-E04-2). Voir `audit-labels.ts`.
import {
  classifyAuditPortal,
  classifyAuditResourceType,
  hasNoProvenance,
  type AuditVocabularyResolution,
} from './audit-labels';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';

export const metadata: Metadata = { title: 'Audit' };
export const dynamic = 'force-dynamic';

interface AuditResponse {
  data: AuditEntry[];
  total: number;
  kpis: {
    today: number;
    criticalChanges: number;
    sensitiveExports: number;
    /**
     * `null` = **non instrumenté**. Aucun site d'écriture n'émet d'action de
     * connexion : un `0` ici se lirait « nous avons vérifié, il n'y en a pas
     * eu », ce qui est faux. DNC-09 : aucune carte ne peut structurellement ne
     * lire que 0.
     */
    adminLogins: number | null;
  };
}

interface AuditFacetsResponse {
  resourceTypes: string[];
  portals: string[];
  actions: string[];
  actors: Array<{ id: string; name: string; role: string | null }>;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 20;

const VOCABULARY_ORDER: Record<string, number> = { canonical: 0, legacy: 1, unknown: 2 };

/**
 * Canoniques d'abord (alphabétiquement par libellé français), puis hérités,
 * puis non répertoriés. Rien n'est retiré ni regroupé — `SelectFilter` n'a pas
 * de groupes d'options et on n'en ajoute pas ici (ce serait une modification de
 * `packages/ui`) : l'ordre plus le marqueur par option suffisent, et sont
 * gratuits.
 */
function sortByVocabulary(
  resolutions: AuditVocabularyResolution[],
): AuditVocabularyResolution[] {
  return [...resolutions].sort(
    (a, b) =>
      (VOCABULARY_ORDER[a.vocabulary] ?? 3) - (VOCABULARY_ORDER[b.vocabulary] ?? 3) ||
      a.label.localeCompare(b.label, 'fr'),
  );
}

function VocabularyOptionLabel({ resolution }: { resolution: AuditVocabularyResolution }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {resolution.label}
      <VocabularyMarker vocabulary={resolution.vocabulary} />
    </span>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    action?: string;
    resourceType?: string;
    portal?: string;
    actorId?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const qs = new URLSearchParams();
  if (sp.from) qs.set('from', sp.from);
  if (sp.to) qs.set('to', sp.to);
  if (sp.action) qs.set('action', sp.action);
  if (sp.resourceType) qs.set('resourceType', sp.resourceType);
  if (sp.portal) qs.set('portal', sp.portal);
  if (sp.actorId) qs.set('actorId', sp.actorId);
  qs.set('limit', String(PAGE_SIZE));
  qs.set('offset', String(offset));

  const [resp, facets] = await Promise.all([
    safe(api<AuditResponse>(`/api/v1/analytics/audit?${qs.toString()}`, { cache: 'no-store' })),
    safe(api<AuditFacetsResponse>(`/api/v1/analytics/audit-facets`, { cache: 'no-store' })),
  ]);

  const audit = resp ?? {
    data: [],
    total: 0,
    kpis: { today: 0, criticalChanges: 0, sensitiveExports: 0, adminLogins: null },
  };
  const facetData = facets ?? { resourceTypes: [], portals: [], actions: [], actors: [] };

  // Les facettes restent **dérivées de l'observé** : elles listent ce que les
  // lignes portent réellement. On n'y ajoute pas un portail que personne
  // n'écrit (un filtre `student` serait vide en permanence), et surtout on n'en
  // retire rien — pas de `.filter(` entre le tableau de facettes et son
  // `.map(` : une valeur inclassable reste visible (DNC-08). Le tri met les
  // codes canoniques d'abord, puis les hérités, puis les non répertoriés.
  const resourceTypeOptions: SelectOption[] = sortByVocabulary(
    facetData.resourceTypes.map(classifyAuditResourceType),
  ).map((r) => ({
    value: r.code,
    label: <VocabularyOptionLabel resolution={r} />,
    hint: r.code,
  }));
  const portalOptions: SelectOption[] = sortByVocabulary(
    facetData.portals.map(classifyAuditPortal),
  ).map((r) => ({
    value: r.code,
    label: <VocabularyOptionLabel resolution={r} />,
  }));
  const actorOptions: SelectOption[] = facetData.actors.map((a) => ({
    value: a.id,
    label: a.name,
    hint: a.role ?? undefined,
  }));

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Audit' },
        ]}
        title="Journal d'audit"
        subtitle="Toutes les actions sensibles sur l'établissement, append-only et traçables"
        actions={
          <form action={exportAuditAction}>
            <input type="hidden" name="from" value={sp.from ?? ''} />
            <input type="hidden" name="to" value={sp.to ?? ''} />
            <button
              type="submit"
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
            >
              <Download className="h-4 w-4" />
              Exporter en CSV
            </button>
          </form>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={History} tone="blue" label="ACTIONS AUJOURD'HUI" value={audit.kpis.today}>
          Sur l&apos;ensemble de l&apos;établissement
        </KpiCard>
        <KpiCard
          icon={ShieldCheck}
          tone="rose"
          label="MODIFICATIONS CRITIQUES"
          value={audit.kpis.criticalChanges}
        >
          {/* Le prédicat couvre le vocabulaire canonique **et** les alias
              hérités gelés : un compteur qui enjambe silencieusement deux
              vocabulaires est interdit — il s'énonce. */}
          Suppressions et révisions · vocabulaire actuel et hérité
        </KpiCard>
        <KpiCard
          icon={FileSearch}
          tone="violet"
          label="EXPORTS SENSIBLES"
          value={audit.kpis.sensitiveExports}
        >
          {/* Les codes canoniques sont `export.*.request` : une demande n'est
              pas un téléchargement. */}
          Demandes d&apos;export de données
        </KpiCard>
        <KpiCard
          icon={UserCheck}
          tone="green"
          label="CONNEXIONS ADMIN"
          value={audit.kpis.adminLogins ?? 'Non instrumenté'}
        >
          {audit.kpis.adminLogins === null
            ? "Aucune action de connexion n'est journalisée à ce jour."
            : 'Sessions ouvertes'}
        </KpiCard>
      </div>

      <div className="mt-6">
        <AuditPageFilters
          initialQ={sp.action ?? ''}
          initialResourceType={sp.resourceType ?? ''}
          initialPortal={sp.portal ?? ''}
          initialActorId={sp.actorId ?? ''}
          initialFrom={sp.from ?? ''}
          initialTo={sp.to ?? ''}
          resourceTypeOptions={resourceTypeOptions}
          portalOptions={portalOptions}
          actorOptions={actorOptions}
        />
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {audit.data.length === 0 ? (
          <EmptyState
            icon={History}
            title="Aucune entrée d'audit"
            description={
              sp.action || sp.from || sp.to || sp.resourceType || sp.portal || sp.actorId
                ? "Aucune entrée ne correspond à vos filtres. Élargissez la période ou réinitialisez les filtres."
                : "Les actions sensibles seront enregistrées ici. Une fois écrites, elles sont append-only et ne peuvent pas être modifiées."
            }
            tone="slate"
          />
        ) : (
          <>
            <AuditTable rows={audit.data} />
            <Pagination
              page={page}
              total={audit.total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'entrée', plural: 'entrées' }}
            />
          </>
        )}
      </section>

      {/* Quand AUCUNE ligne de la page ne porte de provenance, on l'énonce
          **une fois** plutôt que vingt. C'est le résultat honnête attendu tant
          qu'aucun relais L7 ne se trouve devant Next (local, `--profile app`) :
          la ligne par ligne reste exacte, mais un auditeur mérite de savoir que
          c'est la page entière, pas une entrée isolée. Pas de teinte d'alerte —
          une provenance non enregistrée n'est pas une erreur (`ADR-036 D4`). */}
      {audit.data.length > 0 && audit.data.every(hasNoProvenance) && (
        <p className="mt-4 flex items-start gap-1.5 text-xs text-slate-500">
          <CircleDashed className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>Aucune entrée de cette page ne porte de provenance client.</span>
        </p>
      )}

      <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-500">
        <Eye className="h-3 w-3" />
        Le journal d&apos;audit est append-only : une entrée ne peut être ni modifiée ni supprimée.
        Pour les RGPD requests (oubli), seules les colonnes PII peuvent être pseudonymisées.
      </p>
    </PortalShell>
  );
}
