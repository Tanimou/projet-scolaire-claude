'use client';

import type { GuardianshipLinkStatus } from '@pilotage/contracts';
import { Tabs, TabsList, TabsTrigger, cn } from '@pilotage/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Les onglets de `/admin/enrollments` (S-E03-5, PF-20).
 *
 * **Le jeu d'onglets est DÉRIVÉ, pas écrit.** Il arrive en prop, construit
 * par la page serveur à partir de `GUARDIANSHIP_LINK_STATUSES` — l'énum que le
 * cliquet de `link-liveness.ts` §2.1 tient byte-identique à `schema.prisma`.
 * C'est la raison pour laquelle l'ancien onglet « À vérifier » n'est plus là :
 * il ne reflétait aucun état du modèle, seulement un champ `review` dans une
 * enveloppe JSON de `notes` qu'aucun chemin d'écriture ne produit. Un onglet
 * que rien ne peut remplir est `DNC-06`, même si c'est le code précédent qui
 * l'a créé.
 *
 * **Pourquoi la liste TRAVERSE la frontière au lieu d'être importée ici.**
 * Ce fichier est un `'use client'` : y importer la *valeur*
 * `GUARDIANSHIP_LINK_STATUSES` tirerait `@pilotage/contracts` — un paquet CJS
 * consommé par son barrel racine — dans le bundle navigateur, ce qu'aucun
 * composant client du dépôt ne fait aujourd'hui. La dérivation reste donc du
 * côté serveur, et `TAB_LABEL` en dessous est un `Record<EnrollmentsTab, …>` :
 * un quatrième état ajouté à l'énum devient une **erreur de typecheck** ici,
 * pas un onglet muet. La garantie est plus forte que l'itération, pas plus
 * faible.
 *
 * **`counts` peut être `null`, et ce n'est pas un détail.** Sur une lecture
 * échouée, la page ne rend pas cette barre du tout — mais si un appelant futur
 * choisissait de la rendre quand même, un badge `0` serait une invention de la
 * même nature que le KPI à `0` que cette tranche retire. `null` rend le libellé
 * SEUL : il n'existe aucune valeur de `counts` qui produise un badge non
 * mesuré.
 */
export type EnrollmentsTab = 'all' | GuardianshipLinkStatus;

export type EnrollmentsTabCounts = Readonly<Record<EnrollmentsTab, number>>;

export interface EnrollmentsPageTabsProps {
  activeTab: EnrollmentsTab;
  /** Les onglets à rendre, DÉRIVÉS de l'énum du contrat par la page serveur. */
  tabs: readonly EnrollmentsTab[];
  /** Totaux SERVEUR par onglet, ou `null` quand la lecture a échoué. */
  counts: EnrollmentsTabCounts | null;
}

const TAB_LABEL: Record<EnrollmentsTab, string> = {
  all: 'Toutes',
  pending: 'En attente',
  active: 'Approuvées',
  revoked: 'Rejetées',
};

export function EnrollmentsPageTabs({ activeTab, tabs, counts }: EnrollmentsPageTabsProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function pick(next: string) {
    const usp = new URLSearchParams(params.toString());
    usp.set('tab', next);
    usp.delete('page');
    startTransition(() => router.push(`/admin/enrollments?${usp.toString()}`));
  }

  return (
    <Tabs defaultValue={activeTab} value={activeTab} onValueChange={pick} variant="underline">
      <TabsList>
        {tabs.map((value) => {
          const count = counts?.[value];
          return (
            <TabsTrigger key={value} value={value} className="min-h-11">
              <span>{TAB_LABEL[value]}</span>
              {count !== undefined && (
                <span
                  className={cn(
                    'ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums',
                    value === activeTab
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-600',
                  )}
                >
                  {count}
                  {/* Sans ce mot, la synthèse vocale lit « Approuvées 12 » — un
                      nombre orphelin collé à un libellé, dont rien ne dit ce
                      qu'il compte. */}
                  <span className="sr-only"> demandes</span>
                </span>
              )}
            </TabsTrigger>
          );
        })}
        {isPending && (
          /* `slate-400` sur blanc = 2,8:1, sous le seuil AA 4,5:1 — et c'était
             ici le texte d'un `aria-live`, donc la seule annonce du changement
             d'onglet. `slate-500` passe. */
          <span className="ml-3 text-[11px] text-slate-500" aria-live="polite">
            Mise à jour…
          </span>
        )}
      </TabsList>
    </Tabs>
  );
}
