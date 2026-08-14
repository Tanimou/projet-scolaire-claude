import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { TENANT_GUC } from '../prisma/prisma.service';

/**
 * S-E01-2b — LE GARDE HERMÉTIQUE de la migration RLS et de son vérificateur.
 *
 * DEUX GARDES, ET LA RAISON DE LA SÉPARATION
 * ------------------------------------------
 * `scripts/rls-isolation-check.js` fait la PREUVE : il construit une base
 * scratch, y applique le ledger, se connecte comme `app_user` et regarde les
 * lignes apparaître et disparaître selon le GUC. Il a besoin d'un PostgreSQL, il
 * échoue (jamais « skip ») quand il n'y en a pas, et il tourne dans `ci-gate.sh`
 * et `ci.yml`, pas dans jest.
 *
 * CE fichier est l'autre moitié : il tourne SANS base, dans `pnpm test`, sur
 * toute machine, et il assertit ce qu'un texte peut porter — la forme du
 * prédicat, le sens du cast, l'absence de `FORCE`, le garde `pg_roles`,
 * l'ensemble des 44 noms, le chemin de rollback, et la forme du vérificateur
 * lui-même. Les specs d'`apps/api` sont hermétiques par décision (ADR-039) et le
 * cliquet de skips est DÉSARMÉ dans ce dépôt : un spec jest qui exigerait une
 * base échouerait sur toute machine sans base, ou disparaîtrait dans un skip
 * toléré que personne ne relit. D'où cette répartition, qui est la convention
 * déjà établie par `schema-drift-check.js` / `schema-drift-gate.spec.ts`.
 *
 * CE QU'AUCUNE ASSERTION ICI NE DOIT LAISSER CROIRE
 * ------------------------------------------------
 * Que l'application est isolée par RLS. Elle ne l'est pas : elle se connecte
 * comme le PROPRIÉTAIRE des tables. Le dernier `describe` de ce fichier est un
 * cliquet sur cette phrase-là.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const API_PRISMA = join(REPO_ROOT, 'apps', 'api', 'prisma');
const SCHEMA_PATH = join(API_PRISMA, 'schema.prisma');
const MIGRATIONS_DIR = join(API_PRISMA, 'migrations');
const MIGRATION_DIR_NAME = '20260813120000_tenant_rls_policies';
const MIGRATION_PATH = join(MIGRATIONS_DIR, MIGRATION_DIR_NAME, 'migration.sql');
const CHECKER_PATH = join(REPO_ROOT, 'scripts', 'rls-isolation-check.js');

/**
 * S-E01-2c — la SECONDE migration, celle des tables tenant-DÉRIVÉES.
 *
 * Elle a son propre chemin et ses propres cliquets : `MIGRATION` ci-dessus est
 * épinglée PAR NOM sur `20260813120000_tenant_rls_policies`, que cette story ne
 * touche pas (une migration appliquée ne se réécrit pas — ni le ledger ni le
 * cliquet des 44 noms ne le supporteraient). Les deux fichiers sont donc lus
 * séparément, et aucune assertion de l'un ne peut passer grâce à l'autre.
 */
const DERIVED_MIGRATION_DIR_NAME = '20260813180000_tenant_rls_derived_policies';
const DERIVED_MIGRATION_PATH = join(MIGRATIONS_DIR, DERIVED_MIGRATION_DIR_NAME, 'migration.sql');

/**
 * S-E01-2d — la TROISIÈME migration, celle qui donne à `outbox_event` un
 * `tenant_id` DÉNORMALISÉ et le fait rejoindre le régime des tables
 * tenant-scopées (`ADR-044`, ferme `PF-185`).
 *
 * Elle a son propre chemin, comme les deux autres : une migration appliquée ne
 * se réécrit pas. Le cliquet des 44 noms reste épinglé sur `S-E01-2b`, et le
 * 45ᵉ nom est lu ICI — c'est ce qui rend l'accord d'AC-13 non vide sans toucher
 * à un fichier déjà joué.
 */
const OUTBOX_MIGRATION_DIR_NAME = '20260814120000_outbox_event_tenant_scope';
const OUTBOX_MIGRATION_PATH = join(MIGRATIONS_DIR, OUTBOX_MIGRATION_DIR_NAME, 'migration.sql');

/** La table que `S-E01-2d` fait passer du résidu aux tables tenant-scopées. */
const OUTBOX_TABLE = 'outbox_event';

/** Chemins NOMMÉS : lecture directe, échec au chargement s'ils manquent (TOOL-17b). */
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8');
const DERIVED_MIGRATION = readFileSync(DERIVED_MIGRATION_PATH, 'utf8');
const OUTBOX_MIGRATION = readFileSync(OUTBOX_MIGRATION_PATH, 'utf8');
const SCHEMA = readFileSync(SCHEMA_PATH, 'utf8');
const CHECKER = readFileSync(CHECKER_PATH, 'utf8');

/** Commentaires SQL retirés, longueur préservée — voir `prisma.service.spec.ts`. */
function executableSql(source: string): string {
  return source.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** Commentaires JS retirés, longueur préservée. */
function executableJs(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

const MIGRATION_CODE = executableSql(MIGRATION);
const DERIVED_MIGRATION_CODE = executableSql(DERIVED_MIGRATION);
const CHECKER_CODE = executableJs(CHECKER);
const OUTBOX_MIGRATION_CODE = executableSql(OUTBOX_MIGRATION);

/**
 * Le tableau littéral 5 × 4 de la migration dérivée : enfant, colonne FK,
 * parent, chaîne de privilèges.
 *
 * Extrait du SQL EXÉCUTABLE : les noms cités dans l'en-tête (les six exclues le
 * sont, nommément) ne doivent pas être comptés comme placés sous policy.
 */
function derivedTuple(): Array<{ child: string; fk: string; parent: string; privileges: string }> {
  const block = /derived\s+CONSTANT\s+text\[\]\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/.exec(DERIVED_MIGRATION_CODE);
  if (!block) return [];
  return [
    ...(block[1] ?? '').matchAll(/ARRAY\[\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g),
  ].map((m) => ({
    child: m[1] as string,
    fk: m[2] as string,
    parent: m[3] as string,
    privileges: m[4] as string,
  }));
}

/** Le jeu FERMÉ de chaînes de privilèges déclaré par la migration dérivée. */
function derivedAllowedPrivileges(): string[] {
  const block = /allowed_privileges\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/.exec(
    DERIVED_MIGRATION_CODE,
  );
  if (!block) return [];
  return [...(block[1] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1] as string);
}

/**
 * Les tables tenant-DÉRIVÉES selon `schema.prisma` : les modèles qui ne
 * déclarent PAS `tenantId String` et qui portent le côté PROPRIÉTAIRE d'une
 * relation (`@relation(fields: […])`) vers un modèle qui, lui, le déclare.
 *
 * C'est la même dérivation que celle que `rls-isolation-check.js` calcule sur
 * `pg_constraint`, mais lue depuis la source — donc HERMÉTIQUE (ADR-039) : un
 * sixième modèle dérivé livré sans ligne dans le tuple échoue ICI, sur toute
 * machine, sans base de données.
 */
function schemaDerivedTables(): string[] {
  const models = new Map<string, { table: string; body: string; hasTenant: boolean }>();
  const pattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(SCHEMA)) !== null) {
    const name = match[1] as string;
    const body = match[2] ?? '';
    const mapped = /@@map\("([^"]+)"\)/.exec(body);
    models.set(name, {
      table: mapped ? (mapped[1] as string) : name,
      body,
      hasTenant: /^\s*tenantId\s+String/m.test(body),
    });
  }
  const derived: string[] = [];
  for (const [, model] of models) {
    if (model.hasTenant) continue;
    // Le côté PROPRIÉTAIRE de la relation seulement : la liste inverse portée
    // par le parent n'a pas de `@relation(fields: …)`, donc elle ne compte pas.
    const parents = [...model.body.matchAll(/^\s*\w+\s+(\w+)\??\s+@relation\(\s*fields:/gm)].map(
      (m) => m[1] as string,
    );
    if (parents.some((parent) => models.get(parent)?.hasTenant)) derived.push(model.table);
  }
  return derived.sort();
}

const DERIVED_TUPLE = derivedTuple();
const DERIVED_ALLOWED_PRIVILEGES = derivedAllowedPrivileges();
const SCHEMA_DERIVED_TABLES = schemaDerivedTables();

/**
 * AC-5b — le RÉSIDU : les tables sans `tenant_id` que la dérivation n'atteint
 * pas. NOMMÉES, chacune avec sa raison, jamais globbées, et jamais dans un
 * ensemble qui SOUSTRAIT du compte de policies attendu.
 */
const NON_DERIVED_EXPECTED = [
  '_prisma_migrations', // le ledger de migrations — pas de la donnée de tenant
  'permission', // donnée de référence par conception (ADR-015)
  'role', // idem
  'role_permission', // idem
  'tenant', // AUTO-DISCRIMINANTE : sa clé primaire EST le discriminant
];
// `outbox_event` a QUITTÉ ce résidu en `S-E01-2d`. Pas parce qu'un nom a été
// effacé : parce qu'elle porte désormais `tenant_id`, donc la dérivation ne la
// rend plus. Le vérificateur mesure la même chose sur le catalogue, dans les
// DEUX sens ; retirer le nom sans livrer la colonne échouerait là-bas avec le
// nom imprimé. Elle n'est PAS devenue dérivable — elle est devenue scopée.

/**
 * Les noms de tables du tableau littéral de la migration.
 *
 * Extraits du SQL EXÉCUTABLE : un nom cité dans l'en-tête (les 11 exclues le
 * sont) ne doit pas être compté comme placé sous policy.
 */
function sqlArrayNames(constant: string): string[] {
  const block = new RegExp(`${constant}\\s+CONSTANT\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]\\s*;`).exec(
    MIGRATION_CODE,
  );
  if (!block) return [];
  return [...(block[1] ?? '').matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1] as string);
}

function migrationTableNames(): string[] {
  return sqlArrayNames('tenant_scoped');
}

/**
 * Les tables tenant-scopées selon `schema.prisma` : le nom `@@map` de chaque
 * modèle déclarant `tenantId String`.
 */
function schemaTenantTables(): { withTenant: string[]; withoutTenant: string[] } {
  const withTenant: string[] = [];
  const withoutTenant: string[] = [];
  const models = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = models.exec(SCHEMA)) !== null) {
    const name = match[1] as string;
    const body = match[2] ?? '';
    const mapped = /@@map\("([^"]+)"\)/.exec(body);
    const table = mapped ? (mapped[1] as string) : name;
    if (/^\s*tenantId\s+String/m.test(body)) withTenant.push(table);
    else withoutTenant.push(table);
  }
  return { withTenant: withTenant.sort(), withoutTenant: withoutTenant.sort() };
}

const MIGRATION_TABLES = migrationTableNames();
/** Le sous-ensemble qui ne reçoit que `SELECT, INSERT` (ADR-032 §D7). */
const APPEND_ONLY = sqlArrayNames('append_only');
const { withTenant: SCHEMA_TENANT_TABLES, withoutTenant: SCHEMA_GLOBAL_TABLES } = schemaTenantTables();

/**
 * S-E01-2d — la table que la TROISIÈME migration place sous policy, lue depuis
 * son SQL EXÉCUTABLE (`target CONSTANT text := '…'`), jamais depuis son en-tête.
 *
 * Un tableau, pas une chaîne : le jour où cette migration en couvrira deux,
 * l'union ci-dessous continue de fonctionner sans réécriture.
 */
function outboxMigrationTableNames(): string[] {
  const block = /target\s+CONSTANT\s+text\s*:=\s*'([a-z0-9_]+)'\s*;/.exec(OUTBOX_MIGRATION_CODE);
  return block ? [block[1] as string] : [];
}

const OUTBOX_MIGRATION_TABLES = outboxMigrationTableNames();

/** Le jeu FERMÉ de chaînes de privilèges déclaré par la migration `outbox`. */
function outboxAllowedPrivileges(): string[] {
  const block = /allowed_privileges\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/.exec(
    OUTBOX_MIGRATION_CODE,
  );
  if (!block) return [];
  return [...(block[1] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1] as string);
}

const OUTBOX_ALLOWED_PRIVILEGES = outboxAllowedPrivileges();

/**
 * L'ensemble des tables tenant-SCOPÉES réellement placées sous policy par le
 * ledger : les 44 de `S-E01-2b` PLUS celle de `S-E01-2d`.
 *
 * C'est ce total — jamais le seul tableau des 44 — qui doit égaler ce que
 * `schema.prisma` déclare. Épingler l'accord sur un seul fichier ferait rougir
 * la story suivante pour avoir fait exactement ce qu'on lui demandait, et la
 * réponse tentante serait alors de relâcher l'assertion.
 */
const POLICIED_TENANT_TABLES = [...MIGRATION_TABLES, ...OUTBOX_MIGRATION_TABLES].sort();

describe('AC-1 — la migration existe, est RELUE À LA MAIN, et sa répétition seule est factorisée', () => {
  it('elle est au chemin attendu, dans le répertoire de migrations du ledger', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
    expect(readdirSync(MIGRATIONS_DIR)).toContain(MIGRATION_DIR_NAME);
  });

  it('elle n’a pas été produite par `db push`, et le dit', () => {
    // G-MIGRATION exige une migration RELUE. `db push` ne laisse pas de fichier,
    // donc l'absence de la chaîne est le seul témoin textuel disponible ; il est
    // faible seul, et c'est pourquoi l'en-tête l'énonce explicitement.
    expect(MIGRATION_CODE).not.toContain('db push');
    expect(MIGRATION).toContain('RELUE À LA MAIN');
  });

  it('les NOMS sont littéraux et diffables ; seule la boucle est factorisée', () => {
    // Une migration qui découvrirait ses tables depuis `information_schema` aurait
    // un effet dépendant de la base où elle atterrit — irrelisable, et non
    // déterministe sur les bases scratch du garde de dérive.
    expect(MIGRATION_CODE).not.toMatch(/from\s+information_schema/i);
    expect(MIGRATION_CODE).toMatch(/FOREACH\s+t\s+IN\s+ARRAY\s+tenant_scoped/);
    expect(MIGRATION_CODE).toContain("format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t)");
  });

  it('elle est RE-JOUABLE : chaque CREATE POLICY est précédé d’un DROP … IF EXISTS', () => {
    // `CREATE POLICY` n'a pas d'`IF NOT EXISTS` en PG 15 : sans le DROP, une
    // application partielle ne peut pas être relancée.
    expect(MIGRATION_CODE).toContain("DROP POLICY IF EXISTS tenant_isolation ON public.%I");
    const dropAt = MIGRATION_CODE.indexOf('DROP POLICY IF EXISTS tenant_isolation');
    const createAt = MIGRATION_CODE.indexOf('CREATE POLICY tenant_isolation');
    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
  });

  it('une table absente FAIT ÉCHOUER la migration au lieu d’être sautée', () => {
    // Sauter reviendrait à livrer une policy manquante avec un `migrate deploy`
    // vert — la forme exacte du défaut que cette story existe pour refermer.
    expect(MIGRATION_CODE).toMatch(/to_regclass\(format\('public\.%I', t\)\) IS NULL/);
    expect(MIGRATION_CODE).toMatch(/RAISE EXCEPTION/);
  });
});

describe('AC-2/AC-3/AC-4 — le prédicat, et les trois façons de l’écrire faux', () => {
  it('il caste en uuid, avec missing_ok ET nullif, à l’identique en USING et WITH CHECK', () => {
    const predicate = `nullif(current_setting('${TENANT_GUC}', true), '')::uuid = tenant_id`;
    // Deux occurrences : USING et WITH CHECK. Les compter interdit d'en écrire une
    // et d'oublier l'autre — cas où PostgreSQL retombe silencieusement sur USING.
    const occurrences = MIGRATION_CODE.split(predicate).length - 1;
    expect(occurrences).toBe(2);
    expect(MIGRATION_CODE).toContain('USING (');
    expect(MIGRATION_CODE).toContain('WITH CHECK (');
  });

  it('le second argument de current_setting (missing_ok) n’est jamais omis', () => {
    // Sans lui, toute connexion n'ayant jamais posé le GUC lève 42704 : migrations,
    // seeds, health checks et chaque job BullMQ cassent dès le premier jour.
    for (const call of MIGRATION_CODE.match(/current_setting\([^)]*\)/g) ?? []) {
      expect(call).toContain(', true)');
    }
  });

  it('le `nullif` est présent partout où `current_setting` est casté (F-1, mesuré)', () => {
    // APRÈS le COMMIT d'un `set_config(…, true)`, le GUC vaut `''` et NON NULL :
    // un cast nu lèverait 22P02 sur la DEUXIÈME requête de chaque connexion du
    // pool. Prisma mutualise ses connexions, donc c'est l'état de RÉGIME.
    const bareCast = new RegExp(`current_setting\\('${TENANT_GUC.replace(/\./g, '\\.')}',\\s*true\\)\\s*::\\s*uuid`);
    expect(MIGRATION_CODE).not.toMatch(bareCast);
  });

  it('il ne compare jamais en texte, dans aucun sens (AC-3)', () => {
    expect(MIGRATION_CODE).not.toMatch(/tenant_id\s*::\s*text/i);
    expect(MIGRATION_CODE).not.toMatch(/::\s*text\s*=\s*tenant_id/i);
  });

  it('il n’écrit JAMAIS la forme fail-open `IS NULL OR` (DNC-10)', () => {
    expect(MIGRATION_CODE).not.toMatch(/IS\s+NULL\s+OR/i);
    expect(MIGRATION_CODE).not.toMatch(/\bOR\s+true\b/i);
  });

  it('la policy est FOR ALL TO PUBLIC, jamais nominative', () => {
    // `TO app_user` exempterait en silence tout AUTRE rôle non-propriétaire.
    expect(MIGRATION_CODE).toMatch(/FOR\s+ALL\s+TO\s+PUBLIC/);
    expect(MIGRATION_CODE).not.toMatch(/CREATE POLICY[\s\S]{0,200}TO\s+app_user/);
  });
});

describe('AC-5 — les GRANTs portent sur les 44, et survivent à un cluster sans le rôle', () => {
  it('ils ne sont jamais `ON ALL TABLES IN SCHEMA public`', () => {
    // Cette forme donnerait à `app_user` les tables SANS policy — un accès non
    // filtré offert par le geste même qui prétend restreindre.
    expect(MIGRATION_CODE).not.toMatch(/ON\s+ALL\s+TABLES\s+IN\s+SCHEMA/i);
    expect(MIGRATION_CODE).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO app_user");
  });

  it('ils sont gardés par `pg_roles`, mais la moitié SÉCURITÉ reste inconditionnelle', () => {
    expect(MIGRATION_CODE).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM pg_roles WHERE rolname = 'app_user'\s*\)/);
    expect(MIGRATION_CODE).toMatch(/IF has_app_user THEN/);
    // La preuve que la garde n'enveloppe PAS l'ENABLE : l'ENABLE apparaît AVANT le
    // premier `IF has_app_user THEN` du corps de la boucle.
    const enableAt = MIGRATION_CODE.indexOf('ENABLE ROW LEVEL SECURITY');
    const guardAt = MIGRATION_CODE.indexOf('IF has_app_user THEN');
    expect(enableAt).toBeGreaterThan(-1);
    expect(enableAt).toBeLessThan(guardAt);
  });

  it('DEUX jeux de privilèges : les tables APPEND-ONLY ne reçoivent JAMAIS UPDATE ni DELETE', () => {
    // Un GRANT uniforme donnerait UPDATE/DELETE sur `audit_log` au rôle que
    // l'application s'apprête à utiliser. `prev_hash` serait réinscriptible, donc
    // une falsification pourrait être rendue COHÉRENTE — indétectable par
    // vérification de chaîne. L'audit append-only est non négociable
    // (GUARDRAILS §1). `GRANTED == tenantCols` ne voit RIEN de tout ça : le
    // nombre de tables est identique dans les deux cas.
    expect(MIGRATION_CODE).toContain("GRANT SELECT, INSERT ON public.%I TO app_user");
    expect(MIGRATION_CODE).toMatch(/IF\s+t\s*=\s*ANY\s*\(append_only\)\s*THEN/);

    // La branche restrictive vient AVANT la branche DML : un `ELSE` perdu par une
    // résolution de conflit retire des privilèges au lieu d'en ajouter.
    const restrictiveAt = MIGRATION_CODE.indexOf("GRANT SELECT, INSERT ON public.%I TO app_user");
    const fullDmlAt = MIGRATION_CODE.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO app_user');
    expect(restrictiveAt).toBeGreaterThan(-1);
    expect(fullDmlAt).toBeGreaterThan(restrictiveAt);
  });

  it('le jeu APPEND-ONLY est nommé, sous-ensemble des 44, et ne peut pas s’élargir en silence', () => {
    expect(APPEND_ONLY).toEqual(['audit_log', 'conversation_message']);
    // Sous-ensemble strict des 44 : une table append-only hors `tenant_scoped` ne
    // recevrait AUCUN grant — l'exemption serait muette au lieu d'être
    // restrictive. La migration REFUSE de s'appliquer dans ce cas.
    for (const table of APPEND_ONLY) expect(MIGRATION_TABLES).toContain(table);
    expect(MIGRATION_CODE).toMatch(/NOT\s*\(\s*t\s*=\s*ANY\s*\(tenant_scoped\)\s*\)/);
    expect(MIGRATION_CODE).toMatch(/append-only public\.% est absente de tenant_scoped/);

    // La direction qui serait une PANNE, pas un durcissement : `conversation_report`
    // porte `status`/`reviewed_by`/`reviewed_at` — la modération la fait MUTER.
    expect(APPEND_ONLY).not.toContain('conversation_report');
    expect(MIGRATION).toContain("`conversation_report` n'est PAS dans ce jeu");
  });

  it('le vérificateur assertit la même coupure, dans les DEUX directions', () => {
    // Le sens « aucun privilège au-delà de SELECT/INSERT » est vert à vide si le
    // GRANT n'a jamais atterri. Le plancher d'atteignabilité vient donc d'abord.
    expect(CHECKER_CODE).toContain('APPEND_ONLY_REACHED');
    expect(CHECKER_CODE).toContain('APPEND_ONLY_WRITE');
    expect(CHECKER_CODE).toContain("privilege_type NOT IN ('SELECT', 'INSERT')");
    for (const table of APPEND_ONLY) expect(CHECKER_CODE).toContain(`'${table}'`);
  });

  it('le schéma est accordé nominativement, et aucune séquence ne l’est', () => {
    // Mesuré : zéro séquence dans `public` (clés primaires en uuid), donc
    // « l'accès aux séquences dont il a besoin » se résout à RIEN.
    expect(MIGRATION_CODE).toContain('GRANT USAGE ON SCHEMA public TO app_user');
    expect(MIGRATION_CODE).not.toMatch(/GRANT[^;]*ON\s+(ALL\s+)?SEQUENCE/i);
  });
});

describe('AC-13 — les noms tenant-scopés ne peuvent pas dériver de `schema.prisma`', () => {
  it('les deux ensembles sont NON VIDES avant toute comparaison', () => {
    // Deux listes vides sont « égales ». Le plancher vient en premier.
    //
    // 44 + 1 : le tableau de `S-E01-2b` reste figé à 44 (une migration appliquée
    // ne se réécrit pas) et `S-E01-2d` en ajoute UN — `outbox_event` — dans SA
    // migration. C'est l'UNION qui doit égaler `schema.prisma`, jamais le seul
    // tableau des 44 : le comparer seul rendrait la story `S-E01-2d` rouge alors
    // qu'elle est exactement ce que l'assertion demandait.
    expect(MIGRATION_TABLES.length).toBe(44);
    expect(new Set(MIGRATION_TABLES).size).toBe(44);
    expect(OUTBOX_MIGRATION_TABLES).toEqual([OUTBOX_TABLE]);
    expect(SCHEMA_TENANT_TABLES.length).toBe(45);
    expect(new Set(POLICIED_TENANT_TABLES).size).toBe(45);
  });

  it('ÉGALITÉ D’ENSEMBLES dans les DEUX sens', () => {
    // Un seul sens laisserait passer la moitié dangereuse : un 46e modèle
    // tenant-scopé livré sans policy. Le garde de dérive de schéma ne peut PAS le
    // voir — `migrate diff` ignore les policies — donc c'est ici ou nulle part.
    const inSchemaNotInMigration = SCHEMA_TENANT_TABLES.filter((t) => !POLICIED_TENANT_TABLES.includes(t));
    const inMigrationNotInSchema = POLICIED_TENANT_TABLES.filter((t) => !SCHEMA_TENANT_TABLES.includes(t));
    expect(inSchemaNotInMigration).toEqual([]);
    expect(inMigrationNotInSchema).toEqual([]);
  });

  it('les tables SANS `tenant_id` sont nommées et classées dans l’en-tête', () => {
    // Écrire « RLS est activé » sans nommer celles-ci serait la surclamation PF-02
    // répétée un cran plus bas. Les CINQ DÉRIVÉES sont le résidu de cette story.
    //
    // `outbox_event` a quitté cette liste en `S-E01-2d` : elle porte désormais
    // `tenant_id`, donc `SCHEMA_GLOBAL_TABLES` ne la contient plus et la première
    // assertion de la boucle échouerait — correctement — si on l'y laissait.
    const derived = [
      'grade_revision',
      'announcement_receipt',
      'branding',
      'import_row',
      'user_role',
    ];
    for (const table of derived) {
      expect(SCHEMA_GLOBAL_TABLES.concat('_prisma_migrations')).toContain(table);
      expect(MIGRATION).toContain(table);
      expect(MIGRATION_TABLES).not.toContain(table);
    }
    // …et la sixième d'hier est passée de l'autre côté, ce qui s'assertit dans
    // les deux sens pour qu'un renommage silencieux ne puisse pas la faire
    // disparaître des deux listes à la fois.
    expect(SCHEMA_GLOBAL_TABLES).not.toContain(OUTBOX_TABLE);
    expect(SCHEMA_TENANT_TABLES).toContain(OUTBOX_TABLE);
    expect(MIGRATION_TABLES).not.toContain(OUTBOX_TABLE);
    expect(POLICIED_TENANT_TABLES).toContain(OUTBOX_TABLE);
    // `tenant` est exclue DÉLIBÉRÉMENT : la couture identité doit la lire PAR SLUG
    // avant qu'un tenant soit résolu.
    expect(MIGRATION_TABLES).not.toContain('tenant');
    expect(MIGRATION).toContain('AUTO-DISCRIMINANTE');
  });
});

describe('S-E01-2c AC-1 — la migration DÉRIVÉE existe, relue à la main, et ne réécrit pas sa sœur', () => {
  it('elle est à son chemin nommé, dans le répertoire de migrations du ledger', () => {
    expect(existsSync(DERIVED_MIGRATION_PATH)).toBe(true);
    expect(readdirSync(MIGRATIONS_DIR)).toContain(DERIVED_MIGRATION_DIR_NAME);
    // Et elle ne remplace PAS celle des 44 : une migration appliquée ne se
    // réécrit pas, ni le ledger ni le cliquet des 44 noms ne le supporteraient.
    expect(readdirSync(MIGRATIONS_DIR)).toContain(MIGRATION_DIR_NAME);
    expect(DERIVED_MIGRATION_PATH).not.toEqual(MIGRATION_PATH);
  });

  it('elle n’a été produite ni par `db push` ni par `migrate dev`, et le dit', () => {
    expect(DERIVED_MIGRATION_CODE).not.toContain('db push');
    expect(DERIVED_MIGRATION_CODE).not.toContain('migrate dev');
    expect(DERIVED_MIGRATION).toContain('RELUE À LA MAIN');
  });

  it('les NOMS sont littéraux et diffables ; seule la boucle est factorisée', () => {
    // Une migration qui découvrirait ses tables depuis `information_schema`
    // aurait un effet dépendant de la base où elle atterrit : irrelisable, et
    // non déterministe sur les bases scratch des gardes.
    expect(DERIVED_MIGRATION_CODE).not.toMatch(/from\s+information_schema/i);
    expect(DERIVED_MIGRATION_CODE).toMatch(/FOR\s+i\s+IN\s+1\s*\.\.\s*array_length\(derived,\s*1\)/);
  });

  it('elle est RE-JOUABLE : chaque CREATE POLICY est précédé d’un DROP … IF EXISTS', () => {
    expect(DERIVED_MIGRATION_CODE).toContain('DROP POLICY IF EXISTS tenant_isolation ON public.%I');
    const dropAt = DERIVED_MIGRATION_CODE.indexOf('DROP POLICY IF EXISTS tenant_isolation');
    const createAt = DERIVED_MIGRATION_CODE.indexOf('CREATE POLICY tenant_isolation');
    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
  });

  it('elle REFUSE de s’appliquer plutôt que de SAUTER une ligne', () => {
    // Sauter livrerait une policy manquante sous un `migrate deploy` VERT — la
    // forme exacte du défaut que cette story referme.
    for (const guard of [
      /array_length\(derived, 1\) IS DISTINCT FROM expected/,
      /la table enfant public\.% est introuvable/,
      /la table parente public\.% est introuvable/,
      /ne porte pas la colonne/,
      /ne porte pas de colonne tenant_id/,
      /hors du jeu fermé/,
      /aucun index ne mène par/,
    ]) {
      expect(DERIVED_MIGRATION_CODE).toMatch(guard);
    }
    // Sept refus, sept `RAISE EXCEPTION` — jamais un `CONTINUE`.
    expect(DERIVED_MIGRATION_CODE).not.toMatch(/\bCONTINUE\b/);
  });

  it('elle borne l’attente du verrou et dit la posture de reprise', () => {
    // `ENABLE ROW LEVEL SECURITY` prend un ACCESS EXCLUSIVE : catalogue seul,
    // donc immédiat — mais il fait la queue derrière un lecteur long et bloque
    // alors tous les lecteurs suivants.
    expect(DERIVED_MIGRATION_CODE).toMatch(/SET\s+lock_timeout\s*=\s*'5s'/);
    expect(DERIVED_MIGRATION).toContain('Posture de reprise');
  });

  it('elle CITE ADR-042 et ADR-032 au lieu de prendre la décision en commentaire', () => {
    // Un commentaire de migration ne peut pas supersédér une décision de record.
    expect(DERIVED_MIGRATION).toContain('ADR-042');
    expect(DERIVED_MIGRATION).toContain('ADR-032');
    expect(existsSync(join(REPO_ROOT, 'docs', 'adr', 'ADR-042-fk-path-tenant-isolation.md'))).toBe(true);
  });
});

describe('S-E01-2c AC-2 — le prédicat à chemin FK, et les façons de l’écrire faux', () => {
  it('c’est une forme EXISTS sur le parent, avec missing_ok ET nullif', () => {
    expect(DERIVED_MIGRATION_CODE).toMatch(/EXISTS\s*\(\s*SELECT 1/);
    expect(DERIVED_MIGRATION_CODE).toContain(
      `p.tenant_id = nullif(current_setting('${TENANT_GUC}', true), '')::uuid`,
    );
    expect(DERIVED_MIGRATION_CODE).toMatch(/p\.id = %I\.%I/);
  });

  it('USING et WITH CHECK sont identiques PAR CONSTRUCTION, pas par relecture', () => {
    // La même variable `predicate` est injectée deux fois dans le même
    // `format()`. Il n'y a donc pas deux textes à maintenir en accord — et le
    // vérificateur assertit en plus l'égalité des DEUX expressions désérialisées
    // (`QUAL_MISMATCH`), ce que `WITH_CHECK_NULL` seul ne voit pas.
    expect(DERIVED_MIGRATION_CODE).toContain('USING (%s) WITH CHECK (%s)');
    expect(DERIVED_MIGRATION_CODE).toMatch(/child, predicate, predicate\)/);
    expect(CHECKER_CODE).toContain('QUAL_MISMATCH');
    expect(CHECKER_CODE).toContain('IS DISTINCT FROM pg_get_expr(p.polwithcheck, p.polrelid)');
  });

  it('le second argument de current_setting (missing_ok) n’est jamais omis', () => {
    for (const call of DERIVED_MIGRATION_CODE.match(/current_setting\([^)]*\)/g) ?? []) {
      expect(call).toContain(', true)');
    }
  });

  it('le `nullif` n’est jamais retiré au profit d’un cast nu (F-1, mesuré)', () => {
    // Après le COMMIT d'un `set_config(…, true)` le GUC vaut `''` et NON NULL :
    // un cast nu lèverait 22P02 à la DEUXIÈME requête de chaque connexion du
    // pool, et sur l'ENFANT seulement — que l'assertion `school` ne voit pas.
    const bareCast = new RegExp(
      `current_setting\\('${TENANT_GUC.replace(/\./g, '\\.')}',\\s*true\\)\\s*::\\s*uuid`,
    );
    expect(DERIVED_MIGRATION_CODE).not.toMatch(bareCast);
    expect(CHECKER_CODE).toContain('POOLED_D');
  });

  it('il ne compare jamais en texte, dans aucun sens', () => {
    expect(DERIVED_MIGRATION_CODE).not.toMatch(/tenant_id\s*::\s*text/i);
    expect(DERIVED_MIGRATION_CODE).not.toMatch(/::\s*text\s*=\s*.*tenant_id/i);
  });

  it('il n’écrit JAMAIS la forme fail-open `IS NULL OR` (DNC-10)', () => {
    expect(DERIVED_MIGRATION_CODE).not.toMatch(/IS\s+NULL\s+OR/i);
    expect(DERIVED_MIGRATION_CODE).not.toMatch(/\bOR\s+true\b/i);
  });

  it('la policy porte le MÊME NOM que les 44, et reste FOR ALL TO PUBLIC', () => {
    // Le recensement compte PAR NOM : un autre nom sortirait les cinq du compte.
    expect(DERIVED_MIGRATION_CODE).toContain('CREATE POLICY tenant_isolation ON public.%I');
    expect(DERIVED_MIGRATION_CODE).toMatch(/FOR\s+ALL\s+TO\s+PUBLIC/);
    expect(DERIVED_MIGRATION_CODE).not.toMatch(/CREATE POLICY[\s\S]{0,200}TO\s+app_user/);
  });

  it('et la moitié SÉCURITÉ reste inconditionnelle, seuls les GRANTs sont gardés', () => {
    expect(DERIVED_MIGRATION_CODE).toMatch(
      /EXISTS\s*\(\s*SELECT 1 FROM pg_roles WHERE rolname = 'app_user'\s*\)/,
    );
    const enableAt = DERIVED_MIGRATION_CODE.indexOf('ENABLE ROW LEVEL SECURITY');
    const guardAt = DERIVED_MIGRATION_CODE.indexOf('IF has_app_user THEN');
    expect(enableAt).toBeGreaterThan(-1);
    expect(enableAt).toBeLessThan(guardAt);
  });
});

describe('S-E01-2c AC-4 — cinq lignes, quatre littéraux, et un jeu de privilèges FERMÉ', () => {
  it('le tuple est NON VIDE et porte exactement cinq lignes de quatre littéraux', () => {
    // Deux listes vides sont « égales ». Le plancher vient en premier.
    expect(DERIVED_TUPLE.length).toBe(5);
    expect(new Set(DERIVED_TUPLE.map((r) => r.child)).size).toBe(5);
    for (const row of DERIVED_TUPLE) {
      expect(row.child).not.toBe('');
      expect(row.fk).not.toBe('');
      expect(row.parent).not.toBe('');
      expect(row.privileges).not.toBe('');
    }
  });

  it('chaque chemin FK nommé est celui qui a été MESURÉ sur le catalogue', () => {
    // Une transposition de tuple est une lecture inter-tenant entièrement verte
    // du point de vue du recensement, qui ne lit jamais le prédicat.
    expect(
      DERIVED_TUPLE.map((r) => `${r.child}.${r.fk} -> ${r.parent}`).sort(),
    ).toEqual([
      'announcement_receipt.announcement_id -> announcement',
      'branding.school_id -> school',
      'grade_revision.grade_id -> grade',
      'import_row.batch_id -> import_batch',
      'user_role.user_profile_id -> user_profile',
    ]);
  });

  it('`user_role` passe par `user_profile_id`, JAMAIS par `role_id`', () => {
    // `role` ne porte pas de `tenant_id` : ce chemin est une impasse (ADR-042
    // §D2). Une policy routée par lui n'aurait rien à comparer.
    const userRole = DERIVED_TUPLE.find((r) => r.child === 'user_role');
    expect(userRole?.fk).toBe('user_profile_id');
    expect(userRole?.parent).toBe('user_profile');
    expect(DERIVED_TUPLE.some((r) => r.parent === 'role')).toBe(false);
  });

  it('les chaînes de privilèges viennent d’un jeu FERMÉ, et AUCUNE ne porte DELETE', () => {
    expect(DERIVED_ALLOWED_PRIVILEGES).toEqual(['SELECT, INSERT', 'SELECT, INSERT, UPDATE']);
    for (const row of DERIVED_TUPLE) expect(DERIVED_ALLOWED_PRIVILEGES).toContain(row.privileges);
    // ADR-042 §D5, sur MESURE : aucun appelant `delete`/`deleteMany` n'existe
    // pour l'une des cinq dans `apps/**` ni `packages/**`. Un privilège sans
    // appelant est du rayon de souffle pur (ADR-032 §D7).
    for (const row of DERIVED_TUPLE) expect(row.privileges).not.toContain('DELETE');
    expect(DERIVED_ALLOWED_PRIVILEGES.join(' ')).not.toContain('DELETE');
  });

  it('`grade_revision` est APPEND-ONLY, asserté PAR NOM (G-AUDIT)', () => {
    // Elle EST la piste d'audit des notes, et elle est PLUS exposée
    // qu'`audit_log` : celle-ci porte une chaîne hash/prev_hash qui rend une
    // réécriture détectable, `grade_revision` n'a rien de tel.
    expect(DERIVED_TUPLE.find((r) => r.child === 'grade_revision')?.privileges).toBe('SELECT, INSERT');
    expect(CHECKER_CODE).toContain('GRADE_REVISION_WRITE');
    expect(CHECKER_CODE).toContain("privilege_type NOT IN ('SELECT', 'INSERT')");
  });

  it('`user_role` ne porte JAMAIS DELETE, asserté PAR NOM', () => {
    // La révocation est un SOFT DELETE (`updateMany` posant `revoked_at`) : un
    // DELETE dur effacerait l'historique qu'audite l'échelle ADR-040.
    const userRole = DERIVED_TUPLE.find((r) => r.child === 'user_role');
    expect(userRole?.privileges).toBe('SELECT, INSERT, UPDATE');
    expect(userRole?.privileges).not.toContain('DELETE');
  });

  it('les GRANTs ne sont jamais `ON ALL TABLES IN SCHEMA public`, et aucune séquence', () => {
    // Cette forme donnerait aussi les six tables SANS policy — un accès non
    // filtré offert par le geste même qui prétend restreindre.
    expect(DERIVED_MIGRATION_CODE).not.toMatch(/ON\s+ALL\s+TABLES\s+IN\s+SCHEMA/i);
    expect(DERIVED_MIGRATION_CODE).toContain("GRANT %s ON public.%I TO app_user");
    expect(DERIVED_MIGRATION_CODE).not.toMatch(/GRANT[^;]*ON\s+(ALL\s+)?SEQUENCE/i);
    // `GRANT USAGE ON SCHEMA public` a déjà été émis nominativement par la
    // migration des 44 : le ré-émettre serait une seconde source de vérité.
    expect(DERIVED_MIGRATION_CODE).not.toContain('GRANT USAGE ON SCHEMA public');
  });
});

describe('S-E01-2c AC-12 — le tuple ne peut pas dériver de `schema.prisma`', () => {
  it('les deux ensembles sont NON VIDES avant toute comparaison', () => {
    expect(SCHEMA_DERIVED_TABLES.length).toBe(5);
    expect(DERIVED_TUPLE.length).toBe(5);
  });

  it('ÉGALITÉ D’ENSEMBLES dans les DEUX sens avec ce que `schema.prisma` implique', () => {
    // Un seul sens laisserait passer la moitié dangereuse : un sixième modèle
    // dérivé livré sans policy. `prisma migrate diff` ne voit pas les policies,
    // donc c'est ici — et dans le recensement exécuté — ou nulle part.
    const children = DERIVED_TUPLE.map((r) => r.child).sort();
    expect(SCHEMA_DERIVED_TABLES.filter((t) => !children.includes(t))).toEqual([]);
    expect(children.filter((t) => !SCHEMA_DERIVED_TABLES.includes(t))).toEqual([]);
  });

  it('le RÉSIDU est NOMMÉ, et aucune de ses cinq tables n’est sous policy', () => {
    // AC-5b : la dérivation est d'UN SEUL niveau. Une future table sans
    // `tenant_id` dont la FK pointerait vers une table DÉRIVÉE tomberait hors
    // des deux comptes. Nommer le résidu transforme ce trou en échec.
    const children = DERIVED_TUPLE.map((r) => r.child);
    for (const table of NON_DERIVED_EXPECTED) {
      expect(children).not.toContain(table);
      expect(POLICIED_TENANT_TABLES).not.toContain(table);
    }
    // Le RÉSIDU N'EST PAS UN ENSEMBLE D'EXEMPTION : `outbox_event` en est sortie
    // en livrant une colonne, pas en perdant une ligne de liste. La direction
    // interdite s'assertit donc explicitement — sortir du résidu SANS être placée
    // sous policy serait exactement la table invisible que ce garde existe pour
    // attraper.
    expect(NON_DERIVED_EXPECTED).not.toContain(OUTBOX_TABLE);
    expect(POLICIED_TENANT_TABLES).toContain(OUTBOX_TABLE);
  });

  it('`S-E01-2c` NOMMAIT `outbox_event` avec sa raison — état daté, conservé, pas relu comme courant', () => {
    // Ces trois assertions portent sur un fichier DÉJÀ JOUÉ : elles restent
    // vraies et ne doivent pas être supprimées (une migration appliquée ne se
    // réécrit pas). Ce qu'elles ne disent plus, c'est l'état COURANT : le
    // déféré de `ADR-042 §D7` a été levé par `S-E01-2d` / `ADR-044`, et c'est
    // la migration suivante qui porte l'état vrai.
    expect(DERIVED_MIGRATION).toContain('outbox_event');
    expect(DERIVED_MIGRATION).toContain('PF-185');
    expect(DERIVED_MIGRATION).toContain('ZÉRO clé étrangère');
    // …et le fait que ce soit un état DATÉ est lui-même vérifiable : la
    // troisième migration existe et lève le déféré par son nom.
    expect(OUTBOX_MIGRATION).toContain('PF-185');
    expect(OUTBOX_MIGRATION).toContain('ADR-042 §D7');
  });

  it('`schema.prisma` n’est PAS touché par la story `S-E01-2c`, et sa migration le dit', () => {
    // Y toucher AURAIT armé le piège `prisma generate` (typecheck ROUGE tant que
    // le client n'est pas régénéré) pour un fichier que le diff de dérive ne peut
    // de toute façon pas voir. Les policies et les GRANTs ne sont pas
    // modélisables en Prisma — c'était vrai de `S-E01-2c`, et ça l'est toujours.
    //
    // `S-E01-2d`, elle, TOUCHE `schema.prisma` : une COLONNE et une CLÉ
    // ÉTRANGÈRE, que Prisma modélise et que le garde de dérive VOIT. Le piège est
    // donc bien armé pour cette story-là, et refermé dans le même diff par
    // `prisma generate`. La distinction est la raison d'être des deux migrations.
    expect(DERIVED_MIGRATION).toContain("`schema.prisma` N'EST PAS TOUCHÉ par cette story");
    expect(OUTBOX_MIGRATION).toContain('`schema.prisma` EST touché par cette story');
    // Ce qui reste interdit dans les DEUX cas : décrire une policy dans le
    // schéma. Prisma ne peut pas la porter, donc l'y écrire serait une promesse
    // que rien n'applique.
    expect(SCHEMA).not.toMatch(/tenant_isolation|ROW LEVEL SECURITY/i);
  });
});

describe('S-E01-2d — la migration `outbox_event` : une COLONNE, pas un chemin FK inventé', () => {
  it('elle est à son chemin nommé et ne réécrit AUCUNE de ses deux sœurs', () => {
    expect(existsSync(OUTBOX_MIGRATION_PATH)).toBe(true);
    expect(readdirSync(MIGRATIONS_DIR)).toContain(OUTBOX_MIGRATION_DIR_NAME);
    // Les deux migrations déjà jouées restent EN PLACE et intactes : ni le ledger
    // ni le cliquet des 44 noms ne supporteraient qu'on les réécrive.
    expect(readdirSync(MIGRATIONS_DIR)).toContain(MIGRATION_DIR_NAME);
    expect(readdirSync(MIGRATIONS_DIR)).toContain(DERIVED_MIGRATION_DIR_NAME);
    expect(OUTBOX_MIGRATION_PATH).not.toEqual(MIGRATION_PATH);
    expect(OUTBOX_MIGRATION_PATH).not.toEqual(DERIVED_MIGRATION_PATH);
    // Et elle est POSTÉRIEURE : un horodatage antérieur la ferait jouer avant la
    // migration qui crée la table, sur toute base neuve.
    expect(OUTBOX_MIGRATION_DIR_NAME > DERIVED_MIGRATION_DIR_NAME).toBe(true);
  });

  it('elle n’a été produite ni par `db push` ni par `migrate dev`, et le dit', () => {
    expect(OUTBOX_MIGRATION_CODE).not.toContain('db push');
    expect(OUTBOX_MIGRATION_CODE).not.toContain('migrate dev');
    expect(OUTBOX_MIGRATION).toContain('RELUE À LA MAIN');
  });

  it('elle n’INVENTE aucun chemin FK — c’est une DÉNORMALISATION, et elle le dit', () => {
    // `ADR-042 §D7` avait raison de refuser d'écrire un `EXISTS` sur un parent
    // qui n'existe pas. Cette story ne contourne pas ce constat, elle donne un
    // discriminant. Le prédicat doit donc être celui des 44 (comparaison
    // directe), JAMAIS un `EXISTS` : un `EXISTS` ici serait précisément la
    // fiction que l'ADR précédent refusait.
    expect(OUTBOX_MIGRATION_CODE).not.toMatch(/EXISTS\s*\(\s*SELECT 1\s+FROM\s+public\.%I\s+p/i);
    expect(OUTBOX_MIGRATION).toContain('POLYMORPHE');
    expect(OUTBOX_MIGRATION).toContain('ADR-044');
  });

  it('LE BACKFILL refuse de deviner ET refuse de supprimer — il ÉCHOUE BRUYAMMENT', () => {
    // Les deux réponses complaisantes sont les deux façons de livrer du vert :
    // supprimer les lignes (perte silencieuse) ou les affecter au premier tenant
    // venu (fiction avec une policy autour).
    expect(OUTBOX_MIGRATION_CODE).toMatch(/RAISE\s+EXCEPTION/i);
    expect(OUTBOX_MIGRATION_CODE).toMatch(/tenant_count\s*=\s*1/);
    // AUCUN DELETE dans le SQL exécutable : c'est la ligne qu'une « correction »
    // future ajouterait pour faire passer le NOT NULL.
    expect(OUTBOX_MIGRATION_CODE).not.toMatch(/DELETE\s+FROM/i);
    expect(OUTBOX_MIGRATION_CODE).not.toMatch(/TRUNCATE/i);
    // …et la colonne devient réellement obligatoire, sinon tout ce qui précède
    // serait une cérémonie autour d'une colonne restée nullable.
    expect(OUTBOX_MIGRATION_CODE).toMatch(/ALTER\s+COLUMN\s+tenant_id\s+SET\s+NOT\s+NULL/i);
  });

  it('UNE seule migration, et la raison est MESURÉE — pas une entorse à expand/contract', () => {
    // `PF-185` écrivait « NOT NULL dans une seconde migration ». Ce découpage
    // protège des ÉCRIVAINS VIVANTS ; il y en a zéro, et scinder laisserait une
    // colonne de sécurité NULLABLE en production pendant tout un déploiement.
    expect(OUTBOX_MIGRATION).toContain('ZÉRO');
    expect(OUTBOX_MIGRATION).toContain('ADR-044 §D2');
  });

  it('la FK porte le NOM et la FORME que Prisma génère — sinon le garde de dérive rougit', () => {
    expect(OUTBOX_MIGRATION_CODE).toContain('outbox_event_tenant_id_fkey');
    expect(OUTBOX_MIGRATION_CODE).toMatch(/ON\s+DELETE\s+CASCADE\s+ON\s+UPDATE\s+CASCADE/i);
    expect(OUTBOX_MIGRATION_CODE).toContain('outbox_event_tenant_id_status_created_at_idx');
    // Le schéma déclare la MÊME chose : c'est la moitié que `migrate diff` VOIT,
    // donc les deux côtés doivent dire la même chose ou la dérive est réelle.
    expect(SCHEMA).toMatch(/tenant\s+Tenant\s+@relation\(fields:\s*\[tenantId\][^)]*onDelete:\s*Cascade/);
    expect(SCHEMA).toContain('@@index([tenantId, status, createdAt])');
    // L'index par statut est CONSERVÉ : le retirer serait un changement de
    // comportement du relais déguisé en nettoyage.
    expect(SCHEMA).toContain('@@index([status, createdAt])');
  });

  it('R-11 est VÉRIFIÉ avant d’activer la policy, pas supposé', () => {
    // Différence avec les 44 et les 5 : ici la colonne VIENT d'être créée, donc
    // aucun index ne pouvait la mener. La migration en crée un ET refuse de
    // poser la policy s'il n'est pas là.
    expect(OUTBOX_MIGRATION_CODE).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
    expect(OUTBOX_MIGRATION_CODE).toMatch(/indkey\[0\]\s*=\s*tenant_attnum/);
    expect(OUTBOX_MIGRATION_CODE).toContain('R-11');
  });

  it('le prédicat est celui des 44, MOT POUR MOT, avec ses trois pièges refermés', () => {
    // (1) `nullif(…, '')` : après un COMMIT le GUC est '' et non NULL, donc un
    //     cast nu lève 22P02 à la DEUXIÈME requête de chaque connexion du pool.
    expect(OUTBOX_MIGRATION_CODE).toContain(
      "nullif(current_setting('app.current_tenant_id', true), '')::uuid = tenant_id",
    );
    expect(OUTBOX_MIGRATION_CODE).not.toMatch(/current_setting\('app\.current_tenant_id'\)\s*::uuid/);
    // (2) `USING` et `WITH CHECK` déclarés tous les deux : un `with_check` NULL
    //     retombe sur `USING`, ce qui a l'air correct et casse plus tard.
    expect(OUTBOX_MIGRATION_CODE).toMatch(/USING\s*\(/);
    expect(OUTBOX_MIGRATION_CODE).toMatch(/WITH\s+CHECK\s*\(/);
    // (3) `TO PUBLIC` : une policy nommant un rôle exempte en silence tous les
    //     AUTRES rôles non propriétaires.
    expect(OUTBOX_MIGRATION_CODE).toMatch(/TO\s+PUBLIC/);
    // Le GUC vient de la MÊME source que le service : deux littéraux divergents
    // seraient une isolation qui ne s'applique à rien.
    expect(OUTBOX_MIGRATION_CODE).toContain(TENANT_GUC);
    // Re-jouable : PG 15 n'a pas d'`IF NOT EXISTS` sur `CREATE POLICY`.
    const dropAt = OUTBOX_MIGRATION_CODE.indexOf('DROP POLICY IF EXISTS tenant_isolation');
    const createAt = OUTBOX_MIGRATION_CODE.indexOf('CREATE POLICY tenant_isolation');
    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
  });

  it('pas de `FORCE`, et le GRANT est gardé sur `pg_roles`', () => {
    expect(OUTBOX_MIGRATION_CODE).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(OUTBOX_MIGRATION_CODE).toMatch(/pg_roles\s+WHERE\s+rolname\s*=\s*'app_user'/);
    expect(OUTBOX_MIGRATION_CODE).not.toMatch(/ON\s+ALL\s+TABLES\s+IN\s+SCHEMA/i);
    // `GRANT USAGE ON SCHEMA public` a déjà été émis nominativement par la
    // migration des 44 : le ré-émettre serait une seconde source de vérité.
    expect(OUTBOX_MIGRATION_CODE).not.toContain('GRANT USAGE ON SCHEMA public');
  });

  it('le GRANT est `SELECT, INSERT, UPDATE` — `DELETE` est RETENU, dans un jeu FERMÉ', () => {
    expect(OUTBOX_MIGRATION_CODE).toContain("privileges CONSTANT text := 'SELECT, INSERT, UPDATE'");
    // Jeu FERMÉ, vérifié AVANT tout DDL : une chaîne inconnue doit faire échouer
    // la migration entière, pas sa moitié.
    expect(OUTBOX_MIGRATION_CODE).toMatch(/allowed_privileges\s+CONSTANT\s+text\[\]/);
    for (const privileges of OUTBOX_ALLOWED_PRIVILEGES) expect(privileges).not.toContain('DELETE');
    expect(OUTBOX_ALLOWED_PRIVILEGES).toContain('SELECT, INSERT, UPDATE');
    // La raison, écrite : un `DELETE` ici laisserait le rôle applicatif effacer
    // des événements NON DÉLIVRÉS — la perte exacte que le pattern outbox existe
    // pour empêcher. Et la mesure honnête est écrite aussi : ZÉRO site d'appel
    // aujourd'hui, donc c'est la FORME du pattern qui tranche, pas un grep.
    expect(OUTBOX_MIGRATION).toContain('RETENU');
    expect(OUTBOX_MIGRATION).toContain("ZÉRO site d'appel");
    expect(OUTBOX_MIGRATION).toContain('ADR-044 §D3');
  });

  it('le rollback n’est PAS un copier-coller de « expand pur » — il retire ce qu’il a créé', () => {
    // C'est la première des trois qui n'est pas un expand pur : une colonne, une
    // contrainte et un index ont été créés, donc DROP POLICY + DISABLE + REVOKE
    // ne suffit plus. Écrire « expand pur » ici par analogie serait faux.
    expect(OUTBOX_MIGRATION).toContain("N'EST PAS UN EXPAND PUR");
    expect(OUTBOX_MIGRATION).toContain('DROP POLICY IF EXISTS tenant_isolation ON public.outbox_event');
    expect(OUTBOX_MIGRATION).toContain('DISABLE ROW LEVEL SECURITY');
    expect(OUTBOX_MIGRATION).toContain('DROP CONSTRAINT IF EXISTS outbox_event_tenant_id_fkey');
    expect(OUTBOX_MIGRATION).toContain('DROP COLUMN IF EXISTS tenant_id');
    // …et il DIT qu'il cesse d'être neutre dès que la table n'est plus vide :
    // l'attribution n'est pas re-dérivable, donc rejouer ce rollback plus tard
    // détruirait de l'information.
    expect(OUTBOX_MIGRATION).toContain('DESTRUCTIF');
  });

  it('l’attente sur le verrou est BORNÉE — `ADD COLUMN` prend un ACCESS EXCLUSIVE', () => {
    expect(OUTBOX_MIGRATION_CODE).toMatch(/SET\s+lock_timeout\s*=\s*'5s'/);
  });

  it('elle ne découvre PAS ses tables depuis `information_schema`', () => {
    // Une migration dont l'effet dépend de la base où elle atterrit est
    // irrelisable, et non déterministe sur les bases scratch des gardes.
    expect(OUTBOX_MIGRATION_CODE).not.toMatch(/from\s+information_schema/i);
    expect(OUTBOX_MIGRATION_CODE).toContain("target CONSTANT text := 'outbox_event'");
  });
});

describe('AC-12 — le rollback est écrit EN ENTIER, et la logique expand/contract est explicite', () => {
  it('l’en-tête porte le DROP, le DISABLE et les REVOKE', () => {
    expect(MIGRATION).toContain('DROP POLICY IF EXISTS tenant_isolation ON public.%I');
    expect(MIGRATION).toContain('DISABLE ROW LEVEL SECURITY');
    expect(MIGRATION).toContain('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM app_user');
    expect(MIGRATION).toContain('REVOKE USAGE ON SCHEMA public FROM app_user');
  });

  it('il énonce POURQUOI un DROP/DISABLE suffit — expand pur, aucune phase contract', () => {
    expect(MIGRATION).toContain('EXPAND PUR');
    expect(MIGRATION).toContain("Il n'y a pas de phase contract");
  });

  it('et il est EXÉCUTÉ par le vérificateur, pas seulement écrit', () => {
    // Un rollback jamais joué est une assertion sur un commentaire.
    expect(CHECKER_CODE).toContain('AC-12 the rollback removes every policy');
    expect(CHECKER_CODE).toContain('AC-12 the rollback returns relrowsecurity to false');
  });

  it('S-E01-2c — la migration DÉRIVÉE porte le sien, et il est EXPAND PUR lui aussi', () => {
    expect(DERIVED_MIGRATION).toContain('DROP POLICY IF EXISTS tenant_isolation ON public.%I');
    expect(DERIVED_MIGRATION).toContain('DISABLE ROW LEVEL SECURITY');
    expect(DERIVED_MIGRATION).toContain('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM app_user');
    expect(DERIVED_MIGRATION).toContain('EXPAND PUR');
    expect(DERIVED_MIGRATION).toContain("Il n'y a pas de phase contract");
    // Et le vérificateur PROUVE que le bloc générique (qui itère `relrowsecurity`)
    // atteint réellement l'ensemble élargi, au lieu de le supposer — AC-11.
    expect(CHECKER_CODE).toContain('ROLLBACK_TOUCHED');
    expect(CHECKER_CODE).toContain('AFTER_GRANTS');
  });
});

describe('Le vérificateur exécuté — il ÉCHOUE, il ne saute jamais, et il prouve qui il est', () => {
  it('il partage l’adresse et le client PostgreSQL des autres gardes, jamais un littéral', () => {
    expect(CHECKER_CODE).toMatch(/require\(\s*'\.\/lib\/default-database-url'\s*\)/);
    expect(CHECKER_CODE).toMatch(/require\(\s*'\.\/lib\/postgres-client-path'\s*\)/);
    expect(CHECKER_CODE).toMatch(/process\.env\.DATABASE_URL\s*\|\|/);
    expect(CHECKER_CODE).not.toMatch(/postgresql:\/\/[^'"\s]*@/);
  });

  it('le mot de passe passe par l’ENVIRONNEMENT, jamais par argv (ADR-025 D6)', () => {
    expect(CHECKER_CODE).toContain('PGPASSWORD');
    // Une chaîne de connexion en argument publierait le mot de passe dans la table
    // des processus de l'hôte.
    expect(CHECKER_CODE).not.toMatch(/'--dbname'|`postgresql:\/\//);
  });

  it('il REFUSE de faire du DDL sur une adresse non-loopback, sans échappatoire', () => {
    expect(CHECKER_CODE).toContain('isLoopbackHost');
    expect(CHECKER_CODE).toContain('non-loopback address');
    // DNC-10 : aucune variable ni drapeau ne doit pouvoir lever ce refus.
    expect(CHECKER_CODE).not.toMatch(/process\.env\.[A-Z_]*(FORCE|SKIP|ALLOW|BYPASS)/);
  });

  it('il n’a AUCUN verdict « skipped » : une tenancy gate qui ne tourne pas n’a pas d’avis', () => {
    // DNC-08. Le cliquet de skips de ce dépôt est DÉSARMÉ : un « skip » serait
    // définitivement invisible.
    expect(CHECKER_CODE).toMatch(/isolated:\s*0/);
    expect(CHECKER_CODE).toMatch(/tooling_unavailable:\s*1/);
    expect(CHECKER_CODE).toMatch(/not_isolated:\s*2/);
    expect(CHECKER_CODE).not.toMatch(/skipped:\s*0/);
  });

  it('il porte LE CONTRÔLE POSITIF, sans quoi tout serait vert pour la mauvaise raison', () => {
    // `app_user` n'avait AUCUN privilège avant cette migration : un test qui
    // n'assertait que « les lignes étrangères sont invisibles » aurait été vert
    // sur une base sans la moindre policy.
    expect(CHECKER_CODE).toContain('POSITIVE CONTROL: with GUC = tenant A, A rows ARE VISIBLE');
    expect(CHECKER_CODE).toContain('POSITIVE CONTROL: an OWN-tenant INSERT is accepted');
    // Et un « permission denied » est un ÉCHEC bruyant, jamais lu comme isolation.
    expect(CHECKER_CODE).toContain('permission denied');
    expect(CHECKER_CODE).toContain('which is a MISSING GRANT and not evidence of isolation');
  });

  it('il prouve AS QUI il s’est connecté avant la moindre assertion de visibilité (AC-14)', () => {
    expect(CHECKER_CODE).toContain('AC-14 the connection under test is NOT the table owner');
    expect(CHECKER_CODE).toContain('AC-14 the connection under test does not carry BYPASSRLS');
  });

  it('il assertit l’ACCORD des trois comptes, jamais un 44 ni un 49 en dur (anti-dérive)', () => {
    // Un 44 en dur serait satisfaisable en SUPPRIMANT une table. Un accord ne
    // l'est pas, et il survit à la croissance du schéma.
    expect(CHECKER_CODE).toContain('tenantCols');
    // S-E01-2c élargit le cliquet : `49` (44 + 5) est la nouvelle tentation, et
    // `5` / `6` sont les deux autres — le nombre de tables dérivées et la taille
    // du résidu. Chacun de ces trois, écrit en dur, transformerait un ACCORD en
    // constante et rendrait invisible la SIXIÈME table dérivée livrée sans
    // policy, c'est-à-dire exactement le défaut que ce garde existe pour voir.
    expect(CHECKER_CODE).not.toMatch(/toBe\(\s*(?:44|49|5|6)\s*\)|===\s*(?:44|49|5|6)\b/);
    // …et la direction qui échoue échoue bien : le motif reconnaît la forme.
    expect('expectEqual(x, 49)').not.toMatch(/toBe\(\s*(?:44|49|5|6)\s*\)|===\s*(?:44|49|5|6)\b/);
    expect('expect(x).toBe(49)').toMatch(/toBe\(\s*(?:44|49|5|6)\s*\)|===\s*(?:44|49|5|6)\b/);
    expect('if (n === 44) {').toMatch(/toBe\(\s*(?:44|49|5|6)\s*\)|===\s*(?:44|49|5|6)\b/);
    // `=== 50` (MIN_EXPECTED_TABLES) n'est PAS un compte de policies : la borne
    // de mot doit l'épargner, sans quoi le cliquet serait un faux rouge.
    expect('n === 50').not.toMatch(/toBe\(\s*(?:44|49|5|6)\s*\)|===\s*(?:44|49|5|6)\b/);
  });

  it('le côté DROIT de l’accord est calculé sur la STRUCTURE, jamais sur les policies posées', () => {
    // LE point d'AC-5, et la seule ligne de ce fichier qui mérite d'être relue
    // deux fois. `RLS_ON == TENANT_COLS + DERIVED_POLICIED`, où la moitié dérivée
    // compte les tables QUI ONT une policy, est VIDE DE SENS : une sixième table
    // dérivée livrée sans policy est absente des DEUX côtés, les comptes
    // s'équilibrent, et la porte s'ouvre sur le défaut qu'elle existe pour voir.
    expect(CHECKER_CODE).toContain('DERIVED_EXPECTED');
    expect(CHECKER_CODE).not.toContain('DERIVED_POLICIED');
    // La dérivation lit `pg_constraint` (les FK multi-colonnes y sont visibles)
    // et n'interroge JAMAIS `pg_policy` pour construire son attente.
    const derivation = /const DERIVED_SET_SQL = `([\s\S]*?)`;/.exec(CHECKER_CODE)?.[1] ?? '';
    expect(derivation).toContain('pg_constraint');
    expect(derivation).toContain("contype = 'f'");
    expect(derivation).not.toMatch(/pg_policy|polname|relrowsecurity|role_table_grants/i);
    expect(derivation).not.toMatch(/information_schema\.table_constraints/i);
  });

  it('il PROUVE les CINQ dérivées, contrôle positif d’abord, et pas « une par forme »', () => {
    // Le recensement compte les policies PAR NOM et ne lit JAMAIS le prédicat :
    // une policy pointant vers le mauvais parent est comptée comme correcte, et
    // quatre des cinq sortent d'un seul `format()` sur un tuple transposable.
    expect(CHECKER_CODE).toContain('POSITIVE CONTROL: GUC = tenant A, the ${d.child} row');
    expect(CHECKER_CODE).toContain('for (const d of DERIVED_TABLES)');
    for (const row of DERIVED_TUPLE) {
      expect(CHECKER_CODE).toContain(`child: '${row.child}'`);
      expect(CHECKER_CODE).toContain(`parent: '${row.parent}'`);
      expect(CHECKER_CODE).toContain(`fk: '${row.fk}'`);
    }
  });

  it('il assertit AC-5b par ÉGALITÉ D’ENSEMBLES, avec les noms imprimés', () => {
    expect(CHECKER_CODE).toContain('NON_DERIVED_EXPECTED');
    expect(CHECKER_CODE).toContain('function expectSetEqual');
    // Les deux directions, sans quoi la moitié dangereuse passe.
    expect(CHECKER_CODE).toContain('const missing =');
    expect(CHECKER_CODE).toContain('const unexpected =');
    for (const table of NON_DERIVED_EXPECTED) expect(CHECKER_CODE).toContain(`'${table}'`);
  });

  it('il prouve `outbox_event` ISOLÉE par EXÉCUTION — l’assertion de `S-E01-2c` est INVERSÉE, pas supprimée', () => {
    // `S-E01-2c` prouvait l'inverse : `permission denied` était le résultat
    // ATTENDU, dans une invocation psql SÉPARÉE, parce que la garde générale
    // traite cette chaîne comme un échec bruyant partout ailleurs. `S-E01-2d`
    // donne à la table une colonne, une policy et un GRANT, donc la preuve
    // revient DANS la preuve principale — ce qui remet la garde en vigueur sur
    // elle. Supprimer ces assertions au lieu de les inverser aurait laissé la
    // seule table du schéma dont les erreurs de permission sont tolérées.
    expect(CHECKER_CODE).toContain('PF-185');
    expect(CHECKER_CODE).not.toContain('OUTBOX_SQL');
    expect(CHECKER_CODE).not.toMatch(/const outboxRun = psql\(/);

    // Le contrôle POSITIF d'abord : avant cette story `app_user` n'avait AUCUN
    // privilège ici, donc « la ligne du tenant B n'est pas visible » aurait été
    // vert sur une table que personne ne pouvait lire.
    expect(CHECKER_CODE).toContain('CTX_A_OUTBOX');
    expect(CHECKER_CODE).toContain('CTX_A_FOREIGN_OUTBOX');
    expect(CHECKER_CODE).toContain('CTX_A_TOTAL_OUTBOX');
    expect(CHECKER_CODE).toContain('CTX_B_OUTBOX');
    // Le chemin d'ÉCRITURE : un outbox non filtré, c'est chaque agrégat de chaque
    // tenant.
    expect(CHECKER_CODE).toContain('OUTBOX_OWN_INSERT');
    expect(CHECKER_CODE).toContain('OUTBOX_FOREIGN_INSERT_ACCEPTED');
    expect(CHECKER_CODE).toContain('OUTBOX_FOREIGN_UPDATE');
    // …et la moitié que la connexion tenant-scopée ne peut PAS observer sur
    // elle-même : une ligne invisible et une ligne qu'on vient de modifier se
    // ressemblent depuis ce côté-là.
    expect(CHECKER_CODE).toContain('OWNER_FOREIGN_OUTBOX_UNTOUCHED');
    expect(CHECKER_CODE).toContain('OWNER_OUTBOX_FOREIGN_INSERT');
    // Le catalogue : la colonne AVANT la policy (une policy sur une table sans
    // colonne ne compilerait pas, et un « policy = 1 » lu seul ne dit pas sur
    // QUELLE colonne elle filtre), la FK en CASCADE, l'index de tête, et le
    // GRANT exact — `DELETE` compté à part pour qu'un élargissement échoue avec
    // sa propre assertion nommée.
    expect(CHECKER_CODE).toContain('OUTBOX_TENANT_COL');
    expect(CHECKER_CODE).toContain('OUTBOX_FK_CASCADE');
    expect(CHECKER_CODE).toContain('OUTBOX_TENANT_INDEX');
    expect(CHECKER_CODE).toContain('OUTBOX_POLICIES');
    expect(CHECKER_CODE).toContain('OUTBOX_RLS');
    expect(CHECKER_CODE).toContain('OUTBOX_GRANTS');
    expect(CHECKER_CODE).toContain('OUTBOX_DELETE');
    expect(CHECKER_CODE).toContain("OUTBOX_PRIVILEGES = 'SELECT, INSERT, UPDATE'");
  });

  it('il exécute la cascade d’AC-10 au lieu de la croire', () => {
    // `user_role` n'a pas `DELETE` alors que `user_profile -> user_role` est ON
    // DELETE CASCADE. Le moteur DEVRAIT quand même la faire partir ; c'est une
    // croyance dans un chemin de sécurité, donc elle s'exécute.
    expect(CHECKER_CODE).toContain('CASCADE_PARENT_GONE');
    expect(CHECKER_CODE).toContain('OWNER_CASCADE_CHILD');
    // Le contrôle qui rend l'assertion non vide : la ligne du tenant B, dont le
    // parent n'a jamais été supprimé, est INTACTE.
    expect(CHECKER_CODE).toContain('OWNER_CASCADE_CONTROL');
  });

  it('il nomme le même GUC que le TypeScript', () => {
    expect(CHECKER_CODE).toContain(`const TENANT_GUC = '${TENANT_GUC}'`);
  });

  it('il ne s’exécute PAS à l’import — le spec peut le lire sans créer de base', () => {
    expect(CHECKER_CODE).toContain('require.main === module');
  });
});

describe('Le vérificateur est CÂBLÉ — dans `ci-gate.sh` ET dans `ci.yml`, qui ne s’appellent pas', () => {
  const GATE_SH = readFileSync(join(REPO_ROOT, 'scripts', 'ci-gate.sh'), 'utf8');
  const CI_YML = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  /** Lignes de commentaire retirées — un stage commenté n'exécute rien. */
  const stripShellComments = (source: string): string => source.replace(/^\s*#.*$/gm, '');
  const stripYamlComments = (source: string): string => source.replace(/^\s*#.*$/gm, '');

  it('un stage COMMENTÉ ne satisfait pas l’ancrage (la direction qui échoue)', () => {
    expect(stripShellComments('  # run_stage 600 "x" node scripts/rls-isolation-check.js')).not.toContain(
      'rls-isolation-check.js',
    );
    expect(stripShellComments('  run_stage 600 "x" node scripts/rls-isolation-check.js')).toContain(
      'rls-isolation-check.js',
    );
  });

  it('`ci-gate.sh` le lance, avec une borne numérique (TOOL-06)', () => {
    expect(stripShellComments(GATE_SH)).toMatch(
      /run_stage\s+\d+\s+"rls isolation"\s+node\s+scripts\/rls-isolation-check\.js/,
    );
  });

  it('`ci.yml` le lance AUSSI — il re-liste les stages, il n’appelle pas `ci-gate.sh`', () => {
    // Sans cette moitié, un stage ajouté au seul `ci-gate.sh` ne tournerait JAMAIS
    // en CI (S-E02-2 AC-4).
    expect(CI_YML).not.toContain('bash scripts/ci-gate.sh');
    expect(stripYamlComments(CI_YML)).toContain('- run: node scripts/rls-isolation-check.js');
    // …et le rôle non-propriétaire est fourni au job, faute de quoi le checker
    // échouerait faute d'adresse — ce qui serait un rouge honnête mais inutile.
    expect(stripYamlComments(CI_YML)).toMatch(/DATABASE_URL_APP:\s*postgresql:\/\/app_user/);
  });

  it('il tourne AVANT `prisma generate` et AVANT le build, comme le garde de dérive', () => {
    // Le ledger doit être refusé avant qu'un client soit généré contre lui.
    //
    // Ancré sur le STAGE `run_stage … "prisma generate"`, pas sur la chaîne
    // « prisma generate » : celle-ci apparaît d'abord dans la DÉFINITION de la
    // fonction shell, bien avant son appel, et l'ancrage naïf compare donc deux
    // choses sans rapport. Vérifié dans la direction qui échoue.
    const code = stripShellComments(GATE_SH);
    const rlsAt = code.indexOf('scripts/rls-isolation-check.js');
    const generateAt = code.search(/run_stage\s+\d+\s+"prisma generate"/);
    expect(rlsAt).toBeGreaterThan(-1);
    expect(generateAt).toBeGreaterThan(-1);
    expect(rlsAt).toBeLessThan(generateAt);
  });

  it('aucun `continue-on-error` ne le rend décoratif', () => {
    const step = CI_YML.slice(CI_YML.indexOf('- run: node scripts/rls-isolation-check.js'));
    expect(step.slice(0, 200)).not.toContain('continue-on-error');
  });
});

describe('Règle ADR — une citation qui ne résout pas est pire que pas de citation', () => {
  const ADR_DIR = join(REPO_ROOT, 'docs', 'adr');
  /** Les numéros d'ADR réellement présents sur le disque. */
  const ADR_NUMBERS = new Set(
    readdirSync(ADR_DIR)
      .map((name) => /^ADR-(\d{3})-/.exec(name)?.[1])
      .filter((n): n is string => Boolean(n)),
  );
  /** Les numéros CITÉS par les artefacts de cette story, commentaires COMPRIS. */
  const cited = (source: string): string[] => [
    ...new Set([...source.matchAll(/ADR-(\d{3})/g)].map((m) => m[1] as string)),
  ];

  it('le registre lu n’est pas vide, et la direction qui échoue échoue bien', () => {
    // Un répertoire vide rendrait chaque « résout » vrai pour rien.
    expect(ADR_NUMBERS.size).toBeGreaterThanOrEqual(20);
    expect(ADR_NUMBERS.has('032')).toBe(true);
    // Le contrôle négatif — `has()` doit pouvoir répondre `false`, sinon les deux
    // cas ci-dessous passent pour rien.
    //
    // Il est ancré sur `000`, RÉSERVÉ PAR CONSTRUCTION : la numérotation des ADR
    // commence à `001`, donc aucun ADR légitime ne peut jamais occuper ce numéro.
    // La version précédente ancrait ce contrôle sur le PROCHAIN numéro libre du
    // moment (`042`) : elle prenait donc en OTAGE le numéro suivant, et le premier
    // ADR écrit après elle faisait rougir cette suite sans avoir rien cassé.
    //
    // Ce n'est pas une hypothèse : DEUX slices ont réclamé `042` en deux jours —
    // `S-E01-2c` / `PF-183` (isolation par chemin de clé étrangère, PR #245, encore
    // ouverte) et `S-E01-1a` (cette couture d'identité, renumérotée en `ADR-043` au
    // moment du land, justement à cause de cette collision). Le premier des deux à
    // fusionner aurait rendu `main` rouge ici, sur un fichier que ni l'un ni l'autre
    // n'aurait eu de raison de regarder.
    //
    // Un contrôle négatif ne doit pas être une réservation de numéro.
    expect(ADR_NUMBERS.has('000')).toBe(false);
    expect(cited('voir ADR-000 D1')).toEqual(['000']);
    // S-E01-2c / S-E01-2d — les trois ADR de la séquence d'isolation EXISTENT.
    // `042` (chemin FK), `043` (couture d'identité, PR #246) et `044`
    // (dénormalisation de `tenant_id` sur `outbox_event`). Asserter leur
    // PRÉSENCE, jamais leur absence : une ligne qui assertait l'absence du
    // prochain numéro libre est exactement ce que le contrôle négatif ancré sur
    // `000` ci-dessus vient de supprimer.
    //
    // ⚠️ `043` et `044` ont été alloués EN PARALLÈLE par deux runs, chacun
    // aveugle à l'autre parce qu'une PR tenue n'est pas sur `main` — la collision
    // a été rattrapée à la main au moment du land (run 55) et est enregistrée
    // comme `TOOL-29`. Les DEUX sont assertés ici pour que la renumérotation ne
    // puisse pas se défaire en silence.
    expect(ADR_NUMBERS.has('042')).toBe(true);
    expect(ADR_NUMBERS.has('043')).toBe(true);
    expect(ADR_NUMBERS.has('044')).toBe(true);
    expect(cited('voir ADR-042 §D1 et ADR-000')).toEqual(['042', '000']);
  });

  it.each([
    ['migration.sql', MIGRATION],
    ['derived/migration.sql', DERIVED_MIGRATION],
    ['outbox/migration.sql', OUTBOX_MIGRATION],
    ['rls-isolation-check.js', CHECKER],
  ])('%s ne cite QUE des ADR qui existent dans docs/adr/', (_name, source) => {
    // Un lecteur qui suit la citation pour comprendre POURQUOI il n'y a pas de
    // `FORCE` doit trouver un fichier. Rien ne détectait ça auparavant : une
    // décision architecturale nouvelle peut atterrir en citant un document qui
    // n'existe pas, et tous les autres gardes restent verts.
    const numbers = cited(source);
    expect(numbers.length).toBeGreaterThan(0);
    for (const number of numbers) expect([...ADR_NUMBERS]).toContain(number);
  });

  it('la migration cite la décision qui porte VRAIMENT le choix « pas de FORCE »', () => {
    // ADR-032 §D5 — et non un commentaire de migration qui se déclarerait
    // supersédant : une décision de record ne peut pas être supersédée par du SQL.
    expect(MIGRATION).toContain('ADR-032 §D5');
    expect(MIGRATION).toContain('ADR-032 §D6');
    expect(MIGRATION).toContain('ADR-032 §D7');
    expect(MIGRATION).toContain('ADR-032 §D8');
    // Cette ligne ne dit PAS « le numéro 042 est vide » — elle dit « cette
    // migration-ci ne cite pas la décision d'un AUTRE seam ». `042` est réservé à
    // l'isolation par chemin de clé étrangère (`PF-183`, PR #245, encore ouverte)
    // et `043` à la couture d'identité (`S-E01-1a`) ; les trois seams sont voisins
    // et faciles à confondre. L'assertion reste donc vraie quand `ADR-042`
    // atterrira, et c'est le but : elle porte sur ce que la migration CITE, pas sur
    // ce que `docs/adr/` CONTIENT.
    expect(MIGRATION).not.toContain('ADR-042');
    expect(MIGRATION).not.toContain('ADR-043');
  });

  it('ADR-032 porte réellement §D5–§D8, et son §Deferred item 1 ne dit plus le contraire', () => {
    // La moitié qui manquait : le fichier CITÉ doit contenir la décision citée,
    // sinon la citation résout vers un document qui dit l'inverse.
    const adr = readFileSync(join(ADR_DIR, 'ADR-032-tenant-enforcement.md'), 'utf8');
    for (const heading of ['### D5 —', '### D6 —', '### D7 —', '### D8 —']) {
      expect(adr).toContain(heading);
    }
    expect(adr).toContain('Partially superseded by §D5');
    expect(adr).toContain('Satisfied and extended by §D6');
    // Et l'ADR ne doit pas se mettre à surclamer non plus : le décalage qu'il
    // enregistre est exactement ce que PF-02 reproche à la prose d'origine.
    expect(adr).toContain('stays `in-progress`');
    expect(adr).toContain('connection cutover');
  });
});

describe('G-TRUTH — aucune phrase du diff ne peut se lire « l’app est isolée par RLS »', () => {
  /** Les artefacts que cette story écrit ou réécrit, et qui parlent d'isolation. */
  const ARTEFACTS: Array<[string, string]> = [
    ['migration.sql', MIGRATION],
    ['derived/migration.sql', DERIVED_MIGRATION],
    ['outbox/migration.sql', OUTBOX_MIGRATION],
    ['rls-isolation-check.js', CHECKER],
    [
      'prisma.service.ts',
      readFileSync(join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'prisma', 'prisma.service.ts'), 'utf8'),
    ],
  ];

  it.each(ARTEFACTS)('%s énonce explicitement la limite au lieu de la taire', (_name, source) => {
    // La surclamation EST le défaut que PF-02 enregistre. Chaque artefact doit
    // porter la phrase, pas seulement l'ADR que personne n'ouvre.
    expect(source).toMatch(/PAS ISOL|NOT isolated|n'est TOUJOURS PAS isolée|N'EST PAS ISOLÉE/i);
    expect(source).toMatch(/propriétaire|owner/i);
  });

  it('la migration nomme la bascule de connexion comme l’étape restante', () => {
    expect(MIGRATION).toContain('BASCULE DE CONNEXION');
    expect(CHECKER).toContain('CONNECTION CUTOVER');
  });

  it('l’absence de FORCE est une DÉCISION consignée, pas un oubli', () => {
    expect(MIGRATION_CODE).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
    // …et l'en-tête, lui, en parle : c'est la différence entre un oubli et un choix.
    expect(MIGRATION).toContain('POURQUOI PAS `FORCE ROW LEVEL SECURITY`');
  });
});
