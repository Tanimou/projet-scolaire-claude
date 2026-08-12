/**
 * Erreur d'API et extraction du message affichable — **module feuille**.
 *
 * **Ce fichier n'importe RIEN.** C'est sa raison d'être, pas une coïncidence.
 * `@/lib/api-client` importe `next/headers` (`:1`) et `@/auth` (`:4`) ; importer
 * une **valeur** depuis lui dans un composant `'use client'` tire ces modules
 * serveur dans le graphe navigateur et casse `next build` avec « You're
 * importing a component that needs "next/headers" » — c'est **PF-133**, déjà
 * vécu et consigné (`docs/spec/features/v3-e04/PROGRESS.md:773-801`, et le
 * commentaire de `components/notifications/NotificationCenter.tsx:30-41`).
 *
 * Deux non-corrections y sont enregistrées, à ne pas retenter : une
 * **ré-exportation** depuis `api-client.ts` ne suffit pas (c'est le
 * *spécificateur d'import* qui décide du graphe, pas le symbole), et un
 * `await import()` ne fait que déplacer la rupture hors de la vue du bundler.
 * La seule correction est un module que le client peut importer directement —
 * celui-ci. `UsersTable.tsx` importe donc `isStatusOnlyMessage` d'**ici**.
 *
 * **Pourquoi `ApiError` vit ici et non dans `api-client.ts`.** `apiErrorMessage`
 * restreint par `instanceof ApiError` ; la classe doit donc être atteignable
 * depuis ce module feuille. La déclarer ici et la **ré-exporter** depuis
 * `api-client.ts` garde les ~30 appelants serveur existants inchangés
 * (`import { api, ApiError } from '@/lib/api-client'`) tout en laissant ce
 * module libre de toute dépendance serveur. La restriction structurelle
 * (`{ status, body }`) était l'alternative : elle évite le déplacement mais
 * accepterait n'importe quel objet portant un `status` numérique, un
 * élargissement que personne n'a demandé.
 *
 * ---
 *
 * **PF-174 — pourquoi l'extracteur doit être TOTAL.**
 * `/admin/users` avalait le 403 que `POST /users/:id/roles` renvoie désormais
 * pour de vrai (ceiling de privilèges, S-E05-2 / #218) : les deux server actions
 * n'avaient aucun `catch`, donc le refus devenait un rejet non traité — le
 * spinner s'arrêtait et rien ne s'affichait. Corriger cela exigeait un
 * extracteur, et l'extracteur devait être **total**, parce que la valeur qu'il
 * consomme est `unknown` à la frontière (`ApiError.body`).
 *
 * **Le danger que cette totalité rend inatteignable.**
 * `apps/api/src/shared/auth/privilege-ceiling.ts:147-152` documente **par écrit**
 * que le `message` de son `ForbiddenException` DOIT rester une chaîne, parce que
 * `admin/roles/actions.ts:45-47` renvoie `body.message` sans le restreindre et
 * que `RoleBuilderForm.tsx:236` le rend comme enfant React — React démonte tout
 * le sous-arbre quand un objet est rendu comme enfant. C'était une promesse côté
 * API que le web ne pouvait pas faire respecter : `new ForbiddenException(objet)`
 * accepte n'importe quel objet. Renvoyer `string` pour toute entrée transforme
 * cette promesse en impossibilité côté web — **par construction, pas parce que
 * chacun y pense**.
 *
 * La restriction se fait par `typeof` / `Array.isArray` / `in`, **jamais par un
 * `as`** : un cast laisserait `tsc` certifier `undefined` comme `string`, et la
 * totalité redeviendrait une affirmation au lieu d'un fait vérifié.
 *
 * Formes couvertes : `{ message: string }` · `{ message: string[] }` (jointes
 * par ` · `) · `{ message: { message } }` imbriqué · `{ message: 42 }` · corps
 * absent, `null`, non-objet ou chaîne brute (page HTML d'un proxy) · `Error`
 * simple · jet non-`Error`. Les quatre derniers retombent sur `HTTP <status>`
 * ou sur la phrase générique.
 *
 * **Non rétrofités ce run (périmètre)** : `admin/roles/actions.ts:26-28/45-47/59-61`
 * porte trois copies divergentes de cette logique et devrait s'y rabattre ;
 * `RoleBuilderForm.tsx` rend l'une d'elles. Candidats identifiés, pas traités.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API ${status}`);
  }
}

/**
 * Phrase de repli lorsque l'erreur n'est pas une `ApiError` — panne réseau,
 * bug de sérialisation, jet non-`Error`. Volontairement générique : voir
 * `apiResultFromError` (`api-client.ts`) pour la raison (le texte brut nomme
 * l'infrastructure).
 */
const UNEXPECTED_ERROR_MESSAGE =
  'L’opération a échoué pour une raison inattendue. Réessayez dans un instant.';

/** `HTTP 403`, `HTTP 502`… — le repli quand le corps ne porte aucun message. */
const STATUS_ONLY_MESSAGE = /^HTTP \d{3}$/;

/**
 * Extrait récursivement un message non vide d'une valeur inconnue.
 * Renvoie `null` — jamais une chaîne vide — quand rien d'affichable n'existe,
 * pour que l'appelant applique son propre repli plutôt que de rendre un vide.
 *
 * `depth` borne la récursion : NestJS produit `{ message: { message } }` quand
 * une exception est construite depuis un objet qui porte lui-même `message`.
 */
function messageFromUnknown(value: unknown, depth: number): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (Array.isArray(value)) {
    // `ValidationPipe` renvoie un tableau de violations sur un 400.
    const parts = value
      .map((entry: unknown) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry: string) => entry !== '');
    return parts.length === 0 ? null : parts.join(' · ');
  }
  if (depth > 0 && typeof value === 'object' && value !== null && 'message' in value) {
    return messageFromUnknown(value.message, depth - 1);
  }
  return null;
}

/**
 * Message lisible pour **n'importe quoi** qu'un `api()` en échec peut jeter.
 * Fonction **pure et totale** : elle renvoie une chaîne non vide pour tout
 * argument, y compris des formes qu'aucun chemin connu ne produit aujourd'hui.
 * Voir l'en-tête du fichier pour le pourquoi (PF-174) et les formes couvertes.
 */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // Un `body` de type `string` est le repli `res.text()` d'`api()` : c'est
    // typiquement la page HTML 502 d'un proxy. Ne jamais la rendre — on épingle
    // la ligne de statut à la place.
    const body: unknown = err.body;
    const fromBody = typeof body === 'object' && body !== null ? messageFromUnknown(body, 2) : null;
    return fromBody ?? `HTTP ${err.status}`;
  }
  return UNEXPECTED_ERROR_MESSAGE;
}

/**
 * `true` quand le message est le repli `HTTP <status>` d'`apiErrorMessage`,
 * c'est-à-dire quand le serveur a refusé **sans** texte exploitable. Permet à
 * une UI de préfixer une phrase française vraie *par construction* exactement
 * dans ce cas, sans construire un classifieur de codes de statut.
 *
 * C'est le seul symbole de ce module consommé par un composant `'use client'`
 * (`app/admin/users/UsersTable.tsx`) — d'où l'absence totale d'import ci-dessus.
 */
export function isStatusOnlyMessage(message: string): boolean {
  return STATUS_ONLY_MESSAGE.test(message);
}
