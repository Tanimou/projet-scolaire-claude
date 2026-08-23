import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { AppRolePrismaService } from './app-role-prisma.service';
import { assertTenantId, PrismaService, runWithTenant } from './prisma.service';
import {
  currentTenantScopeFrame,
  runInTenantScope,
  TenantScopeError,
  type TenantScopeState,
} from './tenant-scope';

/**
 * S-E01-1d — LA COUTURE. Le premier appelant de PRODUCTION de `withTenant`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LEXICAL, PAS AMBIANT — et ce n'est pas un détail de style                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `run(tenantId, fn)` passe le client de transaction à `fn` en PARAMÈTRE. Le
 * store `AsyncLocalStorage` existe, mais aucun consommateur n'y lit son client :
 * il sert à détecter l'imbrication et à rendre `current()` observable. Un
 * `getCurrentTx()` public serait la forme ambiante — la couture qu'un service
 * futur atteindrait sans s'y être inscrit — et c'est exactement le reproche
 * qu'ADR-035 fait aux intercepteurs.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ PORTÉE TARDIVE, FERMETURE PRÉCOCE — la règle, pas une politesse          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `withTenant` ouvre une transaction INTERACTIVE Prisma (défauts maxWait 2 s /
 * timeout 5 s). Tout ce qui tourne sur le client PROPRIÉTAIRE doit donc être
 * TERMINÉ avant l'ouverture :
 *
 *  - `UserSyncService.ensureUser` lit `user_profile` — une des 44 tables sous
 *    policy — pour résoudre le profil depuis le `sub` Keycloak, SANS connaître
 *    de tenant. Elle produit le tenant ; elle ne peut pas le consommer. Sur
 *    `app_user` sans GUC elle rendrait zéro ligne, et chaque requête
 *    authentifiée de chaque portail répondrait 403 `ACCOUNT_NOT_PROVISIONED`.
 *  - `SchoolContextService.forTenant` et `StudentAccessService.scopeForUser`
 *    sont dans le même cas : `school`, `academic_year`, `guardianship`,
 *    `student` sont toutes sous policy — et depuis `S-E05-16` / `PF-288`,
 *    `scopeForUser` en lit TROIS de plus sur son axe enseignant
 *    (`teacher_profile` via `TeacherProfileService.findForUser`,
 *    `teaching_assignment`, `enrollment`), ce qui RENFORCE le corollaire
 *    ci-dessous au lieu de l'affaiblir : la méthode est passée de ZÉRO à TROIS
 *    instructions pour un appelant `teacher`.
 *
 * La résolution d'identité reste donc sur la connexion du PROPRIÉTAIRE, par
 * NÉCESSITÉ et jusqu'à la bascule globale — pas par préférence. C'est la raison
 * STRUCTURELLE pour laquelle la bascule ne peut pas être un événement. (`tenant`
 * est hors policy exprès, pour que la couture identité puisse la lire par slug
 * avant qu'un tenant soit résolu — ADR-042 §D4, ADR-046 §D1.)
 *
 * Corollaire à énoncer comme une règle : appeler `scopeForUser` DEPUIS
 * l'intérieur d'une portée ferait détenir au processus une connexion
 * propriétaire ET une connexion applicative simultanément, pour la durée de la
 * transaction.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE QUE CETTE COUTURE NE PRÉTEND PAS                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Elle NE rend PAS l'application isolée par RLS. Seuls les sites d'appel qu'un
 * module a explicitement convertis passent par ici ; tous les autres restent sur
 * la connexion du PROPRIÉTAIRE, qui échappe à ses propres policies. Et sur un
 * déploiement où `DATABASE_URL_APP` n'est pas déclarée, MÊME les sites convertis
 * tournent sur le propriétaire — la couverture est une propriété du DÉPLOIEMENT
 * autant que de l'arbre source, et la jauge `pilotage_tenant_scope_enforced` est
 * là pour que la seconde ne puisse pas se faire passer pour la première.
 *
 * RETOUR ARRIÈRE (AC-6) : supprimer les appels `run(...)` de
 * `calendar.controller.ts` ramène le module sur la connexion du propriétaire.
 * Aucun changement de schéma, aucune migration à défaire ; ce service et le
 * second client deviennent du code mort qui ne construit rien (le client n'est
 * ouvert que si la variable est déclarée). Il n'y a AUCUN intercepteur à
 * retirer : il n'y en a jamais eu, et il ne pouvait pas y en avoir — un
 * intercepteur tiendrait la transaction interactive ouverte pendant `ensureUser`
 * et `forTenant`, ce qui creuse le timeout de 5 s en plus de casser la
 * résolution d'identité ci-dessus.
 */
@Injectable()
export class TenantScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appRole: AppRolePrismaService,
  ) {}

  /**
   * Le tenant de la portée active, ou `undefined` hors de toute portée.
   *
   * Rend le tenant, JAMAIS le client de transaction : la couture ne se traverse
   * pas à rebours. C'est aussi la preuve la plus courte d'AC-4 — hors de tout
   * `run(...)`, il n'y a rien, donc rien d'ambiant n'a pu s'installer sur les
   * 782 sites d'appel qui n'ont pas été convertis.
   */
  current(): { tenantId: string } | undefined {
    const frame = currentTenantScopeFrame();
    return frame === undefined ? undefined : { tenantId: frame.tenantId };
  }

  /** L'état nommé de la seconde connexion — `enforced` / dégradé / refusé. */
  state(): TenantScopeState {
    return this.appRole.currentState();
  }

  /**
   * Exécute `fn` dans une portée tenant, sur la connexion la plus contrainte
   * dont ce déploiement dispose.
   *
   * ORDRE, et il porte la propriété : l'identifiant est validé AVANT toute
   * décision et avant toute transaction (même raison qu'`runWithTenant` — une
   * validation faite dans le callback coûterait une connexion du pool et un
   * BEGIN/ROLLBACK par requête refusée).
   *
   * IMBRICATION (AC-5) — RÉUTILISATION sur le même tenant, REFUS sur un autre :
   *
   *  - même tenant : on passe le `tx` DÉJÀ ouvert et on n'ouvre rien. Ouvrir une
   *    seconde transaction ferait prendre à Prisma une AUTRE connexion du pool,
   *    où le GUC n'est pas posé — le bloc imbriqué s'exécuterait alors hors
   *    contexte tout en ayant l'air couvert, ce qui est pire qu'une erreur.
   *  - tenant différent : on LÈVE, en nommant les deux. Il n'existe aucune
   *    lecture raisonnable de « ouvrir le tenant B à l'intérieur du tenant A » :
   *    soit c'est une confusion de contexte, soit c'est une traversée de tenant.
   *    Les deux doivent être bruyantes.
   *
   * BUDGET (AC-8) : la transaction interactive doit rester très courte. Les
   * quatre handlers convertis tiennent ≤ 2 instructions à l'intérieur
   * (`set_config` non compté) — la résolution d'identité et le chemin de seed en
   * masse restent DEHORS.
   */
  async run<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const id = assertTenantId(tenantId);

    const active = currentTenantScopeFrame();
    if (active !== undefined) {
      if (active.tenantId !== id) {
        throw new TenantScopeError(
          'portée imbriquée sur un AUTRE tenant — active ' +
            active.tenantId +
            ', demandée ' +
            id +
            '. Ouvrir une transaction imbriquée ferait prendre à Prisma une autre connexion du ' +
            'pool, où le contexte tenant n’est PAS posé.',
        );
      }
      // Réutilisation délibérée : même tenant, même transaction, aucun BEGIN.
      return fn(active.tx as Prisma.TransactionClient);
    }

    const appRoleRunner = this.appRole.transactionRunnerOrNull();

    if (appRoleRunner === null) {
      // Mode DÉGRADÉ, nommé au démarrage et publié par la jauge à 0 : la portée
      // s'ouvre quand même, sur le client propriétaire. Rien n'est enforcé par
      // la base ici, et rien dans ce fichier ne prétend le contraire.
      return this.prisma.withTenant(id, (tx) => runInTenantScope({ tenantId: id, tx }, () => fn(tx)));
    }

    return runWithTenant(appRoleRunner, id, (tx) =>
      runInTenantScope({ tenantId: id, tx }, () => fn(tx)),
    );
  }
}
