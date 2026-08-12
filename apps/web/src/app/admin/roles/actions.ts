'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { api, apiResultFromError } from '@/lib/api-client';

export interface CreateRolePayload {
  name: string;
  slug: string;
  description?: string;
  portal: 'admin' | 'teacher' | 'parent';
  permissionCodes: string[];
}

/**
 * **Pourquoi ces trois actions délèguent à `apiResultFromError` (S-E06-9 · PF-179).**
 *
 * Elles portaient trois extractions d'erreur écrites à la main et **divergentes**
 * (`createRoleAction` traitait la forme imbriquée `{ message: { message } }`, les
 * deux autres non — et renvoyaient donc un *objet* à travers une signature qui
 * promet `string`, que `RoleBuilderForm.tsx:236` rendait comme enfant React, ce
 * qui démonte le sous-arbre). Surtout, **aucune** ne ré-jetait le signal de
 * navigation de Next : `api()` appelle `redirect()` sur un 401, `redirect()` jette
 * une erreur dont le `message` est **`NEXT_REDIRECT`** tout court et dont le
 * `digest` porte la destination (`NEXT_REDIRECT;push;…;307;` dans une action —
 * mesuré sur Next 15.5.18, `next/dist/client/components/redirect.js:42-55`). Le
 * `catch` fourre-tout renvoyait ce `message` **comme donnée** : un admin dont la
 * session expirait en cours d'édition lisait le jeton nu `NEXT_REDIRECT` dans la
 * bande rouge — sans destination, donc sans indice — et n'était jamais envoyé
 * vers la connexion.
 *
 * Les types de retour publics sont **inchangés au caractère près** : les
 * composants clients lisent `res.error`, on ne migre pas vers `ApiResult<T>`.
 * C'est exactement ce que le type `ApiFailure` (`@/lib/api-client`) rend possible.
 */
export async function createRoleAction(
  payload: CreateRolePayload,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await api<{ id: string }>(`/api/v1/roles`, { method: 'POST', body: payload });
    revalidatePath('/admin/roles');
    revalidatePath('/admin/users');
    return { ok: true, id: res.id };
  } catch (err) {
    return apiResultFromError(err);
  }
}

export async function updateRoleAction(
  id: string,
  patch: { name?: string; description?: string; permissionCodes?: string[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api(`/api/v1/roles/${id}`, { method: 'PATCH', body: patch });
    revalidatePath('/admin/roles');
    revalidatePath(`/admin/roles/${id}/edit`);
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (err) {
    return apiResultFromError(err);
  }
}

export async function deleteRoleAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api(`/api/v1/roles/${id}`, { method: 'DELETE' });
    revalidatePath('/admin/roles');
    return { ok: true };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/**
 * **Le piège, vérifié plutôt que supposé (S-E06-9).** Le `redirect()` ci-dessous
 * est sur le chemin de **succès**, dans le corps de cette fonction, **hors de
 * tout `try`** — les trois `try` du fichier (`createRoleAction`,
 * `updateRoleAction`, `deleteRoleAction`) sont chacun clos dans leur propre
 * fonction, et `createRoleAction` a déjà *retourné* quand cette ligne
 * s'exécute. Aucun chemin ne peut donc
 * convertir ce redirect en donnée, et le nouveau `catch` n'est atteint que
 * lorsque `api()` jette. Envelopper les deux lignes suivantes dans un `try`
 * casserait cette propriété : ne pas le faire.
 *
 * Conservée bien qu'**aucun appelant** n'existe aujourd'hui
 * (`RoleBuilderForm.tsx:142` fait son `router.push` côté client) : un export
 * d'un fichier `'use server'` est un point d'entrée RPC vivant, et supprimer une
 * capacité qui marche est interdit (GUARDRAILS §5). Corollaire honnête : aucun
 * scénario UI ne la traverse, donc elle est **non attestable** par un chemin
 * vivant — la preuve ci-dessus est structurelle, pas observée.
 */
export async function createRoleAndRedirect(payload: CreateRolePayload) {
  const result = await createRoleAction(payload);
  if (result.ok) redirect('/admin/roles');
  return result;
}
