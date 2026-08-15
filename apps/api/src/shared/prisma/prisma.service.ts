import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// `type Prisma` DÉLIBÉRÉMENT en spécificateur de TYPE : `Prisma` est un espace de
// noms qui porte aussi des valeurs à l'exécution, et l'importer comme valeur
// ferait entrer ce runtime dans un spec qui tourne SANS client généré et SANS
// `DATABASE_URL`. Seul le TYPE `Prisma.TransactionClient` est utilisé ici, et un
// spécificateur `type` est effacé à la compilation. Un seul `import` depuis le
// module, pour ne pas heurter `import/no-duplicates`.
import { PrismaClient, type Prisma } from '@prisma/client';

/**
 * Nom du réglage PostgreSQL (GUC) qui porte le tenant courant.
 *
 * Exporté comme symbole UNIQUE pour que la future policy RLS (story ultérieure)
 * référence la même chaîne. Une divergence de nom entre ce helper et le prédicat
 * de la policy serait indétectable jusqu'à l'existence d'un test d'intégration
 * RLS, et son symptôme serait le pire possible : tout fonctionne, rien n'est
 * isolé.
 *
 * Le nom reste un LITTÉRAL dans le texte SQL : `set_config` ne sait pas le
 * paramétrer, et le lier inviterait un appelant futur à le rendre dynamique.
 * Seule la VALEUR est liée. Le spec vérifie que le SQL émis contient bien cette
 * constante, de sorte qu'une faute de frappe devient rouge.
 */
export const TENANT_GUC = 'app.current_tenant_id';

/**
 * Forme canonique acceptée par le type `uuid` de PostgreSQL — rien d'autre.
 *
 * Volontairement PLUS étroite que la base (qui accepte aussi les formes entre
 * accolades et sans tirets) : être plus strict que la base est la direction
 * « fail closed ». Volontairement PLUS large que RFC-4122 : on ne teste ni le
 * nibble de version ni celui de variante, car un tenant légitime dont l'id vient
 * d'un générateur v7, d'un import ou d'une fixture serait alors refusé par une
 * règle plus stricte que la base elle-même — un bug de disponibilité déguisé en
 * sécurité. La propriété de sécurité vient de l'ALPHABET : hexadécimal et tirets
 * ne contiennent ni quote, ni point-virgule, ni antislash, ni espace, ni
 * marqueur de commentaire.
 */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La valeur refusée n'est JAMAIS recopiée dans le message : elle peut être une
 * charge utile fournie par un attaquant, et ce message finit dans les logs
 * structurés (injection de log, CRLF) voire dans un corps de réponse 500. On
 * nomme le motif et la forme, pas le contenu.
 */
const NO_ECHO =
  'La valeur refusée n’est pas recopiée ici (charge utile potentiellement hostile) ; ' +
  'seule sa forme est rapportée.';

/** Erreur de contexte tenant. Interne à l'API : ce n'est pas une forme client. */
export class TenantContextError extends Error {
  constructor(reason: string) {
    super('Contexte tenant refusé (app.current_tenant_id) : ' + reason);
    this.name = 'TenantContextError';
  }
}

/**
 * Valide un identifiant de tenant et le RENVOIE, ou lève.
 *
 * DNC-10 — il n'existe aucun contournement, et c'est délibéré : pas d'identifiant
 * « système » autorisé, pas de constante privilégiée, pas de variable
 * d'environnement d'échappement, pas de branche pour les jobs de fond. Si un
 * chemin asynchrone doit un jour sortir du périmètre d'un tenant, il obtiendra sa
 * propre couture nommée et auditée dans sa propre story — ADR-002 provisionne
 * déjà cela au niveau des RÔLES PostgreSQL (`app_migrator`, `auditor`), qui est
 * l'endroit correct, et non une comparaison de chaîne dans le code applicatif.
 *
 * L'UUID nul (que des zéros) n'est ni interdit ni privilégié : il est bien formé,
 * donc il passe la validation et ne correspondra simplement à aucune ligne
 * `tenant`. C'est une question de politique, pas de forme — ne pas la « corriger »
 * ici.
 *
 * REFUS, jamais assainissement : pas de `trim()`, pas de mise en minuscules, pas
 * de retrait de caractères. Un assainisseur qui retire une quote transforme une
 * attaque en contexte tenant silencieusement FAUX, ce qui est pire qu'un crash.
 * Et normaliser la casse avant de lier casserait la relecture, qui compare à la
 * valeur d'origine.
 *
 * Le refus du non-`string` vient AVANT la regex : `tenantId: string` n'est qu'une
 * promesse de compilation, la valeur réelle vient d'un claim JWT. Un claim de la
 * forme `['<uuid>']` ou `{ toString() { … } }` serait coercé par la regex et
 * passerait.
 */
export function assertTenantId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TenantContextError(
      'valeur de type ' + typeof value + ' au lieu d’une chaîne. ' + NO_ECHO,
    );
  }

  if (!CANONICAL_UUID.test(value)) {
    throw new TenantContextError(
      'chaîne de longueur ' + value.length + ' qui n’est pas un UUID canonique. ' + NO_ECHO,
    );
  }

  return value;
}

/** Le minimum qu'un client de transaction doit savoir faire pour poser le GUC. */
export interface TenantRawClient {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * Le minimum qu'un client racine doit savoir faire pour ouvrir la transaction.
 *
 * PARAMÉTRÉ par le type du client de transaction (`TTx`), avec `TenantRawClient`
 * pour défaut — de sorte que les appelants existants sont inchangés, et que
 * `runWithTenant` peut rendre à `fn` le type EXACT que le client fournit au lieu
 * de le forcer par un cast. C'est ce qui supprime le
 * `fn(tx as unknown as PrismaClient)` d'avant : le cast n'est pas déplacé, il
 * n'existe plus.
 */
export interface TenantTransactionRunner<TTx extends TenantRawClient = TenantRawClient> {
  $transaction<R>(fn: (tx: TTx) => Promise<R>): Promise<R>;
}

/**
 * Pose le contexte tenant sur une transaction DÉJÀ ouverte, puis le RELIT.
 *
 * La valeur part en PARAMÈTRE LIÉ ($1) : le template balisé de Prisma ne
 * concatène rien dans le texte SQL. Le nom du réglage et le troisième argument
 * (`true` = portée transaction, exactement la sémantique de l'ancienne forme
 * assignative supprimée par cette story) restent des littéraux.
 */
async function applyTenantContext(tx: TenantRawClient, id: string): Promise<void> {
  const result = await tx.$queryRaw`
    SELECT set_config('app.current_tenant_id', ${id}, true) AS applied
  `;

  // `set_config` RENVOIE la valeur posée : on la relit plutôt que de la supposer.
  // Cette comparaison unique couvre les QUATRE échecs — résultat vide, colonne
  // absente ou renommée, valeur non-string, valeur différente. Ne pas la
  // « simplifier » en test d'optionalité : la branche `undefined` EST la branche
  // fail-closed.
  const rows = result as { applied?: unknown }[] | undefined;
  const applied = Array.isArray(rows) ? rows[0]?.applied : undefined;

  if (applied !== id) {
    throw new TenantContextError(
      'la relecture ne rend pas la valeur demandée ; la transaction est abandonnée ' +
        'plutôt que d’exécuter un bloc sous un contexte tenant non prouvé. ' +
        NO_ECHO,
    );
  }
}

/**
 * Exécute `fn` dans une transaction dont le contexte tenant est posé et PROUVÉ.
 *
 * Fonction libre prenant son client en argument (même forme que
 * `readMigrationState` / `assertMigrationsClean`) : c'est ce qui rend la preuve
 * exécutable sans construire un `PrismaClient`, donc sans client généré ni
 * `DATABASE_URL`.
 *
 * ORDRE, et il porte la propriété : la validation est faite AVANT
 * `$transaction`. Valider dans le callback coûterait une connexion du pool et un
 * BEGIN/ROLLBACK par requête refusée — une amplification de déni de service
 * offerte — et rendrait inécrivable l'assertion « aucune requête n'a été émise ».
 *
 * `fn` reçoit le client de TRANSACTION avec son type exact, pas un `PrismaClient`
 * reconstitué par cast. Voir `PrismaService.withTenant` pour ce que cette
 * distinction rend impossible à compiler.
 */
export async function runWithTenant<T, TTx extends TenantRawClient = TenantRawClient>(
  client: TenantTransactionRunner<TTx>,
  tenantId: unknown,
  fn: (tx: TTx) => Promise<T>,
): Promise<T> {
  const id = assertTenantId(tenantId);

  return client.$transaction(async (tx) => {
    await applyTenantContext(tx, id);
    return fn(tx);
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Exécute un bloc avec le contexte tenant posé sur la transaction.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CE QUI EST VRAI DEPUIS S-E01-2b (mesuré, exécuté — pas déduit)            │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * 1. Les policies RLS EXISTENT. `20260813120000_tenant_rls_policies` pose
   *    `ENABLE ROW LEVEL SECURITY` et une policy `tenant_isolation`
   *    (`FOR ALL TO PUBLIC`, `USING` = `WITH CHECK`) sur les 44 tables portant
   *    une colonne `tenant_id`, et accorde le DML de ces 44 tables à `app_user`.
   * 2. Elles REFUSENT, et c'est PROUVÉ PAR EXÉCUTION contre un vrai PostgreSQL,
   *    connecté comme `app_user` — un rôle qui sait se connecter, ne possède
   *    AUCUNE des tables et n'a pas `BYPASSRLS`
   *    (`scripts/rls-isolation-check.js`, G-TENANT). La preuve montre les lignes
   *    APPARAÎTRE puis DISPARAÎTRE selon le GUC, pas seulement disparaître :
   *    `app_user` n'avait aucun privilège avant cette migration, donc une preuve
   *    qui n'aurait montré que l'absence aurait été verte pour la mauvaise
   *    raison.
   * 3. Le prédicat est
   *    `nullif(current_setting('app.current_tenant_id', true), '')::uuid = tenant_id`.
   *    Le `nullif` n'est pas cosmétique : APRÈS le COMMIT d'une transaction, un
   *    `set_config(…, true)` laisse le GUC à `''` — PAS à NULL — et un cast nu
   *    lèverait alors `22P02` sur la DEUXIÈME requête de chaque connexion du
   *    pool. Mesuré sur ce cluster. Contexte absent ou vide ⇒ AUCUNE ligne, et
   *    AUCUNE erreur.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CE QUI N'EST TOUJOURS PAS VRAI — à lire avant d'en conclure quoi que ce   │
   * │ soit sur l'isolation                                                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * 4. **L'APPLICATION QUI TOURNE N'EST PAS ISOLÉE PAR RLS.** Elle se connecte
   *    comme `pilotage`, PROPRIÉTAIRE des 55 tables, et un propriétaire n'est pas
   *    soumis à ses propres policies tant que `FORCE ROW LEVEL SECURITY` n'est
   *    pas posé. `FORCE` est absent DÉLIBÉRÉMENT : posé aujourd'hui, il rendrait
   *    zéro ligne à toutes les requêtes de toute l'application. Le correctif est
   *    la BASCULE DE CONNEXION vers `app_user`, pas davantage de policy.
   *    — DATÉ S-E01-1d (ADR-048). Cette phrase reste VRAIE pour CE service : il
   *    est et reste le client PROPRIÉTAIRE. Ce qui a changé, c'est qu'il n'est
   *    plus le seul : `AppRolePrismaService` ouvre une SECONDE connexion, non
   *    propriétaire, sur `DATABASE_URL_APP`, et `TenantScopeService` y fait
   *    passer les sites d'appel qu'un module a explicitement convertis (le
   *    module `calendar`, sept sites, pour l'instant). La bascule cesse d'être un
   *    événement tout-ou-rien et devient une migration par module. Les ~782
   *    autres sites restent ici, sur le propriétaire, non isolés — et sur un
   *    déploiement où `DATABASE_URL_APP` n'est pas déclarée, MÊME les sites
   *    convertis y restent (mode dégradé, nommé au démarrage et publié par
   *    `pilotage_tenant_scope_enforced` = 0).
   * 5. ~~Ce helper a toujours ZÉRO appelant.~~ — DATÉ S-E01-1d. Cette phrase
   *    était vraie de `S-E01-2b` à `S-E01-1c` incluses ; elle ne l'est plus.
   *    `TenantScopeService.run` (`tenant-scope.service.ts`) est le PREMIER
   *    appelant de production, et il est délibérément le seul : la couture ne
   *    s'atteint que par lui. La narrowing de type ci-dessous a bien atterri
   *    AVANT ce premier appelant, ce qui était son intention — elle a fait son
   *    office dès la conversion du seed calendrier, qui ne compile pas dans une
   *    portée et se retrouve donc exclu par NOM plutôt que par oubli.
   * 6. La couverture des policies est désormais COMPLÈTE au sens du catalogue,
   *    et cette phrase a changé DEUX fois — elle est datée pour cette raison.
   *    - `S-E01-2b` : les 44 tables portant `tenant_id`.
   *    - `S-E01-2c` (`ADR-042`) : les 5 tables sans `tenant_id` qui dérivent leur
   *      tenant par clé étrangère (`grade_revision`, `announcement_receipt`,
   *      `branding`, `import_row`, `user_role`).
   *    - `S-E01-2d` (`ADR-044`) : `outbox_event`, la dernière restante, qui ne
   *      détient AUCUNE clé étrangère (`aggregate_type`/`aggregate_id` sont
   *      polymorphes) et reçoit donc un `tenant_id` DÉNORMALISÉ. Ferme PF-185.
   *    Il ne reste hors policy que la donnée de RÉFÉRENCE (`permission`, `role`,
   *    `role_permission`), `tenant` — dont la clé primaire EST le discriminant,
   *    exclue délibérément pour que la couture identité puisse la lire PAR SLUG
   *    avant qu'un tenant soit résolu — et le ledger `_prisma_migrations`.
   *    **PF-02 moitié (a) reste refermée PARTIELLEMENT malgré tout**, et la
   *    raison n'est plus une table manquante : c'est le point 4 ci-dessus. Les
   *    policies sont complètes ; la connexion, elle, est toujours celle du
   *    PROPRIÉTAIRE.
   * 7. Un UUID bien formé est une FORME, pas un DROIT. Ce helper ne sait pas
   *    distinguer le tenant A du tenant B : la résolution et l'autorisation
   *    appartiennent à la couture identité. Ne pas lire cette validation comme un
   *    contrôle d'accès. (Proposition inchangée, et toujours la plus mal lue.)
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CE QUE LA SIGNATURE REND IMPOSSIBLE À COMPILER                            │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * `fn` reçoit un `Prisma.TransactionClient`, pas un `PrismaClient`. Ce type
   * n'expose ni `$transaction` ni `$connect`, donc DEUX erreurs deviennent des
   * erreurs de COMPILATION plutôt que des fuites silencieuses :
   * - ouvrir une transaction imbriquée (Prisma en ouvrirait une SECONDE, sur une
   *   AUTRE connexion, où le contexte n'est pas posé) ;
   * - émettre la requête sur le service injecté au lieu de `tx` — la faute du
   *   « on a fermé sur `this` » — puisque le service, lui, porte `$transaction`.
   *
   * PRÉCAUTIONS D'EMPLOI, pour le premier appelant réel :
   * - ceci ouvre une transaction INTERACTIVE Prisma (défauts maxWait 2 s /
   *   timeout 5 s) : uniquement de courtes unités de travail, jamais un import ou
   *   un rapport complet ;
   * - la relecture prouve que le contexte a été APPLIQUÉ, pas qu'il persistera :
   *   sa portée est la transaction, donc la requête doit être émise sur `tx` et
   *   non sur le client racine.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return runWithTenant(
      this as unknown as TenantTransactionRunner<Prisma.TransactionClient>,
      tenantId,
      fn,
    );
  }
}
