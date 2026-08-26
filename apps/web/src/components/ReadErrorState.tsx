'use client';

import { ErrorState } from '@pilotage/ui';
import { AlertOctagon, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition, type ComponentType } from 'react';

/**
 * ReadErrorState — le rendu honnête d'une **lecture qui a échoué** dans une
 * page serveur, quel que soit le portail (S-E03-2 / PF-05).
 *
 * **Pourquoi il vit dans `@/components` et non dans `app/parent/_components`.**
 * Il y est né (S-E03-2) parce que ses deux premiers appelants étaient des pages
 * parent. Mais « une lecture échouée n'est jamais un fait du domaine » n'a rien
 * de propre au portail parent : `/admin/enrollments` porte le même défaut, et
 * l'importer depuis `app/parent/_components` aurait franchi une frontière de
 * groupe de routes (GUARDRAILS §2, « keep a feature inside its portal route
 * group ») ou forcé une seconde copie — donc une dérive. Le fichier est
 * remonté d'un cran, sans qu'une ligne de markup ni une prop ne changent ; ce
 * n'est PAS une primitive de `packages/ui` (qui appartient au DS Guardian),
 * c'est du markup applicatif transverse, comme `@/components/meeting-requests`.
 *
 * **Pourquoi ce composant existe.** `ErrorState` (`@pilotage/ui`) expose
 * `onRetry: () => void`. Une fonction ne franchit pas la frontière
 * serveur → client : une page serveur ne peut donc pas offrir de « Réessayer »
 * en montant `ErrorState` directement. Ce mince client component crée la
 * fonction *de son côté* de la frontière et rend le composant partagé tel
 * quel — aucune nouvelle primitive visuelle, aucun style dupliqué.
 *
 * **Pourquoi `router.refresh()` et pas un lien vers la même URL.** Un `<a>`
 * vers l'URL courante est une navigation document complète : elle jette les
 * filtres, la position de défilement et re-monte toute la coquille. La page
 * est `force-dynamic`, donc `refresh()` refait exactement la même lecture
 * serveur tout en préservant l'état client, et `useTransition` donne l'état
 * « en cours » qu'un lien ne donne pas.
 *
 * **Ce que ce composant ne fait PAS, volontairement :**
 * - il ne réessaie **jamais** tout seul, et ne masque pas l'erreur après un
 *   second échec — seul le bouton revient à l'état inactif ;
 * - il n'affiche **jamais** le message brut de l'erreur. Le texte de
 *   `apiErrorMessage()` nomme notre propre hôte et notre port
 *   (`connect ECONNREFUSED 127.0.0.1:4000`) ; la cause brute reste dans les
 *   journaux serveur, le parent reçoit une phrase factuelle.
 *
 * `retryable={false}` sert le cas « droit d'accès » (403/404) : un bouton
 * « Réessayer » qui ne peut pas aboutir érode la confiance plus qu'il n'aide.
 */
/**
 * Discriminant TEXTUEL, jamais un composant.
 *
 * Un composant React est une **fonction** : une page serveur ne peut pas en
 * passer une à un client component (« Functions cannot be passed directly to
 * Client Components »). L'icône est donc choisie **ici**, du côté client, à
 * partir d'une chaîne — c'est aussi ce qui garantit qu'une panne et un refus
 * ne peuvent pas recevoir l'icône l'un de l'autre par inadvertance.
 */
export type ReadErrorVariant = 'failure' | 'denied';

const VARIANT_ICON: Record<ReadErrorVariant, ComponentType<{ className?: string }>> = {
  failure: AlertOctagon,
  denied: ShieldAlert,
};

export interface ReadErrorStateProps {
  variant?: ReadErrorVariant;
  title: string;
  description: string;
  /** `false` pour une erreur qu'un nouvel essai ne peut pas résoudre (403/404). */
  retryable?: boolean;
  secondaryAction?: { label: string; href: string };
  className?: string;
}

export function ReadErrorState({
  variant = 'failure',
  title,
  description,
  retryable = true,
  secondaryAction,
  className,
}: ReadErrorStateProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function retry() {
    if (pending) return;
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className={className} aria-busy={pending || undefined}>
      <ErrorState
        icon={VARIANT_ICON[variant]}
        title={title}
        description={description}
        onRetry={retryable ? retry : undefined}
        retryLabel={pending ? 'Nouvelle tentative…' : 'Réessayer'}
        secondaryAction={secondaryAction}
      />
    </div>
  );
}
