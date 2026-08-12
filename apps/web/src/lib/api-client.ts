import { headers as incomingHeaders } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ApiError, apiErrorMessage } from '@/lib/api-error-message';
import {
  clientProvenanceHeaders,
  stripClientProvenanceHeaders,
  type ClientProvenanceSource,
} from '@/lib/client-provenance';

/**
 * ⚠️ **Module serveur.** Il importe `next/headers` (`:1`) et `@/auth` (`:4`).
 * Importer une **valeur** d'ici depuis un fichier `'use client'` casse
 * `next build` (PF-133) ; seul `import type` est sans conséquence. Les helpers
 * purs d'erreur vivent dans `@/lib/api-error-message`, sans aucun import — un
 * composant client les importe **directement là-bas**, jamais via la
 * ré-exportation ci-dessous : c'est le spécificateur d'import qui décide du
 * graphe de bundling.
 *
 * `ApiError` est ré-exportée pour les ~30 appelants serveur qui font déjà
 * `import { api, ApiError } from '@/lib/api-client'` — sa déclaration a été
 * déplacée dans le module feuille pour qu'`apiErrorMessage` puisse continuer à
 * restreindre par `instanceof` sans tirer ce fichier-ci.
 */
export { ApiError } from '@/lib/api-error-message';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

/**
 * En-têtes de la requête entrante, ou `null` hors d'une portée de requête.
 *
 * `headers()` lève lorsqu'aucune requête n'est en cours ; on tolère ce cas
 * plutôt que de le propager — un helper de provenance ne doit jamais être la
 * raison pour laquelle un rendu échoue. Sans en-têtes, aucune valeur n'est
 * inventée : le relais se déclare seulement (voir `client-provenance.ts`).
 *
 * Coût en cache — **mesuré, pas supposé** (`PM-7`) : `api()` appelle déjà
 * `auth()` à chaque invocation, qui lit les cookies, et `app/layout.tsx:39`
 * porte `export const dynamic = 'force-dynamic'` pour la racine. Le rendu est
 * donc déjà dynamique partout, et `init.revalidate` n'a **aucun appelant** dans
 * `apps/web/src` (seule sa déclaration existe). Lire les en-têtes n'enlève donc
 * ici aucune mise en cache réelle.
 */
async function requestHeadersOrNull(): Promise<ClientProvenanceSource | null> {
  try {
    return await incomingHeaders();
  } catch {
    return null;
  }
}

/**
 * Server-side fetch to the NestJS API, forwarding the session's access_token.
 * Throws ApiError on non-2xx.
 *
 * **401 handling** — when the API rejects the forwarded access token (typically
 * because it expired in Keycloak's view and NextAuth's refresh failed), we
 * trigger a redirect to the portal's login page with `?error=session_expired`.
 * This avoids the cryptic "500 Internal Server Error" the user would otherwise
 * see and forces a clean re-authentication.
 *
 * @example
 *   const me = await api<MeResponse>('/api/v1/me');
 *   const updated = await api('/api/v1/schools/abc/branding', { method: 'PATCH', body: { primaryColor: '#...' } });
 */
export async function api<T = unknown>(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
    cache?: RequestCache;
    revalidate?: number | false;
  } = {},
): Promise<T> {
  const session = await auth();
  const accessToken = session?.accessToken;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers ?? {}),
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  // Provenance client (S-E04-3 · PF-128 · ADR-036). Appliquée **en dernier** et
  // précédée d'un nettoyage : `init.headers` est étalé plus haut, donc sans
  // cela un appelant pourrait poser lui-même un `x-pilotage-client-ip` et
  // choisir ce que le journal d'audit retient de lui — le design que D1 refuse.
  // La fusion écrase les clés que ce module émet ; le `strip` supprime celles
  // qu'il n'émet pas (aucune adresse lisible), qui survivraient sinon.
  stripClientProvenanceHeaders(headers);
  Object.assign(headers, clientProvenanceHeaders(await requestHeadersOrNull()));

  const next =
    init.revalidate !== undefined ? ({ revalidate: init.revalidate } as const) : undefined;

  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: init.cache,
    ...(next ? { next } : {}),
  });

  // 401 from upstream means the access token is no longer valid — either
  // expired (Keycloak rotated/idled out) or the user's session was
  // invalidated server-side. Either way, the NextAuth cookie is stale; the
  // only sane recovery is to send the user back to login.
  if (res.status === 401) {
    const portal = session?.portal ?? 'admin';
    redirect(`/${portal}/login?error=session_expired`);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Returns the API URL for client-side fetches (no auth — use session.accessToken explicitly).
 */
export const apiUrl = (path: string) => `${API_URL}${path}`;

/**
 * True for Next.js' `redirect()` / `notFound()` exceptions. These have a
 * `digest` string starting with `NEXT_REDIRECT;…` or `NEXT_NOT_FOUND`. They
 * are intentional control-flow signals that must propagate uncaught — if a
 * server action catches them and returns a normal Result, the redirect never
 * happens and the user sees stale state.
 */
export function isNextNavigationSignal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const digest = (err as { digest?: unknown }).digest;
  return (
    typeof digest === 'string' &&
    (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND'))
  );
}

export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Le **membre d'échec** d'`ApiResult`, dérivé — jamais re-déclaré à la main :
 * une seconde écriture littérale de `{ ok: false; error: string }` serait une
 * seconde source de vérité qui dériverait d'`ApiResult` au premier changement.
 *
 * **Pourquoi ce type existe (S-E06-9).** `apiResultFromError` renvoyait
 * `ApiResult<never>`, dont le membre `{ ok: true; data: never }` bloque
 * l'affectation à toute action dont la branche de succès n'est pas
 * `{ ok: true; data: T }` — `{ ok: true; id: string }` d'`admin/roles`,
 * `{ ok: boolean; error?: string }` des préférences, `BulkChannelResult`. Le
 * restreindre au seul membre d'échec laisse le convertisseur partagé atterrir
 * dans une union de succès étrangère **sans y traîner `ApiResult`** : c'est ce
 * qui évite de migrer trois composants clients (`RoleBuilderForm`,
 * `DeleteRoleButton`, `PreferencesPanel`) qui lisent `res.error` et
 * `res.succeededKinds`. C'est un rétrécissement strict : tous les appelants
 * existants font littéralement `return apiResultFromError(err);` et
 * `{ ok: false; error: string }` reste assignable à `ApiResult<T>` pour tout `T`.
 */
export type ApiFailure = Extract<ApiResult, { ok: false }>;

/**
 * Shared error→result converter for server actions. Re-throws Next.js
 * navigation signals so they reach the runtime and trigger the redirect.
 *
 * **Pourquoi la vérification de navigation vient en premier (PF-174).**
 * `api()` appelle `redirect()` sur un 401 (plus haut) ; `redirect()` jette une
 * erreur à `digest` `NEXT_REDIRECT;…`. Sans ce ré-jet, une session expirée
 * deviendrait un `{ ok: false }` affichant `NEXT_REDIRECT;replace;/admin/login…`
 * dans l'UI et l'utilisateur ne serait **jamais** envoyé vers la connexion.
 *
 * **Pourquoi le texte brut d'une non-`ApiError` n'est pas renvoyé.** Une panne
 * réseau donne `fetch failed` ou `connect ECONNREFUSED 127.0.0.1:4000` : l'hôte
 * et le port internes de l'API, transmis du serveur au navigateur. Next masque
 * les erreurs de server action précisément pour cela ; renvoyer le message
 * comme *donnée* contournerait ce masquage. Le brut reste dans les logs
 * serveur, l'appelant reçoit la phrase générique d'`apiErrorMessage`
 * (`@/lib/api-error-message`, module feuille). Les corps d'`ApiError`
 * sont, eux, la sortie relue de notre propre API et sont restitués tels quels.
 *
 * @example
 *   export async function createX(payload: …): Promise<ApiResult> {
 *     try { … return { ok: true, data }; }
 *     catch (err) { return apiResultFromError(err); }
 *   }
 */
export function apiResultFromError(err: unknown): ApiFailure {
  if (isNextNavigationSignal(err)) throw err;
  if (!(err instanceof ApiError)) {
    console.error('[apiResultFromError] non-ApiError thrown by a server action:', err);
  }
  return { ok: false, error: apiErrorMessage(err) };
}
