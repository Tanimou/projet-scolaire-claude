/**
 * S-E05-8 / PF-25 half (b) / ADR-082 §D2 — LA règle d'enrôlement MFA, déclarée
 * UNE FOIS, ici, et consommée par les DEUX sites qui la posaient chacun de leur
 * côté.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE MODULE DIT, ET CE QU'IL NE DIT PAS (G-TRUTH, G-DNC / DNC-06)
 * ---------------------------------------------------------------------------
 * Il énonce une **POLITIQUE** : « à l'invitation, les rôles realm suivants
 * reçoivent l'action requise Keycloak `CONFIGURE_TOTP` » (ADR-004).
 *
 * Il n'énonce AUCUN FAIT DE COMPTE. Il ne dit pas qu'un utilisateur détient une
 * credential OTP, ni qu'il l'a configurée, ni qu'il l'a supprimée depuis. Le
 * savoir exigerait un aller-retour vers l'API Admin de Keycloak sur le chemin
 * chaud de `/me` — une question de conception (cache, latence, mode dégradé)
 * qui mérite sa propre tranche, enregistrée comme **PF-443**. C'est pourquoi
 * `mfaEnabled` reste `null` (« jamais mesuré ») et pourquoi le champ dérivé
 * ici s'appelle `mfaRequired` (**PF-446** : politique, pas fait) et non
 * `mfaEnabled`. Confondre les deux serait exactement le défaut que la tranche
 * ferme, réintroduit un champ plus loin.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI IL EXISTE : DEUX LISTES TENUES À LA MAIN DÉRIVENT EN SILENCE
 * ---------------------------------------------------------------------------
 * Sur HEAD, la règle vivait en littéral à un seul endroit
 * (`apps/api/src/modules/identity/invite.controller.ts:230-232`,
 * `body.realmRole === 'school_admin' || body.realmRole === 'teacher'`). Dériver
 * `mfaRequired` dans `me.controller.ts` en RECOPIANT ce littéral aurait créé la
 * SECONDE copie, et le module qui prétend fermer la dérive l'aurait fondée.
 * Les deux sites lisent donc CE fichier. Le cliquet
 * (`apps/api/src/shared/quality/auth-failure-classification-gate.spec.ts`, R4)
 * gèle qu'il n'en existe pas de troisième.
 *
 * ---------------------------------------------------------------------------
 * `super_admin` — ENREGISTRÉ, PAS « CORRIGÉ »
 * ---------------------------------------------------------------------------
 * `super_admin` n'est PAS dans l'ensemble, et ce n'est pas un oubli : le canal
 * d'invitation n'admet que `school_admin | teacher | parent` (`@IsEnum`), et un
 * `super_admin` est provisionné ailleurs, SANS `CONFIGURE_TOTP`. L'ajouter ici
 * ferait affirmer à `/me` `mfaRequired: true` pour des comptes qui ne portent
 * aucune action requise en attente — un NOUVEAU mensonge, la maladie même que
 * cette tranche soigne. La vérité mesurée est préservée ; l'écart (le rôle le
 * plus privilégié de la plateforme n'est enrôlé nulle part) est un résiduel
 * ENREGISTRÉ, dont le remède est une modification de provisionnement côté
 * Keycloak, insondable tant que Docker est à l'arrêt.
 *
 * ---------------------------------------------------------------------------
 * DOMAINE : `string`, PAS `RealmRole`
 * ---------------------------------------------------------------------------
 * `me.controller.ts` lit `jwt.realm_access?.roles ?? []`, c'est-à-dire des
 * chaînes ARBITRAIRES non validées, provenant du jeton. Typer l'entrée en
 * `RealmRole` forcerait une assertion de type au site d'appel — c'est-à-dire
 * une affirmation non mesurée de plus. La fonction est TOTALE sur `string` :
 * un rôle inconnu n'est pas enrôlé.
 *
 * Aucune dépendance (pas même `zod`, pas même `../enums`) : ce module est tiré
 * dans le même paquet que `direct-grant-failure.ts`, dont le bundle atteint le
 * runtime edge. Voir l'en-tête de ce fichier-là.
 */

/**
 * LES rôles realm que l'invitation enrôle dans l'action requise
 * `CONFIGURE_TOTP` (ADR-004). **Unique déclaration du dépôt** — gelée par R4 du
 * cliquet.
 *
 * L'ordre est celui du site historique, afin que la table de vérité de
 * `invite.controller.ts` reste lisible ligne à ligne face à ce littéral.
 */
export const MFA_ENROLLED_REALM_ROLES: readonly string[] = ['school_admin', 'teacher'] as const;

/**
 * Ce rôle realm est-il enrôlé par la politique d'invitation ?
 *
 * C'est la forme consommée par `invite.controller.ts`, qui raisonne sur UN rôle
 * (`body.realmRole`). Table de vérité IDENTIQUE au littéral qu'elle remplace :
 * `school_admin` → `true`, `teacher` → `true`, `parent` → `false`,
 * `super_admin` → `false`, inconnu → `false`. Aucun rôle ne gagne ni ne perd
 * `CONFIGURE_TOTP`.
 */
export function isMfaEnrolledRealmRole(realmRole: string | null | undefined): boolean {
  if (typeof realmRole !== 'string') return false;
  return MFA_ENROLLED_REALM_ROLES.includes(realmRole);
}

/**
 * La politique d'invitation exige-t-elle le MFA pour un porteur de CES rôles ?
 *
 * C'est la forme consommée par `me.controller.ts`, qui raisonne sur la LISTE de
 * rôles du jeton. Dérivée avec ZÉRO E/S : aucune requête, aucun appel réseau,
 * aucune lecture de base — la valeur sort du jeton que l'appelant a déjà
 * présenté (G-TENANT non déclenché pour cette raison précise).
 *
 * Définie EN TERMES de `isMfaEnrolledRealmRole`, jamais par une seconde lecture
 * de la constante : les deux consommateurs partagent ainsi un seul prédicat, et
 * pas seulement une seule liste.
 *
 * Entrée non-tableau ⇒ `false` : la politique ne s'affirme pas sur ce qu'elle
 * n'a pas lu.
 */
export function mfaRequiredByInvitePolicy(realmRoles: readonly string[] | null | undefined): boolean {
  if (!Array.isArray(realmRoles)) return false;
  return realmRoles.some((role) => isMfaEnrolledRealmRole(role));
}
