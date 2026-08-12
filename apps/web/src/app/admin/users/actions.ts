'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';

/**
 * Server actions d'assignation de rôle pour `/admin/users`.
 *
 * **PF-174.** Ces deux actions étaient les seules de toute la surface web sans
 * aucun `catch` : un refus de l'API devenait un rejet non traité, le spinner
 * s'arrêtait, le menu se fermait, `router.refresh()` ne partait pas et **aucun
 * message n'apparaissait**. Depuis que le ceiling de privilèges (S-E05-2, #218)
 * fait répondre 403 pour de vrai à `POST /users/:id/roles`, ce silence est un
 * défaut atteignable, pas latent.
 *
 * Elles renvoient maintenant le `ApiResult` maison (`lib/api-client.ts`) et **ne
 * peuvent plus rejeter** — à une exception délibérée près : `apiResultFromError`
 * ré-jette les signaux de navigation Next, pour qu'une session expirée (401 →
 * `redirect()`) parte bien vers la page de connexion au lieu d'être affichée
 * comme un refus métier.
 *
 * `revalidatePath` reste **dans le chemin de succès uniquement** : en cas de
 * refus rien n'a changé côté serveur, et invalider le cache ferait passer un
 * refus pour de l'activité.
 */
export async function assignRoleAction(userId: string, roleId: string): Promise<ApiResult<true>> {
  try {
    await api(`/api/v1/users/${userId}/roles`, { method: 'POST', body: { roleId } });
    revalidatePath('/admin/users');
    return { ok: true, data: true };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/**
 * Révocation d'une assignation de rôle.
 *
 * **Aucune UI n'appelle cette action** (le composant `UsersTable` ne l'importe
 * plus : l'import était mort). Elle est conservée et alignée sur le même type de
 * retour parce que supprimer une capacité fonctionnelle est interdit, et parce
 * qu'une future UI de révocation doit hériter d'une action correcte plutôt que
 * d'en redériver une.
 *
 * Fait de sécurité à ne pas mal « corriger » : toute fonction exportée d'un
 * fichier `'use server'` est un endpoint RPC appelable, qu'un bouton l'appelle
 * ou non. La sûreté de cette action vient du contrôle tenant + permission dans
 * `apps/api/src/modules/identity/users.service.ts`, **jamais** de l'absence
 * d'UI ni d'un filtrage côté client.
 */
export async function revokeRoleAction(userRoleId: string): Promise<ApiResult<true>> {
  try {
    await api(`/api/v1/users/roles/${userRoleId}`, { method: 'DELETE' });
    revalidatePath('/admin/users');
    return { ok: true, data: true };
  } catch (err) {
    return apiResultFromError(err);
  }
}
