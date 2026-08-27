import { api } from '@/lib/api-client';
import { read, type ReadResult } from '@/lib/read-result';

/**
 * `readParentChildren()` — **la** lecture « quels enfants ce parent
 * garde-t-il ? » pour le portail famille (S-E03-3d, `PF-363`).
 *
 * ## Pourquoi un module et pas un `read()` recopié page par page
 *
 * Quatorze pages serveur du portail parent lisent `GET /api/v1/students` pour
 * exactement la même raison, et **treize** d'entre elles portaient jusqu'ici
 * une copie locale de `safe()` qui écrasait l'échec en `null`, puis rendait ce
 * `null` comme la phrase « Aucun enfant rattaché » — c'est-à-dire une
 * **affirmation sur la famille** produite par une lecture qui a échoué
 * (`DNC-06`, la classe qu'`ADR-071` a fermée pour les notes).
 *
 * Convertir les treize pages une par une aurait donné treize appels `read()`
 * indépendants, avec treize étiquettes de journal, treize types de ligne et
 * treize occasions de diverger sur l'URL, le `cache`, ou l'ordre des branches.
 * La lecture est **une**, donc elle est énoncée **une fois** — même idiome que
 * `@/lib/me` (`fetchMe`), qui est le précédent documenté pour « une lecture
 * partagée par tout un portail vit dans `@/lib` ».
 *
 * ## Pourquoi il est générique sur la ligne, et pas sur la réponse
 *
 * Les pages ne consomment pas le même sous-ensemble de `Student` : la page
 * « Paramètres » lit `photoUrl`/`birthDate`/`enrollments`, la page
 * « Messages » ne lit que `id`. Le paramètre de type porte donc la **ligne**,
 * et l'enveloppe (`{ data, total }`) reste déclarée ici une seule fois : une
 * page ne peut plus se tromper sur la forme de l'enveloppe, seulement sur ce
 * qu'elle attend d'une ligne.
 *
 * `total` est optionnel parce que l'API le renvoie mais que la plupart des
 * appelants ne le lisent pas ; le déclarer requis obligerait chaque page à
 * mentionner un champ qu'elle ignore.
 *
 * ## Ce qu'il ne fait PAS
 *
 * Il ne convertit **jamais** un échec en liste vide, et n'expose aucun
 * `?? []` : c'est précisément le geste que cette tranche supprime. L'appelant
 * reçoit un `ReadResult` discriminé et **doit** choisir un rendu pour
 * `{ ok: false }` — voir `@/components/parent/ChildrenReadError`.
 */
export interface ParentChildrenResponse<TChild> {
  data: TChild[];
  total?: number;
}

/**
 * @param label court identifiant de la lecture (`portail-page/children`),
 *   utilisé dans le journal serveur pour distinguer la page d'origine.
 */
export function readParentChildren<TChild>(
  label: string,
): Promise<ReadResult<ParentChildrenResponse<TChild>>> {
  return read(
    label,
    api<ParentChildrenResponse<TChild>>('/api/v1/students', { cache: 'no-store' }),
  );
}
