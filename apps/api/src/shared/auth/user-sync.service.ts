import { ForbiddenException, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { type KeycloakJwtPayload } from './jwt.strategy';
import { REALM_ROLE_PERMISSIONS } from './permissions.constants';

/**
 * S-E01-1a — LA COUTURE IDENTITÉ RÉSOUT UNE TENANCY, ELLE N'EN INVENTE PLUS
 * (`PF-01` moitié (a), P0 · gates G-TENANT, G-AUTHZ, G-AUDIT, G-PORTAL, G-DNC ·
 * ADR-043).
 *
 * CE QUI ÉTAIT OUVERT, MESURÉ
 * ---------------------------
 * `ensureUser` portait une constante de slug de tenant (le littéral `demo`, dont
 * le NOM n'est volontairement pas recopié ici : le ratchet AC-4 de
 * `user-sync.service.spec.ts` cherche ce symbole dans tout `apps/api/src` et doit
 * ne le trouver QUE dans `register.controller.ts`, la moitié différée — une
 * documentation qui le cite rendrait le garde-fou rouge, ce qui est exactement
 * `PF-83`). Quand aucun `UserProfile` ne correspondait au sujet, il
 * **faisait exister** un tenant
 * `demo` (`tenant.upsert`) puis y créait le profil en `status: active`. Comme
 * ~242 sites d'appel font `const me = await this.users.ensureUser(jwt)` puis
 * scopent tout par `me.tenantId`, ce qui sortait d'ici ÉTAIT la tenancy de la
 * requête : la tenancy était donc assignée par une CONSTANTE, jamais résolue
 * depuis quelque chose de fiable. ADR-004 mettant tous les tenants dans UN seul
 * realm, n'importe quelle identité du realm jamais connectée devenait
 * silencieusement membre `active` d'un tenant que sa propre connexion créait,
 * en portant les permissions de ses rôles realm.
 *
 * LA DÉCISION : **une connexion n'est pas un événement de provisioning.**
 * Le provisioning appartient aux chemins qui le font explicitement et dans un
 * tenant réel (`invite.controller.persistInvitedProfile`, `register.controller`,
 * et le seed). Ici on RÉSOUT, ou on REFUSE.
 *
 * REFUS, JAMAIS RÉPARATION (discipline ADR-032, une couture plus loin) : pas de
 * défaut, pas de « best effort », pas d'assainissement. La branche par défaut
 * refuse.
 *
 * POURQUOI 403 ET NON 401 — l'argument est tranché par la MESURE, pas par la
 * sémantique :
 *  - le jeton EST valide ; `jwt.strategy.ts:60` détient déjà le seul 401 de
 *    cette couture. Un second 401 affirmerait « credentials manquants ou
 *    invalides », ce qui est faux ;
 *  - `apps/web/src/lib/api-client.ts:111-113` intercepte le 401 AVANT tout
 *    appelant et fait `redirect('/{portal}/login?error=session_expired')`, et
 *    `AppShellRoot.tsx:86` (les quatre portails) appelle `fetchMe()` à chaque
 *    page. Un 401 ici produit donc une BOUCLE login → shell → 401 → login,
 *    légendée par un mensonge (« session expirée » alors qu'elle ne l'est pas),
 *    et un jeton rafraîchi ne peut pas faire apparaître un `UserProfile` ;
 *  - 403 est terminal et vrai : authentifié, non autorisé, parce que non
 *    rattaché. L'objection « 403 fuit un bit d'existence » est acceptée et jugée
 *    négligeable : l'appelant détient déjà un jeton valide du realm.
 *
 * DNC-10 — aucun contournement, et aucune place pour en glisser un : ce fichier
 * ne lit aucune variable d'environnement, ne porte ni `ALLOW_AUTO_PROVISION` ni
 * `SKIP_*`, n'a pas de branche `NODE_ENV` et n'appelle plus `tenant.*` du tout.
 * Si le poste de développement a besoin d'un profil, c'est le SEED qui le
 * fournit (`prisma/seed-demo.ts` provisionne `admin@` / `teacher@` /
 * `parent@pilotage.local` dans le tenant de démonstration seedé — dont le slug
 * n'est PAS recopié ici : `scripts/production-artefact-check.js` règle `A4`
 * cherche ce littéral dans le brut, commentaires compris, et une prose qui le
 * cite rend la porte `production-artefact-gate` rouge). Un drapeau de contournement
 * serait le défaut avec un autre chapeau. `user-sync.service.spec.ts` le
 * mécanise.
 *
 * CE QUE CETTE COUTURE NE PRÉTEND PAS FERMER (à lire avant d'en conclure quoi
 * que ce soit) :
 *  - `PF-165` moitié (b) : `permissions.guard.ts:28` appelle
 *    `effectivePermissions(jwt.sub, realmRoles)`, qui unionne
 *    `REALM_ROLE_PERMISSIONS[r]` SANS exiger de profil (voir plus bas : le
 *    lookup n'AJOUTE que). Un sujet non provisionné franchit donc encore un
 *    `@RequiresPermission` et ne rencontre le refus que là où le corps du
 *    handler appelle `ensureUser`. Déplacer l'exigence dans le guard change la
 *    sémantique de refus de ~50 contrôleurs d'un coup : sa propre story ;
 *  - `PF-185` : `register.controller.ts` continue d'upserter le tenant `demo`
 *    (moitié (b), délibérément différée — un membre du public anonyme
 *    n'appartient encore à aucune école, et inventer une règle de résolution ici
 *    contredirait la couture censée la définir) ;
 *  - `PF-186` : la recherche par email n'est PAS scopée par tenant alors que
 *    `email` n'est unique que PAR tenant (`schema.prisma:879`). La branche
 *    ci-dessous ne choisit donc plus une ligne arbitraire — elle REFUSE
 *    l'ambiguïté — mais savoir QUEL tenant adopter quand la même adresse existe
 *    dans deux établissements reste ouvert, et dépend du discriminant `D-02` ;
 *  - les profils déjà auto-créés dans `demo` par l'ancienne branche ne sont pas
 *    remédiés : cette story arrête l'invention NOUVELLE.
 */

/**
 * Le discriminant machine du refus. Il existe pour que le web puisse brancher
 * dessus SANS faire du pattern-matching sur une phrase française qui, elle,
 * changera (`PF-186` moitié UI : aujourd'hui un 403 atterrit sur l'état d'erreur
 * générique « Réessayer », dont le CTA est une boucle garantie perdante).
 */
export const UNPROVISIONED_USER_CODE = 'ACCOUNT_NOT_PROVISIONED';

/**
 * LA phrase de refus, unique et identique pour TOUTES les formes de refus.
 *
 * Elle nomme l'état PUIS l'étape suivante (north star : transformer
 * l'information en action) ; elle ne stigmatise personne — cet utilisateur n'a
 * rien fait de mal ; et elle ne révèle RIEN : ni qu'un compte, un email ou un
 * tenant existe localement, ni `UserProfile`, ni `Tenant`, ni un slug, ni un
 * identifiant de sujet. C'est ce qui empêche d'en faire un oracle
 * d'énumération : « sub inconnu », « email connu dans un autre tenant » et
 * « email déjà lié à un autre sujet » rendent la MÊME chaîne et le MÊME statut ;
 * le détail discriminant part au log serveur, jamais sur le fil.
 *
 * Apostrophe DROITE dans une chaîne à guillemets doubles : la typographique `’`
 * est une convention de copie JSX, pas de source `.ts`, et ne doit pas atteindre
 * le fil.
 */
export const UNPROVISIONED_USER_MESSAGE =
  "Votre compte n'est rattaché à aucun établissement. " +
  "Contactez l'administrateur de votre établissement pour activer votre accès.";

/**
 * L'erreur nommable de cette couture, sur le modèle de `TenantContextError`
 * (`shared/prisma/prisma.service.ts:52-56`) : exportée depuis le fichier même
 * qu'elle garde, pour que les appelants et les tests puissent la NOMMER.
 *
 * Elle étend `ForbiddenException` et non `Error` : Nest la traduit alors sur le
 * fil sans filtre d'exception, donc aucun mécanisme transverse nouveau — le
 * *mécanisme* n'est pas la décision, la décision est dans ADR-043.
 */
export class UnprovisionedUserError extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      message: UNPROVISIONED_USER_MESSAGE,
      code: UNPROVISIONED_USER_CODE,
    });
    this.name = 'UnprovisionedUserError';
  }
}

/** Motifs de refus — pour le LOG SERVEUR uniquement. Jamais sur le fil. */
type RefusalReason = 'no-match' | 'ambiguous-email' | 'email-bound-to-another-subject';

@Injectable()
export class UserSyncService {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Résout le `UserProfile` du sujet authentifié, ou REFUSE.
   *
   * Aucune écriture n'est faite sur un refus — ni `Tenant`, ni `UserProfile`, ni
   * ligne d'audit. Pas d'audit, et c'est une décision, pas un oubli (G-AUDIT
   * autorise explicitement la branche « on décide que non ») : (1) rien ne s'est
   * produit ; (2) un refus n'a justement PAS de tenancy résolue à laquelle
   * scoper la ligne, alors que `AuditLog.tenantId` est requis ; (3) sur ~232
   * handlers, tout porteur d'un jeton realm valide pourrait sinon pomper des
   * lignes non bornées dans une table append-only. La trace compensatoire est le
   * `warn` ci-dessous — un refus ne doit être ni silencieux ni une fuite.
   */
  async ensureUser(payload: KeycloakJwtPayload) {
    const sub = payload.sub;
    const email = (payload.email ?? payload.preferred_username ?? '').toLowerCase();

    // AUCUN try/catch autour des deux lectures, délibérément : envelopper une
    // panne de base dans ce refus transformerait un incident d'indisponibilité
    // en « vous n'êtes rattaché à aucun établissement » — un fail-open déguisé
    // qui masque en plus l'incident. Le refus n'est levé que sur la branche
    // EXPLICITE « rien ne correspond ».
    const bound = await this.prisma.userProfile.findUnique({
      where: { authProviderId: sub },
    });
    if (bound) return bound;

    if (email) {
      // `findMany({ take: 2 })` et non `findFirst` : `email` n'est unique que
      // PAR tenant (`schema.prisma:879`), donc `findFirst` rend une ligne
      // ARBITRAIRE dans un ordre non spécifié. Supprimer la branche de création
      // sans corriger ceci aurait remplacé « tenancy par constante » par
      // « tenancy par ligne arbitraire », c'est-à-dire la même violation
      // G-TENANT avec un non-déterminisme en prime. `take: 2` suffit : on n'a
      // pas besoin de compter, seulement de savoir si c'est ambigu.
      const candidates = await this.prisma.userProfile.findMany({ where: { email }, take: 2 });

      if (candidates.length > 1) {
        return this.refuse(sub, 'ambiguous-email');
      }

      const candidate = candidates[0];
      if (candidate) {
        // ADOPTION uniquement si la ligne n'est liée à AUCUN sujet.
        // `authProviderId` est unique GLOBALEMENT (`schema.prisma:838`) : écraser
        // une liaison existante VOLERAIT l'identité de son titulaire, et le
        // titulaire légitime — qui manquerait alors son `findUnique` — serait
        // désormais refusé au lieu d'être re-provisionné silencieusement. Le cas
        // `authProviderId === sub` est inatteignable ici (le `findUnique`
        // ci-dessus l'aurait rendu) ; il est couvert par la même condition.
        if (candidate.authProviderId === null || candidate.authProviderId === sub) {
          const adopted = await this.prisma.userProfile.update({
            where: { id: candidate.id },
            data: { authProviderId: sub },
          });
          this.logger.log(`Linked existing profile ${candidate.id} to sub ${sub}`);
          return adopted;
        }
        return this.refuse(sub, 'email-bound-to-another-subject');
      }
    }

    return this.refuse(sub, 'no-match');
  }

  /**
   * L'unique construction du refus.
   *
   * Le log porte le `sub` SEUL — pas d'email, pas de `preferred_username`, pas de
   * nom (minimisation RGPD, GUARDRAILS §1, même posture que `PF-176`). Le motif
   * est un libellé fermé, pas une donnée personnelle, et il ne sort jamais d'ici.
   *
   * Le type de retour est `never` : c'est ce qui permet à `ensureUser` de faire
   * `return this.refuse(...)` sans élargir son type de retour à `undefined`.
   */
  private refuse(sub: string, reason: RefusalReason): never {
    this.logger.warn(`Unprovisioned subject refused (${reason}) sub=${sub}`);
    throw new UnprovisionedUserError();
  }

  /**
   * Effective permission set = realm-role permissions ∪ custom-role permissions.
   *
   * NOTE (`PF-165` moitié (b), pas fermée par S-E01-1a) : le lookup ci-dessous
   * n'AJOUTE que. Un sujet sans profil obtient donc encore l'union de ses rôles
   * realm, et `permissions.guard.ts:28` le laisse franchir un
   * `@RequiresPermission`. Exiger un profil ICI changerait la sémantique de refus
   * de ~50 contrôleurs en une fois — sa propre story, délibérément pas celle-ci.
   */
  async effectivePermissions(sub: string, realmRoles: string[]): Promise<Set<string>> {
    const set = new Set<string>();
    for (const r of realmRoles) {
      const list = REALM_ROLE_PERMISSIONS[r] ?? [];
      for (const p of list) set.add(p);
    }

    const user = await this.prisma.userProfile.findUnique({
      where: { authProviderId: sub },
      include: {
        userRoles: {
          where: { revokedAt: null },
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
      },
    });
    if (user) {
      for (const ur of user.userRoles) {
        for (const rp of ur.role.rolePermissions) set.add(rp.permission.code);
      }
    }

    return set;
  }

  async listPermissions(sub: string, realmRoles: string[]): Promise<string[]> {
    const set = await this.effectivePermissions(sub, realmRoles);
    return [...set].sort();
  }
}
