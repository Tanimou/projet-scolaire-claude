import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';

import { tenantScopeEnforced } from '../../modules/metrics/metrics.registry';

import { type TenantTransactionRunner } from './prisma.service';
import {
  APP_ROLE_REQUIRED_PRIVILEGES,
  type AppRoleProbe,
  appRoleVerdict,
  privilegeKey,
  readPoolSettings,
  type TenantScopeState,
} from './tenant-scope';

/**
 * S-E01-1d — la DEUXIÈME connexion.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI UNE SECONDE CONNEXION PLUTÔT QU'UNE BASCULE DE `DATABASE_URL`   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Avec UNE connexion, la bascule ne peut pas converger : le jour où l'API se
 * connecte comme `app_user`, TOUT site d'appel qui ne pose pas le GUC rend ZÉRO
 * LIGNE. Un site couvert sur 792 n'est donc pas un progrès de sécurité, c'est un
 * site couvert et 791 pannes — la couverture devrait valoir 792/792 le jour J,
 * soit un changement d'un seul tenant sur 223 fichiers qu'aucune relecture
 * n'absorbe.
 *
 * Avec DEUX connexions, l'application garde son client PROPRIÉTAIRE pour les
 * sites non convertis, et ce client-ci ne sert QUE les sites qu'un module a
 * explicitement fait entrer dans une portée. La couverture croît module par
 * module, chaque module réellement enforcé le jour où il convertit, et un site
 * non converti continue simplement de fonctionner au lieu de tomber.
 *
 * L'ASYMÉTRIE QUI REND L'OPT-IN ACCEPTABLE, et il faut l'écrire : oublier
 * d'ouvrir la portée sur un site laisse ce site sur la connexion du
 * propriétaire, c'est-à-dire dans le statu quo d'avant la story — pas une panne,
 * pas une fuite nouvelle. Oublier l'audit, lui, laisse un trou de gouvernance.
 * C'est pourquoi ADR-035 refuse l'intercepteur pour l'audit et pourquoi le même
 * raisonnement autorise l'opt-in ici.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE QUE CE SERVICE N'EST PAS                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ce n'est PAS un second `PrismaService`. Étendre `PrismaService` rejouerait son
 * `onModuleInit` et connecterait le propriétaire DEUX fois. C'est un service qui
 * DÉTIENT un `PrismaClient` — composition, pas héritage — et qui n'expose que ce
 * dont la couture a besoin.
 *
 * Ce n'est PAS un composeur de chaîne de connexion. L'URL est lue VERBATIM dans
 * `DATABASE_URL_APP` et passée telle quelle à `datasourceUrl`. Aucun ajout de
 * paramètre, aucune reconstruction, aucune valeur par défaut, et surtout jamais
 * une réécriture de `DATABASE_URL` : du code capable de composer une chaîne de
 * connexion est du code capable de composer le mauvais RÔLE. Le dimensionnement
 * du pool se déclare dans l'URL — `connection_limit=5`, parce qu'un module sur
 * ~26 est converti et que ce pool s'AJOUTE à celui du propriétaire (défaut
 * Prisma `cpus*2+1` chacun) sur le `max_connections` du VPS. À revoir par module.
 */
@Injectable()
export class AppRolePrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppRolePrismaService.name);

  private client: PrismaClient | null = null;

  private state: TenantScopeState = 'degraded_no_app_url';

  private refusalReason: string | null = null;

  /**
   * Ouvre et SONDE la seconde connexion quand elle est déclarée. Ne fait
   * strictement RIEN quand elle ne l'est pas : aucun client n'est construit,
   * aucun socket n'est ouvert. C'est ce qui rend le retour arrière d'AC-6
   * gratuit — retirer les `run(...)` du contrôleur laisse ici du code mort qui
   * ne construit rien.
   *
   * POURQUOI SONDER AU DÉMARRAGE ET PAS À LA PREMIÈRE REQUÊTE : Prisma se
   * connecte paresseusement. Sans `$connect()` explicite, l'état « déclarée mais
   * inutilisable » se découvrirait sur la première requête calendrier d'un
   * utilisateur, en production, au lieu du démarrage.
   *
   * POURQUOI CET ÉCHEC NE TUE PAS LE PROCESSUS — variante assumée, pas un oubli.
   * Refuser le démarrage sur une seconde connexion mal configurée emporterait
   * les quatre portails et les 782 sites d'appel qui n'en ont jamais eu besoin :
   * un rayon d'explosion strictement plus grand que la panne qu'on veut éviter.
   * On refuse donc À L'ÉCHELLE DE LA COUTURE — chaque site converti rend 503 —
   * et JAMAIS en se rabattant sur le propriétaire. Le refus est bruyant : un
   * `logger.error`, la jauge à 0, et une erreur par requête concernée.
   */
  async onModuleInit(): Promise<void> {
    const declared = process.env.DATABASE_URL_APP;

    if (declared === undefined || declared.trim().length === 0) {
      this.state = 'degraded_no_app_url';
      tenantScopeEnforced.set(0);
      // UNE ligne, au démarrage, et elle nomme la VARIABLE — jamais sa valeur,
      // jamais un rôle, jamais un hôte (règle §FUITE de `config-preflight.ts`).
      this.logger.warn(
        'PORTÉE TENANT DÉGRADÉE (degraded_no_app_url) : DATABASE_URL_APP n’est pas déclarée. ' +
          'Les sites d’appel convertis s’exécutent sur la connexion du PROPRIÉTAIRE, qui échappe ' +
          'à ses propres policies : RIEN n’est enforcé par la base sur ce déploiement. ' +
          'La jauge pilotage_tenant_scope_enforced vaut 0.',
      );
      return;
    }

    const pool = readPoolSettings(declared);
    const client = new PrismaClient({ datasourceUrl: declared });
    this.client = client;

    try {
      await client.$connect();
      const verdict = appRoleVerdict(await probeAppRole(client));
      if (!verdict.enforcing) {
        this.state = 'refused_unusable';
        this.refusalReason = verdict.reason;
        tenantScopeEnforced.set(0);
        this.logger.error(
          'PORTÉE TENANT REFUSÉE (refused_unusable) : DATABASE_URL_APP est déclarée mais la ' +
            'connexion ne peut pas être qualifiée d’enforçante — ' +
            String(verdict.reason) +
            '. Aucun repli sur le propriétaire n’est effectué (DNC-08) : les sites d’appel ' +
            'convertis répondront 503 jusqu’à correction de la configuration.',
        );
        return;
      }
    } catch (error) {
      this.state = 'refused_unusable';
      this.refusalReason = 'la sonde de démarrage a levé : ' + describeError(error);
      tenantScopeEnforced.set(0);
      this.logger.error(
        'PORTÉE TENANT REFUSÉE (refused_unusable) : ' +
          String(this.refusalReason) +
          '. Aucun repli sur le propriétaire (DNC-08).',
      );
      return;
    }

    this.state = 'enforced';
    tenantScopeEnforced.set(1);
    this.logger.log(
      'Portée tenant ENFORCÉE (enforced) : seconde connexion non propriétaire ouverte, ' +
        'sonde passée (ni propriétaire, ni BYPASSRLS, ni membre du propriétaire, ' +
        String(APP_ROLE_REQUIRED_PRIVILEGES.length) +
        ' privilèges requis détenus). connection_limit=' +
        String(pool.connectionLimit === null ? 'NON DÉCLARÉ' : pool.connectionLimit) +
        ' pool_timeout=' +
        String(pool.poolTimeout === null ? 'NON DÉCLARÉ' : pool.poolTimeout) +
        '.',
    );
    if (pool.connectionLimit === null) {
      this.logger.warn(
        'DATABASE_URL_APP ne déclare pas connection_limit : Prisma appliquera son défaut ' +
          '(cpus*2+1) EN PLUS du pool du propriétaire. Le dimensionnement se déclare dans ' +
          'l’URL — aucun code ne le compose ici.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // `PrismaService.onModuleDestroy` ne déconnecte que LUI. Sans ceci, jest
    // reste ouvert et PostgreSQL accumule des sessions inactives.
    if (this.client !== null) await this.client.$disconnect();
  }

  /** L'état nommé, pour le log, la jauge et un futur `/readyz`. */
  currentState(): TenantScopeState {
    return this.state;
  }

  /** La raison NOMMÉE du refus, ou `null`. */
  currentRefusalReason(): string | null {
    return this.refusalReason;
  }

  /**
   * Le client sur lequel une portée doit s'ouvrir, ou `null` quand il faut se
   * rabattre sur le PROPRIÉTAIRE (mode dégradé assumé et nommé).
   *
   * Lève quand la seconde connexion est déclarée mais inutilisable. Il n'y a
   * PAS de troisième issue : ni drapeau, ni branche sur `NODE_ENV`, ni variable
   * d'échappement (DNC-10).
   */
  transactionRunnerOrNull(): TenantTransactionRunner<Prisma.TransactionClient> | null {
    if (this.state === 'refused_unusable') {
      throw new ServiceUnavailableException(
        'La portée tenant est refusée : DATABASE_URL_APP est déclarée mais la connexion n’a pas ' +
          'pu être qualifiée d’enforçante. Aucun repli sur la connexion du propriétaire n’est ' +
          'effectué. Corriger la configuration, pas le code.',
      );
    }
    if (this.state === 'degraded_no_app_url' || this.client === null) return null;
    return this.client as unknown as TenantTransactionRunner<Prisma.TransactionClient>;
  }
}

/** Le minimum qu'un client doit savoir faire pour être sondé. */
export interface AppRoleProbeClient {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * Interroge la connexion SUR ELLE-MÊME : qui elle est, ce qu'elle possède, ce
 * qu'elle peut.
 *
 * Le propriétaire n'est JAMAIS un littéral : il est lu au catalogue
 * (`pg_tables.tableowner`), donc un cluster dont le rôle propriétaire porte un
 * autre nom est correctement jugé au lieu d'être déclaré sain par accident.
 * Quand `calendar_event` n'existe pas, la première requête rend ZÉRO ligne et
 * le verdict refuse — un état inclassable n'est jamais un vert (DNC-08).
 *
 * `COALESCE(..., true)` sur `rolbypassrls` et sur l'appartenance est un défaut
 * FAIL-CLOSED : si le catalogue ne répond pas, on suppose le pire.
 *
 * Aucune valeur n'est interpolée : les deux textes SQL sont statiques, la liste
 * des tables et des privilèges est une clause `VALUES` littérale.
 */
export async function probeAppRole(client: AppRoleProbeClient): Promise<AppRoleProbe> {
  const identityRows = (await client.$queryRaw`
    SELECT
      current_user::text AS current_user_name,
      o.owner::text AS table_owner,
      COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), true) AS bypass_rls,
      COALESCE(pg_has_role(current_user, o.owner, 'USAGE'), true) AS member_of_owner
    FROM (
      SELECT tableowner AS owner
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'calendar_event'
    ) o
  `) as
    | {
        current_user_name?: unknown;
        table_owner?: unknown;
        bypass_rls?: unknown;
        member_of_owner?: unknown;
      }[]
    | undefined;

  const identity = Array.isArray(identityRows) ? identityRows[0] : undefined;
  if (identity === undefined) {
    return {
      currentUser: null,
      tableOwner: null,
      bypassRls: true,
      memberOfOwner: true,
      privileges: {},
    };
  }

  const privilegeRows = (await client.$queryRaw`
    SELECT
      c.relname::text AS table_name,
      p.priv::text AS privilege,
      has_table_privilege(current_user, c.oid, p.priv) AS held
    FROM (
      VALUES ('calendar_event'), ('enrollment'), ('class_section'), ('cycle'), ('grade_level')
    ) AS t(name)
    JOIN pg_class c ON c.relname = t.name
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
  `) as { table_name?: unknown; privilege?: unknown; held?: unknown }[] | undefined;

  const privileges: Record<string, boolean> = {};
  if (Array.isArray(privilegeRows)) {
    for (const row of privilegeRows) {
      if (typeof row.table_name !== 'string' || typeof row.privilege !== 'string') continue;
      privileges[privilegeKey(row.table_name, row.privilege)] = row.held === true;
    }
  }

  return {
    currentUser: typeof identity.current_user_name === 'string' ? identity.current_user_name : null,
    tableOwner: typeof identity.table_owner === 'string' ? identity.table_owner : null,
    bypassRls: identity.bypass_rls !== false,
    memberOfOwner: identity.member_of_owner !== false,
    privileges,
  };
}

/** Le NOM de l'erreur, jamais sa charge utile (elle peut porter une adresse). */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}
