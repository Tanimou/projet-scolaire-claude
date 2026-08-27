import { ReadErrorState } from '@/components/ReadErrorState';
import { isAccessDenied, type ReadFailure } from '@/lib/read-result';

/**
 * `ChildrenReadError` — le rendu, **unique**, d'une lecture ratée de
 * `GET /api/v1/students` dans le portail famille (S-E03-3d, `PF-363`).
 *
 * ## Pourquoi un composant et pas onze branches écrites à la main
 *
 * Les onze pages converties par cette tranche échouent toutes sur **la même
 * lecture**. Onze formulations indépendantes du même incident, c'est onze
 * versions d'une seule vérité présentées au même parent selon la page qu'il
 * ouvre — une machine à dérive, et exactement le défaut de fond que `PF-12`
 * décrit (« les portails se contredisent sur le même fait »). Le texte est donc
 * énoncé **ici**, une fois, et repris verbatim de `parent/grades/page.tsx`, que
 * `S-E03-2` puis la passe de land de `PF-346` avaient déjà réglé : ce n'est pas
 * une nouvelle copy, c'est la copy existante remontée d'un cran.
 *
 * ## Pourquoi il compose `ReadErrorState` au lieu d'ajouter une primitive
 *
 * `ReadErrorState` porte déjà tout le contrat (icône par variante, `retryable`,
 * `secondaryAction`, `aria-busy`, aucun texte d'erreur brut) et
 * `ErrorState`/`EmptyState` couvrent le visuel. Ce fichier n'ajoute **aucun
 * markup et aucun style** : il ne fait que choisir des props. Il vit à côté de
 * `ChildLinksPanel` (`@/components/parent/`) pour la même raison qu'elle —
 * c'est du markup applicatif propre au portail parent, pas une primitive de
 * `packages/ui` (qui appartient au DS Guardian).
 *
 * C'est un **composant serveur** : il n'introduit pas de frontière
 * client supplémentaire, seul `ReadErrorState` en est un (il a besoin de
 * `router.refresh()`).
 *
 * ## Le rôle ARIA est la moitié porteuse du correctif
 *
 * `EmptyState` rend `role="status"`, `ErrorState` rend `role="alert"`. Avant
 * cette tranche, un 403 ou un 500 était donc annoncé à un lecteur d'écran
 * comme une **mise à jour polie** disant « Aucun enfant rattaché » : la même
 * contre-vérité, rendue par la technologie d'assistance. Passer par ce
 * composant fait basculer le rôle **par construction** — jamais en retouchant
 * une chaîne de caractères.
 *
 * ## Les quatre propriétés branchent ensemble sur le refus
 *
 * `PF-346` a coûté une passe de land parce qu'une seule propriété
 * (`retryable`) branchait sur `isAccessDenied` : un parent refusé lisait
 * « Réessayez dans un instant » **sans** bouton pour réessayer. Ici le titre,
 * la description, `retryable` et l'action secondaire branchent sur le **même**
 * booléen, donc le désaccord est inexprimable.
 */
export interface ChildrenReadErrorProps {
  /** L'échec tel que `read()` l'a conservé — jamais un booléen reconstruit. */
  failure: ReadFailure;
  /**
   * UNE clause, au plus, nommant ce qui est indisponible **en conséquence**
   * (« Le cahier de texte n'est pas vide : il n'a pas pu être chargé. »).
   * Jamais un fait sur l'enfant, jamais un nom d'hôte, de port ou de route.
   */
  domain?: string;
  /**
   * Remplace l'action secondaire par défaut. Sert aux pages de messagerie :
   * l'action « Contacter l'établissement » y pointerait sur la page courante
   * (ou sur celle qui vient d'échouer pour la même raison), donc une boucle.
   */
  secondaryAction?: { label: string; href: string };
  className?: string;
}

const DENIED_TITLE = "La liste de vos enfants n'est pas accessible depuis votre compte.";
const FAILURE_TITLE = "Nous n'avons pas pu charger la liste de vos enfants.";

const DENIED_BODY =
  "Cela vient d'un droit d'accès, pas d'un compte sans enfant. L'établissement peut rétablir l'accès.";
const FAILURE_BODY =
  "Ceci ne veut pas dire qu'aucun enfant n'est rattaché à votre compte : c'est l'affichage qui a échoué. Réessayez dans un instant.";

export function ChildrenReadError({
  failure,
  domain,
  secondaryAction,
  className,
}: ChildrenReadErrorProps) {
  const denied = isAccessDenied(failure);
  const body = denied ? DENIED_BODY : FAILURE_BODY;

  return (
    <ReadErrorState
      className={className}
      variant={denied ? 'denied' : 'failure'}
      title={denied ? DENIED_TITLE : FAILURE_TITLE}
      description={domain ? `${body} ${domain}` : body}
      retryable={!denied}
      secondaryAction={
        secondaryAction ??
        (denied
          ? { label: "Contacter l'établissement", href: '/parent/messages/new' }
          : { label: 'Retour au tableau de bord', href: '/parent/dashboard' })
      }
    />
  );
}
