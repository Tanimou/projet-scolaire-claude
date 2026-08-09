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
  FileDown,
  History,
  Info,
  ListFilter,
  ShieldAlert,
  TriangleAlert,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import type { ComponentType } from 'react';


import type { AuditEntry } from './AuditDetailDrawer';
import { AuditPageFilters } from './AuditPageFilters';
import { AuditTable } from './AuditTable';
import { VocabularyMarker } from './VocabularyMarker';
import { exportAuditAction } from './actions';
import {
  resolveAuditKpiState,
  type AuditAppliedFilters,
  type AuditKpiKey,
  type AuditKpiPayload,
  type AuditKpiState,
} from './audit-kpi-state';
// Modules neutres, jamais `'use client'` : cette page est un composant serveur
// et **appelle** ces fonctions (PF-14 / S-E04-2). Voir `audit-labels.ts`.
import {
  classifyAuditPortalFilterValue,
  classifyAuditResourceType,
  hasNoProvenance,
  isAuditPortalNone,
  type AuditVocabularyResolution,
} from './audit-labels';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';

export const metadata: Metadata = { title: 'Audit' };
export const dynamic = 'force-dynamic';

/**
 * L'enveloppe servie par `/api/v1/analytics/audit` (S-E04-5).
 *
 * **Rupture assumée, dans le même commit que son unique consommateur** :
 * `kpis.today` et `kpis.adminLogins` ont disparu, les quatre KPI sont désormais
 * des objets `{ value, scope, label }`, et `filters` renvoie l'écho de ce qui a
 * réellement été appliqué — dont le fuseau **résolu côté serveur**.
 *
 * Pourquoi `label` vient du serveur : le titre et le chiffre sont produits par
 * le même calcul. Un titre codé en dur ici et un prédicat modifié là-bas
 * dériveraient sans qu'aucun test ne rougisse — c'est la classe de défaut que
 * « ACTIONS AUJOURD'HUI » posée au-dessus d'un compteur *de toute l'histoire*
 * illustrait exactement.
 */
interface AuditResponse {
  data: AuditEntry[];
  total: number;
  kpis: {
    eventsInRange: AuditKpiPayload;
    criticalChanges: AuditKpiPayload;
    sensitiveExports: AuditKpiPayload;
    distinctActors: AuditKpiPayload;
  };
  filters: AuditAppliedFilters;
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
 * Les quatre cartes, dans l'ordre de lecture.
 *
 * Le `label` n'est **pas** déclaré ici : il vient de la réponse. Ce qui est
 * déclaré est ce que le serveur ne peut pas fournir — l'icône, la teinte, la
 * note définitionnelle — plus un titre de **repli**, utilisé uniquement quand
 * l'API n'a pas répondu et qu'il n'existe donc aucune charge utile à lire.
 */
const KPI_CARDS: ReadonlyArray<{
  key: AuditKpiKey;
  icon: ComponentType<{ className?: string }>;
  tone: 'blue' | 'rose' | 'violet' | 'teal';
  fallbackLabel: string;
  note: string;
}> = [
  {
    key: 'eventsInRange',
    icon: ListFilter,
    tone: 'blue',
    fallbackLabel: 'ACTIONS FILTRÉES',
    // Rendre deux fois le même nombre ressemble à un doublon tant qu'on ne dit
    // pas que c'est une **invariante** : la carte et le tableau sont calculés
    // sur le même `where`, et la valeur *est* le total, pas un second comptage.
    note: 'Identique au total du tableau ci-dessous — même filtre, même requête.',
  },
  {
    key: 'criticalChanges',
    // `ShieldCheck` — un bouclier rassurant — au-dessus d'un compteur de
    // modifications critiques : l'œil résolvait la contradiction du mauvais côté.
    icon: ShieldAlert,
    tone: 'rose',
    fallbackLabel: 'MODIFICATIONS CRITIQUES',
    note: 'Suppressions et révisions · vocabulaire actuel et hérité.',
  },
  {
    key: 'sensitiveExports',
    icon: FileDown,
    tone: 'violet',
    fallbackLabel: 'EXPORTS SENSIBLES',
    // Le prédicat porte sur l'**action**, pas sur `resourceType = 'export_job'` :
    // aucune ligne héritée ne porte ce type structurel, et le critère structurel
    // perdait mesurablement les demandes d'export déjà journalisées.
    note: 'Demandes d’export de données · vocabulaire actuel et hérité.',
  },
  {
    key: 'distinctActors',
    icon: Users,
    tone: 'teal',
    fallbackLabel: 'ACTEURS DISTINCTS',
    // Un compteur d'acteurs distincts qui avalerait silencieusement les lignes
    // sans acteur serait le défaut « compteur de toute l'histoire » sous un
    // autre chapeau : il s'énonce.
    note: 'Comptes ayant agi sur la période · les entrées système, sans acteur identifiable, ne sont pas comptées.',
  },
];

/**
 * Canoniques d'abord (alphabétiquement par libellé français), puis hérités,
 * puis non répertoriés, puis la sentinelle « Sans portail » — qui n'est pas un
 * code du vocabulaire mais une valeur de filtre, et se range donc en dernier.
 * Rien n'est retiré ni regroupé — `SelectFilter` n'a pas de groupes d'options et
 * on n'en ajoute pas ici (ce serait une modification de `packages/ui`) : l'ordre
 * plus le marqueur par option suffisent, et sont gratuits.
 */
function vocabularyRank(resolution: AuditVocabularyResolution): number {
  if (isAuditPortalNone(resolution.code)) return 9;
  return VOCABULARY_ORDER[resolution.vocabulary] ?? 3;
}

function sortByVocabulary(
  resolutions: AuditVocabularyResolution[],
): AuditVocabularyResolution[] {
  return [...resolutions].sort(
    (a, b) => vocabularyRank(a) - vocabularyRank(b) || a.label.localeCompare(b.label, 'fr'),
  );
}

function VocabularyOptionLabel({ resolution }: { resolution: AuditVocabularyResolution }) {
  // La sentinelle ne porte pas de marqueur « Code non répertorié » : ce n'est
  // pas un code égaré, c'est l'absence de portail, et son `hint` le dit.
  if (isAuditPortalNone(resolution.code)) return <>{resolution.label}</>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {resolution.label}
      <VocabularyMarker vocabulary={resolution.vocabulary} />
    </span>
  );
}

/**
 * Une carte KPI.
 *
 * Trois états, trois rendus, aucun recouvrement — voir `audit-kpi-state.ts` :
 * une valeur mesurée (y compris un `0` honnête), « Non instrumenté » quand la
 * mesure a été lue et qu'il n'y a rien à lire, « — » + « Indisponible » quand
 * l'appel n'a pas abouti. Un `0` n'est **jamais** fabriqué pour un appel qui n'a
 * pas répondu (PF-139).
 */
function AuditKpi({
  state,
  icon,
  tone,
}: {
  state: AuditKpiState;
  icon: ComponentType<{ className?: string }>;
  tone: 'blue' | 'rose' | 'violet' | 'teal';
}) {
  const unavailable = state.kind === 'unavailable';
  return (
    <KpiCard
      icon={icon}
      // La teinte d'une carte indisponible ne prétend plus rien de son domaine.
      tone={unavailable ? 'amber' : tone}
      label={state.label}
      value={state.display}
      className={unavailable ? 'ring-amber-200' : undefined}
    >
      {/* La portée est rendue **sous la valeur**, toujours visible, jamais une
          infobulle : une portée qu'on ne peut pas lire est une portée qui n'est
          pas rendue (AC-3). `slate-600` sur blanc ≈ 7.4:1 (AA ✓). */}
      <span className="block leading-snug text-slate-600">{state.scope}</span>
      {state.note && <span className="mt-1 block leading-snug text-slate-500">{state.note}</span>}
    </KpiCard>
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
  // `portal` peut valoir la sentinelle `__none__` : elle est transmise telle
  // quelle et **décodée côté serveur** en `{ portal: null }`. Le client
  // n'envoie jamais de `null` littéral (PF-123).
  if (sp.portal) qs.set('portal', sp.portal);
  if (sp.actorId) qs.set('actorId', sp.actorId);
  qs.set('limit', String(PAGE_SIZE));
  qs.set('offset', String(offset));
  // L'URL de la page elle-même (« Réessayer ») — pas la query de l'API : elle ne
  // porte ni `limit` ni `offset`, qui appartiennent à l'appel, pas à l'écran.
  const pageQs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v) pageQs.set(k, v);
  // Aucun paramètre `timezone` n'est envoyé, jamais : le fuseau est résolu
  // depuis `Tenant.timezone` côté serveur et seulement **renvoyé**.

  const [resp, facets] = await Promise.all([
    safe(api<AuditResponse>(`/api/v1/analytics/audit?${qs.toString()}`, { cache: 'no-store' })),
    safe(api<AuditFacetsResponse>(`/api/v1/analytics/audit-facets`, { cache: 'no-store' })),
  ]);

  // Deux pannes indépendantes, deux phrases indépendantes. `resp === null` veut
  // dire « la mesure n'a pas pu être lue » — pas « il n'y a rien » : aucun `0`
  // et aucun état vide n'est synthétisé à partir d'un appel qui n'a pas abouti.
  const kpisUnavailable = resp === null;
  const facetsUnavailable = facets === null;

  const rows = resp?.data ?? [];
  const total = resp?.total ?? 0;
  const facetData = facets ?? { resourceTypes: [], portals: [], actions: [], actors: [] };

  // L'écho serveur est la **seule** source de la fenêtre affichée. Sans réponse,
  // rien n'est résolu et la page le dit plutôt que de deviner un fuseau.
  const appliedFilters: AuditAppliedFilters = resp?.filters ?? {
    timezone: '',
    from: sp.from ?? null,
    to: sp.to ?? null,
  };
  const resolvedTimezone = appliedFilters.timezone || null;
  const tenantToday = resolvedTimezone
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: resolvedTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())
    : null;

  const kpiStates = KPI_CARDS.map((card) => ({
    ...card,
    state: resolveAuditKpiState({
      responseMissing: kpisUnavailable,
      payload: resp?.kpis?.[card.key],
      fallbackLabel: card.fallbackLabel,
      filters: appliedFilters,
      note: card.note,
    }),
  }));

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
  // La sentinelle « Sans portail » n'est offerte que si le serveur l'a mise dans
  // la facette, c'est-à-dire seulement s'il existe une ligne sans portail :
  // offrir un filtre qui ne peut rien renvoyer serait DNC-09 dans la barre de
  // filtres (PF-123).
  const portalOptions: SelectOption[] = sortByVocabulary(
    facetData.portals.map(classifyAuditPortalFilterValue),
  ).map((r) => ({
    value: r.code,
    label: <VocabularyOptionLabel resolution={r} />,
    hint: isAuditPortalNone(r.code) ? 'portail non enregistré' : undefined,
  }));
  const actorOptions: SelectOption[] = facetData.actors.map((a) => ({
    value: a.id,
    label: a.name,
    hint: a.role ?? undefined,
  }));

  const hasFilters = Boolean(
    sp.action || sp.from || sp.to || sp.resourceType || sp.portal || sp.actorId,
  );

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

      {kpisUnavailable && (
        // `role="status"` et non `alert` : c'est un constat, pas une
        // interruption. « Réessayer » est un lien vers la même URL — la page est
        // `force-dynamic`, aucune machine à états cliente n'est nécessaire.
        <div
          role="status"
          className="mt-6 flex flex-wrap items-start gap-2 rounded-2xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            <strong className="font-semibold">Indicateurs indisponibles.</strong> Le service
            d&apos;analytique n&apos;a pas répondu. Les entrées ci-dessous peuvent être
            incomplètes. Ni les compteurs ni le tableau ne doivent être cités tant que cet
            avertissement est affiché.
          </p>
          <a
            href={`/admin/audit?${pageQs.toString()}`}
            className="inline-flex h-9 items-center rounded-xl bg-amber-100 px-3 font-semibold text-amber-900 transition hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
          >
            Réessayer
          </a>
        </div>
      )}

      {facetsUnavailable && (
        <p
          role="status"
          className="mt-3 flex items-start gap-1.5 text-xs text-slate-600"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Les listes de filtres n&apos;ont pas pu être chargées.
        </p>
      )}

      {/* Quatre cartes flottaient jusqu'ici sans étiquette de groupe entre
          l'en-tête et les filtres : à la lecture d'écran, rien ne les
          rassemblait. */}
      <section aria-labelledby="audit-kpis" className="mt-6">
        <h2 id="audit-kpis" className="sr-only">
          Indicateurs du journal d&apos;audit
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpiStates.map((card) => (
            <AuditKpi key={card.key} state={card.state} icon={card.icon} tone={card.tone} />
          ))}
        </div>
      </section>

      {/* Le retrait d'une carte est lui-même une déclaration de gouvernance : il
          se dit à l'endroit où la carte se trouvait, en permanence, ni en toast
          ni en infobulle. « Non instrumenté » reste l'état déclaré d'un KPI dont
          le prédicat est vide — il n'est simplement plus atteint par aucune des
          quatre cartes. */}
      <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          La carte « Connexions admin » a été retirée : aucune action de connexion n&apos;est
          journalisée aujourd&apos;hui, une carte ne peut donc rien en affirmer — ni un nombre, ni
          un zéro. L&apos;audit des sessions est porté par V3-E05 (PF-26). « Actions
          aujourd&apos;hui » disparaît avec elle : le compteur était calculé dans le fuseau du
          serveur et comptait toute l&apos;histoire de l&apos;établissement sous un titre qui
          promettait une journée.
        </span>
      </p>

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
          timezone={resolvedTimezone}
          tenantToday={tenantToday}
        />
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {kpisUnavailable ? (
          // Un état d'échec, **pas** un état vide : « Aucune entrée ne
          // correspond à vos filtres » est une affirmation, et nous n'avons rien
          // vérifié du tout.
          <EmptyState
            icon={TriangleAlert}
            title="Entrées indisponibles"
            description="Le journal n’a pas pu être lu. Cet écran n’affirme pas qu’il est vide : il indique qu’il n’a pas de réponse. Réessayez, puis signalez la panne si elle persiste."
            tone="amber"
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="Aucune entrée d'audit"
            description={
              hasFilters
                ? "Aucune entrée ne correspond à vos filtres. Élargissez la période ou réinitialisez les filtres."
                : "Les actions sensibles seront enregistrées ici. Une fois écrites, elles sont append-only et ne peuvent pas être modifiées."
            }
            tone="slate"
          />
        ) : (
          <>
            <AuditTable rows={rows} />
            <Pagination
              page={page}
              total={total}
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
      {rows.length > 0 && rows.every(hasNoProvenance) && (
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
