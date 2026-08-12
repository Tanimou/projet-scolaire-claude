import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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

/** Le minimum qu'un client racine doit savoir faire pour ouvrir la transaction. */
export interface TenantTransactionRunner {
  $transaction<R>(fn: (tx: TenantRawClient) => Promise<R>): Promise<R>;
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
 */
export async function runWithTenant<T>(
  client: TenantTransactionRunner,
  tenantId: unknown,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  const id = assertTenantId(tenantId);

  return client.$transaction(async (tx) => {
    await applyTenantContext(tx, id);
    return fn(tx as unknown as PrismaClient);
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
   * CE QUE CE HELPER EST AUJOURD'HUI (mesuré, V3-E01 / PF-02, ADR-032) :
   *
   * 1. Il a ZÉRO appelant. Un grep de `withTenant` sur `apps/**` et `packages/**`
   *    ne rend que sa propre définition. Les appelants (chemin requête, chemin
   *    job) vivent dans la couture identité, qui est le périmètre d'une autre
   *    story.
   * 2. Il n'existe AUCUNE policy RLS dans cette base : zéro `ENABLE ROW LEVEL
   *    SECURITY`, zéro `CREATE POLICY` dans tout le dépôt, `0_baseline` compris.
   *    La moitié RLS d'ADR-002 n'est pas implémentée.
   * 3. Donc : ceci est la COUTURE D'APPLICATION FUTURE, pas un mécanisme
   *    d'isolation actif. Personne ne doit conclure d'ici que les dépôts sont
   *    isolés par RLS aujourd'hui — ils ne le sont pas. L'ancien commentaire
   *    « utilisé par tous les dépôts, donc les policies RLS s'appliquent » était
   *    faux sur ses DEUX propositions ; c'est la moitié (b) de PF-02, avec
   *    l'interpolation du tenant dans le texte SQL, supprimée par cette story.
   * 4. Un UUID bien formé est une FORME, pas un DROIT. Ce helper ne sait pas
   *    distinguer le tenant A du tenant B : la résolution et l'autorisation
   *    appartiennent à la couture identité. Ne pas lire cette validation comme
   *    un contrôle d'accès.
   * 5. Activer RLS est une story ULTÉRIEURE, parce que le prédicat de policy ne
   *    vaut rien tant qu'il n'existe pas d'appelants sur les chemins requête et
   *    job. Deux pièges y sont déjà consignés (voir ADR-032) : le propriétaire
   *    des tables contourne RLS sans `FORCE ROW LEVEL SECURITY`, et
   *    `current_setting(name)` sans son second argument casse migrations, jobs et
   *    health checks.
   *
   * PRÉCAUTIONS D'EMPLOI, pour le premier appelant réel :
   * - ceci ouvre une transaction INTERACTIVE Prisma (défauts maxWait 2 s /
   *   timeout 5 s) : uniquement de courtes unités de travail, jamais un import ou
   *   un rapport complet ;
   * - ne pas l'appeler depuis une transaction déjà ouverte : Prisma ouvrirait une
   *   SECONDE transaction indépendante, sur une autre connexion, et le contexte
   *   ne s'appliquerait qu'à celle-ci ;
   * - la relecture prouve que le contexte a été APPLIQUÉ, pas qu'il persistera :
   *   sa portée est la transaction, donc la requête doit être émise sur `tx` et
   *   non sur le client racine.
   */
  async withTenant<T>(tenantId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return runWithTenant(this as unknown as TenantTransactionRunner, tenantId, fn);
  }
}
