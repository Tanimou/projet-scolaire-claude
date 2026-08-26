import {
  GUARDIANSHIP_LINK_STATUSES,
  GUARDIANSHIP_SCOPE_LABEL,
  type GuardianshipLinkStatus,
  type GuardianshipPendingRequestRow,
  type GuardianshipPendingRequestPage,
} from '@pilotage/contracts';
import {
  AvatarNameCell,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  RowActions,
  StatusBadge,
  formatDateShort,
} from '@pilotage/ui';
import { Check, Clock, Inbox, UserPlus, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EnrollmentsExportButton } from './EnrollmentsExportButton';
import {
  EnrollmentsPageTabs,
  type EnrollmentsTab,
  type EnrollmentsTabCounts,
} from './EnrollmentsPageTabs';

import { PortalShell } from '@/components/PortalShell';
import { ReadErrorState } from '@/components/ReadErrorState';
import { api } from '@/lib/api-client';
import { isAccessDenied, read } from '@/lib/read-result';

export const metadata: Metadata = { title: 'Inscriptions' };
export const dynamic = 'force-dynamic';

/**
 * `/admin/enrollments` — la file des demandes de rattachement (S-E03-5, PF-20).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE PAGE AFFICHAIT AVANT LE 2026-08-26, ET POURQUOI
 * ══════════════════════════════════════════════════════════════════════════
 * L'admin lisait « Demandes en attente : 28 » sur son tableau de bord, cliquait
 * « Examiner », atterrissait ici, et lisait « Aucune demande dans cet onglet —
 * les demandes apparaîtront ici dès que des parents les soumettront depuis leur
 * portail. » Le produit n'affichait pas seulement zéro : il **expliquait** ce
 * zéro par une phrase qui blâmait les parents. Un mensonge rédigé, pas un bug
 * silencieux.
 *
 * Le mécanisme, en quatre pas :
 *   1. la page appelait `GET /guardians?includePending=true&limit=200` ;
 *   2. cet endpoint rend des lignes **Guardian** — un modèle sans `status` ni
 *      `notes` ;
 *   3. la page déclarait à la main une `interface EnrollmentRequestRow` portant
 *      un `status` typé par une union des trois littéraux de l'énum —
 *      c'est-à-dire la forme d'une **Guardianship** — et la passait à
 *      `api<T>()`, qui **caste sans valider** ;
 *   4. les cinq filtres évaluaient donc `undefined === 'pending'` — toujours
 *      faux. Cinq onglets et cinq badges structurellement vides, pour tout
 *      tenant, toujours.
 *
 * `DNC-01` (le KPI contredit son propre registre) et `DNC-06` (un onglet
 * incapable de rien montrer) sur le même écran.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * LES QUATRE CHOSES QUI CHANGENT, ET CE QUI LES REND NON-RÉCIDIVANTES
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **1. La forme de ligne vient du contrat, elle n'est plus recopiée.**
 * `GuardianshipPendingRequestRow` (`@pilotage/contracts`, §2.8 de
 * `guardianship/link-liveness.ts`) est déclarée UNE fois et lue par le
 * producteur comme par le consommateur. C'est la classe `PF-371` — « un MIROIR
 * FE écrit à la main d'un contrat livré, sans rien qui tienne les deux en
 * phase ». Un miroir corrigé se re-décale ; un miroir **supprimé** ne le peut
 * plus, et une divergence de forme devient un typecheck rouge.
 *
 * **2. Les onglets dérivent de l'énum, pas d'une liste écrite à la main.**
 * `TAB_VALUES` est construit à partir de `GUARDIANSHIP_LINK_STATUSES` + `all`.
 * Deux conséquences voulues :
 *   • l'onglet **« À vérifier » disparaît**. Il exigeait
 *     `parseReview(notes) === 'to_verify'`, où `notes` était censé porter une
 *     enveloppe JSON `{kind, review}` — enveloppe dont **aucun producteur
 *     n'existe** : les trois écritures de cette colonne
 *     (`guardians.controller.ts:319/:339/:375`) y mettent le texte libre du
 *     champ `notes` du DTO. Réparer la forme de ligne SANS retirer cet onglet
 *     l'aurait laissé vide pour toujours : `DNC-06` **déplacé** au lieu d'être
 *     retiré, ce que G-DNC interdit nommément. La revue projette donc depuis le
 *     FAIT — `Guardianship.status` — exactement comme ADR-073 l'a déjà tranché
 *     pour la provenance ;
 *   • `parseRequestType()` part avec lui, pour la même raison : `kind` n'a pas
 *     davantage de producteur, et **toute** ligne de cette file est un
 *     rattachement. La colonne « Type » cesse d'annoncer une distinction que
 *     rien ne peut produire ; la place revient au lien de parenté, qui, lui,
 *     est écrit à chaque création.
 *
 * **3. Aucun nombre affiché ne vient d'un `.length`.**
 * Les quatre KPI et les quatre badges d'onglet lisent `totalsByStatus`, des
 * totaux **serveur** calculés sur le même `where` que les lignes. L'ancienne
 * page les dérivait d'un `.length` sur une lecture plafonnée à 200 parents,
 * pendant que le tableau de bord comptait côté serveur : corriger `status`
 * seul aurait remplacé « 28 contre 0 » par « 28 contre 19 » — la contradiction
 * déplacée, plus discrète, donc pire. C'est aussi pourquoi la pagination est
 * serveur : une page de 10 lignes ne peut plus prétendre porter un total.
 *
 * **4. Une lecture échouée n'est plus une affirmation sur l'établissement.**
 * Le `safe()` local (qui écrasait `null` et `[]` en un seul état) est remplacé
 * par `read()` + `ReadErrorState` (S-E03-2 / PF-05 / PF-346). Un 403, un 404 ou
 * un 500 rendent un état d'erreur — jamais « Aucune demande », jamais un `0` de
 * KPI, jamais un badge d'onglet. Un `0` inventé sur une panne est précisément
 * le défaut que cette tranche ferme ; le réintroduire sur la voie d'échec
 * l'aurait rouvert d'un cran plus bas.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * CE QUI RESTE OUVERT, DIT ICI PLUTÔT QUE TU
 * ══════════════════════════════════════════════════════════════════════════
 * • L'export CSV ne porte que la **page courante** : la lecture est paginée
 *   côté serveur et la page n'a pas les autres lignes. Le fichier le DIT dans
 *   son en-tête (« N sur T »). Un CSV est durable et se partage : le laisser
 *   affirmer implicitement l'exhaustivité aurait été la même faute que le KPI.
 * • La portée est l'**école** (`student.schoolId`, ADR-075 §D2), la même que
 *   celle du KPI du tableau de bord et du centre d'action. La chaîne de portée
 *   affichée est identique aux trois endroits : c'est la vérification visuelle
 *   qu'aucune des trois n'a divergé.
 */

const PAGE_SIZE = 10;

/**
 * La portée du nombre, IMPORTÉE et jamais recopiée (ADR-041 §D3, ADR-075 §D5).
 *
 * La carte de cette page, le KPI du tableau de bord (`analytics.service.ts`, via
 * `KpiData.scope`) et la réponse de l'endpoint (`guardianshipScope`) rendent
 * TOUS les trois cette même constante. C'est ce qui rend la vérification de
 * portée visible à l'œil : si deux surfaces affichaient deux libellés, elles ne
 * compteraient pas la même population et l'une des deux mentirait.
 *
 * ⚠ CE FICHIER A RECOPIÉ CETTE CHAÎNE À LA MAIN, ET LA COPIE DIVERGEAIT DE
 * L'ORIGINAL D'UNE APOSTROPHE (`'` U+0027 contre `’` U+2019). Les trois surfaces
 * affichaient donc des libellés DIFFÉRENTS sous un docblock affirmant qu'ils
 * étaient identiques : le mécanisme de vérification s'était cassé, en silence,
 * avant même d'avoir servi. C'est `PF-371` (« un miroir FE écrit à la main d'un
 * contrat livré ») observé dans la tranche qui prétend le faire reculer — d'où
 * l'import, plutôt qu'une correction de caractère.
 */
const AWAITING_SCOPE = GUARDIANSHIP_SCOPE_LABEL.awaitingDecision;

const TAB_META: Record<EnrollmentsTab, { label: string; slug: string; empty: string }> = {
  all: { label: 'Toutes', slug: 'toutes', empty: 'Aucune demande' },
  pending: { label: 'En attente', slug: 'en-attente', empty: 'Aucune demande en attente' },
  active: { label: 'Approuvées', slug: 'approuvees', empty: 'Aucune demande approuvée' },
  revoked: { label: 'Rejetées', slug: 'rejetees', empty: 'Aucune demande rejetée' },
};

/**
 * Les onglets valides, DÉRIVÉS de l'énum du contrat — jamais réécrits.
 *
 * `GUARDIANSHIP_LINK_STATUSES` est tenu byte-identique à l'énum Prisma par le
 * cliquet de `link-liveness.ts` §2.1. Un quatrième état ajouté au schéma
 * apparaît donc ici automatiquement, au lieu de créer un onglet manquant que
 * personne ne remarquerait — la leçon `academic_year.SELECT` du run 59 : deux
 * listes tenues à la main dérivent toujours.
 */
const TAB_VALUES: readonly EnrollmentsTab[] = ['all', ...GUARDIANSHIP_LINK_STATUSES];

function isTab(value: string | undefined): value is EnrollmentsTab {
  return value !== undefined && (TAB_VALUES as readonly string[]).includes(value);
}

const STATUS_BADGE: Record<
  GuardianshipLinkStatus,
  { label: string; tone: 'warning' | 'success' | 'danger' }
> = {
  pending: { label: 'En attente', tone: 'warning' },
  active: { label: 'Approuvée', tone: 'success' },
  revoked: { label: 'Rejetée', tone: 'danger' },
};

const RELATIONSHIP_LABEL: Record<string, string> = {
  mother: 'Mère',
  father: 'Père',
  legal_guardian: 'Tuteur',
  grandparent: 'Grand-parent',
  sibling: 'Frère/Sœur',
  other: 'Autre',
};

function relationshipLabel(value: string): string {
  return RELATIONSHIP_LABEL[value] ?? value;
}

/**
 * La classe de l'élève, ou `—`.
 *
 * `classSection` est NULLABLE dans le contrat : une inscription peut exister
 * sans affectation de classe. Le `?.` n'est donc pas de la prudence
 * décorative — sans lui, une ligne parfaitement valide ferait planter le
 * rendu serveur de la page entière.
 */
function classLabel(row: GuardianshipPendingRequestRow): string {
  return row.student.enrollments[0]?.classSection?.name ?? '—';
}

export default async function EnrollmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const tab: EnrollmentsTab = isTab(sp.tab) ? sp.tab : 'pending';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  // L'onglet `all` n'envoie AUCUN `status` — « tous les états » est l'absence
  // de filtre, pas un littéral d'URL de plus recopié dans un `where`.
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (tab !== 'all') qs.set('status', tab);

  const queue = await read(
    'admin-enrollments/pending-requests',
    api<GuardianshipPendingRequestPage>(
      `/api/v1/guardians/guardianships/pending-requests?${qs.toString()}`,
      { cache: 'no-store' },
    ),
  );

  const header = (
    <PageHeader
      breadcrumb={[
        { label: 'Tableau de bord', href: '/admin/dashboard' },
        { label: 'Inscriptions' },
      ]}
      title="Inscriptions"
      subtitle="Validez les demandes de rattachement des élèves"
      actions={
        queue.ok ? (
          <EnrollmentsExportButton
            rows={queue.data.data.map((r) => ({
              guardianFirstName: r.guardian.firstName,
              guardianLastName: r.guardian.lastName,
              guardianEmail: r.guardian.email,
              guardianPhone: r.guardian.phone,
              studentFirstName: r.student.firstName,
              studentLastName: r.student.lastName,
              relationship: relationshipLabel(r.relationship),
              className: r.student.enrollments[0]?.classSection?.name ?? '',
              statusLabel: STATUS_BADGE[r.status].label,
              createdAt: r.createdAt,
            }))}
            tabLabel={TAB_META[tab].label}
            tabSlug={TAB_META[tab].slug}
            total={queue.data.total}
          />
        ) : undefined
      }
    />
  );

  // ───────────────────────────────────────────────────────────────────────
  // Voie d'échec. AUCUN chiffre n'est rendu ici : ni KPI à `0`, ni badge
  // d'onglet, ni `EmptyState`. « Nous n'avons pas pu lire » et « nous avons lu,
  // il n'y a rien » sont deux phrases différentes ; les confondre transforme
  // une panne en fait sur l'établissement (PF-05 / PF-346).
  // ───────────────────────────────────────────────────────────────────────
  if (!queue.ok) {
    const denied = isAccessDenied(queue);
    return (
      <PortalShell portal="admin">
        {header}
        <ReadErrorState
          className="mt-6"
          variant={denied ? 'denied' : 'failure'}
          title={
            denied
              ? 'Cette file ne vous est pas accessible'
              : "Nous n'avons pas pu charger les demandes"
          }
          description={
            denied
              ? "Votre rôle ne donne pas accès aux demandes de rattachement de cet établissement. Contactez un administrateur du réseau."
              : "Le service n'a pas répondu. Réessayez dans quelques instants — les demandes existantes ne sont pas affectées."
          }
          retryable={!denied}
          secondaryAction={{ label: 'Retour au tableau de bord', href: '/admin/dashboard' }}
        />
      </PortalShell>
    );
  }

  const { data: rows, total, totalsByStatus } = queue.data;

  // Le total de l'onglet « Toutes » est la SOMME des comptes serveur par
  // état, pas un `.length`. `totalsByStatus` porte un compte pour CHAQUE
  // membre de l'énum (le serveur y met `0` plutôt que d'omettre la clé),
  // donc la somme est exacte, et elle le reste le jour où un quatrième état
  // apparaît.
  const tabCounts: EnrollmentsTabCounts = {
    ...totalsByStatus,
    all: GUARDIANSHIP_LINK_STATUSES.reduce((sum, s) => sum + totalsByStatus[s], 0),
  };

  return (
    <PortalShell portal="admin">
      {header}

      {/* KPI strip — chaque valeur est un total SERVEUR, chaque carte porte sa portée. */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Clock}
          tone="orange"
          label="DEMANDES EN ATTENTE"
          value={totalsByStatus.pending}
          scope={AWAITING_SCOPE}
        >
          À traiter rapidement
        </KpiCard>
        <KpiCard
          icon={Check}
          tone="green"
          label="APPROUVÉES"
          value={totalsByStatus.active}
          scope="Rattachements acceptés, tout historique confondu, pour cette école."
        >
          Demandes acceptées
        </KpiCard>
        <KpiCard
          icon={X}
          tone="rose"
          label="REJETÉES"
          value={totalsByStatus.revoked}
          scope="Rattachements refusés ou révoqués, tout historique confondu, pour cette école."
        >
          Demandes refusées
        </KpiCard>
        <KpiCard
          icon={Inbox}
          tone="slate"
          label="TOTAL DES DEMANDES"
          value={tabCounts.all}
          scope="Toutes les demandes de rattachement de cette école, tous états confondus."
        >
          Tous états confondus
        </KpiCard>
      </div>

      {/* Tabs */}
      <div className="mt-6">
        <EnrollmentsPageTabs activeTab={tab} tabs={TAB_VALUES} counts={tabCounts} />
      </div>

      {/* Table */}
      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {rows.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title={TAB_META[tab].empty}
            /* La cause disparaît : la page ne sait pas POURQUOI il n'y a rien —
               elle sait seulement qu'il n'y a rien. L'ancienne description
               affirmait que les parents n'avaient rien soumis. */
            description={
              tab === 'pending'
                ? 'Toutes les demandes de rattachement ont été traitées.'
                : 'Rien à afficher pour ce filtre.'
            }
            tone="slate"
          />
        ) : (
          <>
            {/* Mobile (< sm) : une liste de cartes. Un tableau à 7 colonnes en
                défilement horizontal masquait au doigt les deux colonnes
                décisionnelles — Statut et Actions. Même patron que
                `@/components/meeting-requests/MeetingRequestList`. */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {rows.map((r) => (
                <li key={r.id} className="density-row space-y-3 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <AvatarNameCell
                      firstName={r.guardian.firstName}
                      lastName={r.guardian.lastName}
                      sub={r.guardian.email ?? r.guardian.phone ?? undefined}
                      tone="rose"
                    />
                    <StatusBadge
                      status={r.status}
                      label={STATUS_BADGE[r.status].label}
                      tone={STATUS_BADGE[r.status].tone}
                      size="sm"
                      withDot
                    />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    <dt className="font-semibold text-slate-500">Élève</dt>
                    <dd className="text-right font-semibold text-slate-900">
                      <Link
                        href={`/admin/students/${r.student.id}`}
                        className="rounded hover:underline"
                      >
                        {r.student.firstName} {r.student.lastName}
                      </Link>
                    </dd>
                    <dt className="font-semibold text-slate-500">Lien</dt>
                    <dd className="text-right text-slate-700">
                      {relationshipLabel(r.relationship)}
                    </dd>
                    <dt className="font-semibold text-slate-500">Classe</dt>
                    <dd className="text-right text-slate-700">{classLabel(r)}</dd>
                    <dt className="font-semibold text-slate-500">Reçue le</dt>
                    <dd className="text-right text-slate-700">{formatDateShort(r.createdAt)}</dd>
                  </dl>
                  <Link
                    href={`/admin/guardians/${r.guardian.id}`}
                    className="flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-bold text-white transition hover:bg-slate-800"
                  >
                    Examiner la demande
                  </Link>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th scope="col" className="px-4 py-3">
                      Demandeur
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Élève
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Lien
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Classe
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Statut
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Date
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <AvatarNameCell
                          firstName={r.guardian.firstName}
                          lastName={r.guardian.lastName}
                          sub={r.guardian.email ?? r.guardian.phone ?? undefined}
                          tone="rose"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                        {/* L'admin arbitre sur l'ENFANT : le dossier élève est
                            la cible utile, le dossier parent reste en actions. */}
                        <Link
                          href={`/admin/students/${r.student.id}`}
                          className="rounded hover:underline"
                        >
                          {r.student.firstName} {r.student.lastName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {relationshipLabel(r.relationship)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                          {classLabel(r)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={r.status}
                          label={STATUS_BADGE[r.status].label}
                          tone={STATUS_BADGE[r.status].tone}
                          size="sm"
                          withDot
                        />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {formatDateShort(r.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowActions viewHref={`/admin/guardians/${r.guardian.id}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* `total` est le total SERVEUR de l'onglet, pas `rows.length` :
                la pagination porte donc sur la population entière. */}
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'demande', plural: 'demandes' }}
            />
          </>
        )}
      </section>
    </PortalShell>
  );
}
