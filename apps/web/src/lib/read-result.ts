import { apiResultFromError, type ApiFailure, type ApiResult } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error-message';

/**
 * `read()` — la lecture serveur qui **distingue « vide » de « cassé »** (S-E03-2, PF-05).
 *
 * ## Le défaut qu'il remplace
 *
 * Une soixantaine de pages serveur portent une copie de ce helper :
 *
 * ```ts
 * async function safe<T>(p: Promise<T>): Promise<T | null> { … return null; }
 * const rows = resp?.data ?? [];
 * ```
 *
 * `null` (échec) et `[]` (ensemble vide) deviennent alors le **même** état, et
 * la page rend ensuite cet état comme une **affirmation positive sur
 * l'établissement** : « Aucune note publiée », « Aucun enfant rattaché ». Un
 * 403, un 404 ou un 500 sont donc présentés au parent comme un fait scolaire.
 * C'est le symptôme mesuré de `PF-05` et un défaut `G-TRUTH` à part entière :
 * *une lecture qui échoue n'est jamais un fait du domaine.*
 *
 * `read()` conserve l'échec au lieu de l'effacer : l'appelant doit choisir un
 * rendu pour `{ ok: false }`, et ne **peut plus** confondre les deux cas.
 *
 * ## Pourquoi il délègue à `apiResultFromError`
 *
 * `api()` appelle `redirect()` sur un 401 (`api-client.ts`), et `redirect()`
 * **jette** une erreur de digest `NEXT_REDIRECT;…` — ce n'est pas une
 * `ApiError`. Un `catch { return null }` naïf l'avalerait : une session parent
 * expirée afficherait indéfiniment « nous n'avons pas pu charger… » au lieu de
 * repartir vers la connexion. `apiResultFromError` **re-jette** les signaux de
 * navigation de Next avant toute conversion ; c'est pour cela qu'il est
 * réutilisé ici plutôt que ré-écrit.
 *
 * ## Pourquoi le `status` est conservé à côté d'`ApiFailure`
 *
 * Un refus d'accès (403/404) et une panne (5xx, réseau) ne se réparent pas de
 * la même façon : réessayer aboutit dans le second cas et jamais dans le
 * premier. Le membre d'échec est donc `ApiFailure` — le type dérivé
 * d'`ApiResult`, pas une seconde déclaration littérale — **augmenté** du
 * statut. `error` reste porté pour les appelants qui en ont besoin, mais une
 * page destinée à un parent ne doit pas l'afficher : ce texte nomme notre
 * propre infrastructure (voir `apiResultFromError`).
 */
export type ReadFailure = ApiFailure & {
  /** Statut HTTP renvoyé par l'API, ou `null` pour une panne réseau / un jet non-`ApiError`. */
  status: number | null;
};

export type ReadResult<T> = Extract<ApiResult<T>, { ok: true }> | ReadFailure;

/**
 * Exécute une lecture serveur et renvoie un résultat discriminé.
 *
 * @param label court identifiant de la lecture, utilisé dans le journal serveur.
 */
export async function read<T>(label: string, p: Promise<T>): Promise<ReadResult<T>> {
  try {
    return { ok: true, data: await p };
  } catch (err) {
    // Re-jette NEXT_REDIRECT / NEXT_NOT_FOUND — la session expirée doit
    // atteindre l'exécution de Next, pas devenir un état d'erreur affiché.
    const failure = apiResultFromError(err);
    console.error(`[read:${label}] la lecture a échoué`, err);
    return { ...failure, status: err instanceof ApiError ? err.status : null };
  }
}

/**
 * Vrai lorsqu'un nouvel essai **ne peut pas** aboutir : l'API a répondu, et sa
 * réponse était un refus (403) ou une absence (404). Tout le reste — 5xx,
 * panne réseau, statut inconnu — est traité comme réessayable.
 */
export function isAccessDenied(failure: ReadFailure): boolean {
  return failure.status === 403 || failure.status === 404;
}
