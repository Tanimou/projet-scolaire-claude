import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { TENANT_GUC } from '../prisma/prisma.service';

/**
 * S-E01-3 / VAL-02 — LE GARDE HERMÉTIQUE de `scripts/tenant-adversarial-check.js`.
 *
 * DEUX GARDES, ET LA RAISON DE LA SÉPARATION
 * ------------------------------------------
 * Le vérificateur fait la PREUVE : il construit une base scratch, y applique le
 * ledger, sème DEUX tenants réels, se connecte comme `app_user` et regarde les
 * lignes apparaître et disparaître selon le GUC — sur CHAQUE table recensée
 * depuis le catalogue vivant, quatre verbes, deux directions. Il lui faut un
 * PostgreSQL, il ÉCHOUE (jamais « skip ») quand il n'y en a pas, et il tourne
 * dans `ci-gate.sh` et `ci.yml`, pas dans jest.
 *
 * CE fichier est l'autre moitié : il tourne SANS base, dans `pnpm test`, sur
 * toute machine, et il épingle ce qu'un texte peut porter — l'absence de liste
 * gelée du côté du RECENSEMENT, l'absence de tout drapeau ou variable capable de
 * changer un verdict, le motif de nom scratch, l'interdiction de
 * `pg_signal_backend`, l'ordre contrôle-positif-puis-déni, et la phrase d'honnêteté
 * d'AC-6 sur le chemin VERT. Les specs d'`apps/api` sont hermétiques par décision
 * (ADR-039) et le cliquet de skips est DÉSARMÉ dans ce dépôt : un spec jest qui
 * exigerait une base échouerait sur toute machine sans base, ou disparaîtrait dans
 * un skip toléré que personne ne relit.
 *
 * IL LIT LA SOURCE ET IL `require()` LES EXPORTS PURS — IL NE L'EXÉCUTE JAMAIS.
 * Le `main()` du vérificateur est derrière `require.main === module`, et cette
 * suite épingle ce fait : sans lui, `pnpm test` créerait et détruirait une base de
 * données comme effet de bord d'un import.
 *
 * CE QU'AUCUNE ASSERTION ICI NE DOIT LAISSER CROIRE
 * ------------------------------------------------
 * Que l'application est isolée par RLS. Elle ne l'est pas : elle se connecte comme
 * le PROPRIÉTAIRE des tables. Le dernier `describe` est un cliquet sur cette
 * phrase-là, et sur le bloc CUTOVER READINESS qui l'accompagne.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const CHECKER_PATH = join(REPO_ROOT, 'scripts', 'tenant-adversarial-check.js');
const SIBLING_PATH = join(REPO_ROOT, 'scripts', 'rls-isolation-check.js');
const ADR_PATH = join(REPO_ROOT, 'docs', 'adr', 'ADR-045-adversarial-tenant-suite.md');

/**
 * Lecture NORMALISÉE en `\n`, et ce n'est pas une coquetterie.
 *
 * `.gitattributes` épingle `*.ts`, `*.sh` et `*.yml` en `eol=lf` — mais PAS
 * `*.js`. `scripts/tenant-adversarial-check.js` est donc extrait en CRLF sur un
 * checkout Windows et en LF sur la CI Linux. Plusieurs assertions de ce fichier
 * ancrent un fragment MULTI-LIGNE (l'ordre `INS_A_OWN` / `INS_A_FGN`, l'extraction
 * de la bannière) : sans normalisation elles sont VERTES en CI et ROUGES sur la
 * machine d'un développeur, ce qui est la pire des deux directions — le garde
 * accuse le contenu alors que seule la fin de ligne diffère. MESURÉ : ces deux
 * cas-là échouaient réellement ici avant cette ligne.
 */
const lf = (source: string): string => source.replace(/\r\n/g, '\n');

/** Chemin NOMMÉ : lecture directe, échec au chargement s'il manque (TOOL-17b). */
const CHECKER = lf(readFileSync(CHECKER_PATH, 'utf8'));

/** Commentaires JS retirés, longueur préservée — un garde commenté ne garde rien. */
function executableJs(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

const CHECKER_CODE = executableJs(CHECKER);

/* eslint-disable @typescript-eslint/no-require-imports */
const checker = require(CHECKER_PATH) as {
  APPEND_ONLY_TABLES: readonly string[];
  APPEND_ONLY_DML: string;
  FULL_DML: string;
  MIN_COVERED_TABLES: number;
  OWN_PROBE_OFFSET: number;
  FOREIGN_PROBE_OFFSET: number;
  OUTBOX_DML: string;
  PLAN: ReadonlyArray<{ table: string; key: string; slot: number; derived?: boolean }>;
  QUIESCE_ATTEMPTS: number;
  SCRATCH_NAME_PATTERN: RegExp;
  SLOT: Record<string, number>;
  SLOT_A: number;
  SLOT_B: number;
  SPARE_PARENTS: readonly string[];
  SQLSTATE_INSUFFICIENT_PRIVILEGE: string;
  TENANT_A: string;
  TENANT_B: string;
  UNCOVERED_EXPECTED: readonly string[];
  cutoverVerdict: (counts: {
    files: number;
    withTenantCallers: number;
    prismaCallSites: number;
  }) => { kind: 'vacuous' | 'limit' | 'ok'; label: string; detail: string };
  prismaModelName: (table: string) => string;
};
const sibling = require(SIBLING_PATH) as {
  AUTO_DISCRIMINANT_PRIVILEGES: string;
  AUTO_DISCRIMINANT_SQL: string;
  DERIVED_SET_SQL: string;
  DERIVED_TABLES: ReadonlyArray<{ child: string; fk: string; parent: string; privileges: string }>;
  REFERENCE_PRIVILEGES: string;
  REFERENCE_SURFACE: readonly string[];
  TENANT_A: string;
  TENANT_B: string;
  TENANT_GUC: string;
  SCRATCH_NAME_PATTERN: RegExp;
};
/* eslint-enable @typescript-eslint/no-require-imports */

describe('AC-11 — le vérificateur existe, et sa forme est celle des autres gardes', () => {
  it('il est à son chemin nommé, exécutable, et il ne tourne PAS à l’import', () => {
    expect(existsSync(CHECKER_PATH)).toBe(true);
    expect(CHECKER.startsWith('#!/usr/bin/env node')).toBe(true);
    // Sans cette garde, `pnpm test` créerait et détruirait une base de données
    // comme effet de bord du `require()` trois lignes plus haut.
    expect(CHECKER_CODE).toContain('require.main === module');
    const mainAt = CHECKER_CODE.indexOf('require.main === module');
    const callAt = CHECKER_CODE.indexOf('main()', mainAt);
    expect(mainAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(mainAt);
  });

  it('il partage l’adresse et le client PostgreSQL des autres gardes, jamais un littéral', () => {
    expect(CHECKER_CODE).toMatch(/require\(\s*'\.\/lib\/default-database-url'\s*\)/);
    expect(CHECKER_CODE).toMatch(/require\(\s*'\.\/lib\/postgres-client-path'\s*\)/);
    expect(CHECKER_CODE).toMatch(/process\.env\.DATABASE_URL\s*\|\|/);
    // DNC-10 : un littéral DSN serait une seconde source de vérité pour l'adresse
    // qu'un gate atteint son verdict depuis.
    expect(CHECKER_CODE).not.toMatch(/postgresql:\/\/[^'"\s]*@/);
    // …et les deux helpers sont consommés SANS ARGUMENT : un paramètre laisserait
    // un appelant choisir le binaire ou l'adresse (objection TOOL-15).
    expect(CHECKER_CODE).toContain("postgresClient('psql')");
    expect(CHECKER_CODE).toContain('defaultDatabaseUrl()');
    expect(CHECKER_CODE).toContain('defaultAppDatabaseUrl()');
  });

  it('le mot de passe passe par l’ENVIRONNEMENT, jamais par argv (ADR-025 D6)', () => {
    expect(CHECKER_CODE).toContain('PGPASSWORD: target.password');
    // Une chaîne de connexion en argument publierait le mot de passe dans la
    // table des processus de l'hôte.
    expect(CHECKER_CODE).not.toMatch(/'--dbname'|`postgresql:\/\//);
    // L'adresse ne s'imprime QUE redigée.
    expect(CHECKER_CODE).toContain('redact(owner)');
  });

  it('il REFUSE le DDL sur une adresse non-loopback, sans échappatoire', () => {
    expect(CHECKER_CODE).toContain('isLoopbackHost');
    expect(CHECKER_CODE).toContain('non-loopback address');
    expect(CHECKER).toContain('There is deliberately no flag to override that.');
  });

  it('il n’a AUCUN verdict « skipped » : une tenancy gate qui ne tourne pas n’a pas d’avis', () => {
    // DNC-08. Le cliquet de skips de ce dépôt est DÉSARMÉ : un « skip » serait
    // définitivement invisible. Les trois codes viennent du frère, donc un
    // opérateur lit UN vocabulaire.
    expect(CHECKER_CODE).toContain('VERDICT_EXIT_CODES');
    expect(CHECKER_CODE).not.toMatch(/skipped/i);
    expect(CHECKER_CODE).toMatch(/verdict === 'isolated'/);
    expect(CHECKER_CODE).toMatch(/verdict === 'not_isolated'/);
    expect(CHECKER_CODE).toContain("'tooling_unavailable'");
  });
});

describe('AC-11 — AUCUN drapeau, AUCUNE variable ne peut changer un verdict (DNC-10)', () => {
  /**
   * Le prédicat lui-même, extrait pour pouvoir le nourrir de source SYNTHÉTIQUE
   * plus bas : un garde qu'on ne peut pas faire rougir n'est pas un garde.
   */
  const BYPASS_ENV = /process\.env\.[A-Za-z_$][A-Za-z0-9_$]*/g;
  const FORBIDDEN_ENV_SHAPE = /^(SKIP|ALLOW|FORCE|BYPASS|IGNORE|DISABLE)_/;

  it('les seules variables d’environnement lues sont les DEUX adresses (et celles du frère)', () => {
    const read = [...CHECKER_CODE.matchAll(BYPASS_ENV)].map((m) => m[0].replace('process.env.', ''));
    // `process.env[APP_DATABASE_URL_VAR]` est indexé, pas nommé : la liste directe
    // ne doit donc contenir QUE `DATABASE_URL`, plus les deux clés que `psql()`
    // POSE (et ne lit pas) dans l'environnement de l'enfant.
    expect(read.sort()).toEqual(['DATABASE_URL']);
    expect(CHECKER_CODE).toContain('process.env[APP_DATABASE_URL_VAR]');
    // …et aucune de forme bypass, dans aucun sens d'écriture.
    for (const name of read) expect(name).not.toMatch(FORBIDDEN_ENV_SHAPE);
  });

  it('LE GARDE PEUT ROUGIR — la même prédicat sur une source SYNTHÉTIQUE offensante', () => {
    // Sans ce cas, les trois assertions ci-dessus passeraient tout aussi bien sur
    // un fichier vide, et personne ne le saurait.
    const offending = [
      'if (process.env.SKIP_TENANT_ADVERSARIAL) return report("isolated");',
      'const allow = process.env.ALLOW_CROSS_TENANT === "1";',
      'if (process.env.FORCE_PASS) failures.length = 0;',
      'const bypass = process.env.BYPASS_RLS_CHECK;',
    ].join('\n');
    const found = [...offending.matchAll(BYPASS_ENV)].map((m) => m[0].replace('process.env.', ''));
    expect(found.length).toBe(4);
    for (const name of found) expect(name).toMatch(FORBIDDEN_ENV_SHAPE);
    // …et la direction inverse : le nom légitime ne matche pas.
    expect('DATABASE_URL').not.toMatch(FORBIDDEN_ENV_SHAPE);
  });

  it('il ne lit AUCUN argv et ne branche sur AUCUN NODE_ENV', () => {
    // Un drapeau CLI est « une nouvelle variable qui laisse un appelant choisir ce
    // qui est comparé » avec un autre chapeau.
    expect(CHECKER_CODE).not.toMatch(/process\.argv/);
    expect(CHECKER_CODE).not.toMatch(/NODE_ENV/);
  });

  it('PLANCHER DE NON-VACUITÉ : le fichier lu est réel, et le motif reconnaît les deux directions', () => {
    // Deux chaînes vides « ne contiennent pas » n'importe quoi. Le plancher vient
    // d'abord, sinon tout le describe est vert sur un fichier absent.
    expect(CHECKER_CODE.length).toBeGreaterThan(20000);
    expect(CHECKER_CODE).toContain('function main(');
    // `__filename` s'auto-exclut : ce spec-ci CITE les chaînes interdites, et une
    // règle qui balaierait `src/shared/quality/` se prendrait elle-même.
    expect(CHECKER_PATH).not.toEqual(__filename);
  });
});

describe('AC-11 — le RECENSEMENT n’a AUCUNE liste gelée de son côté', () => {
  /** Le bloc SQL du recensement, extrait tel quel. */
  // `\n {4}\)` plutôt que quatre espaces littéraux : même langage, mais `no-regex-spaces`
  // interdit la forme littérale (des espaces comptés à l'œil sont une source de bug).
  const enumeration = /const census = psql\(([\s\S]*?)\n {4}\);/.exec(CHECKER_CODE)?.[1] ?? '';

  it('le bloc de recensement a bien été extrait (plancher avant toute assertion)', () => {
    expect(enumeration.length).toBeGreaterThan(500);
  });

  it('il énumère depuis information_schema.columns et pg_constraint, pas depuis un tableau', () => {
    // C'est LA raison pour laquelle une table de plus ne peut pas passer : le côté
    // GAUCHE de l'égalité vient du catalogue vivant de la base scratch, jamais
    // d'une liste que le même diff pourrait modifier.
    expect(enumeration).toContain("c.column_name='tenant_id'");
    // La moitié `pg_constraint` est désormais INTERPOLÉE depuis le frère plutôt
    // que ré-écrite ici — c'est le correctif du défaut qui a fait diverger 6 et 7.
    // Elle est donc assertée là où elle vit maintenant, dans les DEUX fichiers :
    // le recensement l'interpole, et la requête interpolée lit bien le catalogue.
    expect(enumeration).toContain('${DERIVED_SET_SQL}');
    expect(enumeration).toContain('${AUTO_DISCRIMINANT_SQL}');
    expect(sibling.DERIVED_SET_SQL).toContain("k.contype = 'f'");
    expect(sibling.DERIVED_SET_SQL).toContain('pg_constraint');
    expect(sibling.AUTO_DISCRIMINANT_SQL).toContain("k.contype = 'f'");
    expect(enumeration).toContain('information_schema.role_table_grants');
    // Et il n'interroge JAMAIS pg_policy pour CONSTRUIRE son attente : une table
    // dérivée livrée sans policy serait absente des DEUX côtés (ADR-042 §D3).
    expect(enumeration).not.toMatch(/DERIVED_POLICIED/);
    // La ligne POLICIES existe pour l'inventaire, pas pour dériver l'attente : le
    // jeu des tables énumérées est construit sans elle.
    expect(CHECKER_CODE).toContain("const enumerated = [...tenantTables, ...derivedTables].sort()");
    expect(CHECKER_CODE).not.toMatch(/const enumerated = \[[^\]]*'[a-z_]+'/);
  });

  it('la partition COVERED / UNCOVERED est une ÉGALITÉ D’ENSEMBLES, avec les noms imprimés', () => {
    expect(CHECKER_CODE).toContain('UNCOVERED_EXPECTED');
    expect(CHECKER_CODE).toContain('function expectSetEqual');
    // Les deux directions, sans quoi la moitié dangereuse passe.
    expect(CHECKER_CODE).toContain('const missing =');
    expect(CHECKER_CODE).toContain('const unexpected =');
    // Une table énumérée mais jamais assertée entre dans UNCOVERED.
    expect(CHECKER_CODE).toContain('const notAttempted = enumerated.filter');
  });

  it('la liste UNCOVERED est NOMMÉE, et son contenu est une décision consignée', () => {
    // ADR-045 §D3 : ce n'est PAS une liste d'exemption, c'est une moitié
    // d'égalité. Elle était VIDE jusqu'à `S-E01-1b` ; elle porte maintenant DEUX
    // noms, et l'en-tête doit dire pourquoi POUR CHACUN, sinon un futur lecteur y
    // ajoutera un troisième pour faire disparaître un rouge.
    expect(Array.isArray(checker.UNCOVERED_EXPECTED)).toBe(true);
    expect(CHECKER).toContain('It holds EXACTLY TWO NAMES today, and that is a measurement rather than an');
    expect(CHECKER).toContain('never a way to make a red go away');
    // Chaque nom porte sa raison DANS l'en-tête, jamais dans un commentaire de
    // ligne qu'une relecture rapide saute.
    for (const table of checker.UNCOVERED_EXPECTED) {
      expect(CHECKER).toContain(`\`${table}\``);
    }
  });

  it('le PLANCHER DE NON-VACUITÉ existe, et il est un MINIMUM (pas une attente)', () => {
    // Une attente exacte rougirait à la première table ajoutée au schéma ; un
    // plancher ne rougit que quand la fixture s'effondre, ce qui est le défaut.
    expect(checker.MIN_COVERED_TABLES).toBeGreaterThanOrEqual(40);
    expect(CHECKER_CODE).toContain('covered.length < MIN_COVERED_TABLES');
    expect(CHECKER_CODE).toContain('enumerated.length < MIN_COVERED_TABLES');
    // …et il n'est jamais écrit comme un `=== 45` ni un `=== 50` : un compte en
    // dur serait satisfaisable en SUPPRIMANT une table. `50` et `51` sont dans la
    // liste depuis que `S-E01-2d` a fait passer le recensement de `44 + 5` à
    // `45 + 5` — c'est exactement le genre de nombre qu'un correctif pressé fige.
    expect(CHECKER_CODE).not.toMatch(/===\s*(?:44|45|49|50|51)\b/);
  });

  it('la preuve d’existence côté PROPRIÉTAIRE vient AVANT toute assertion de déni', () => {
    // Failure mode 1 : une table sans ligne du tenant B rend SELECT/UPDATE/DELETE
    // tous à 0 — trois dénis verts sur une table vide.
    const seedAt = CHECKER_CODE.indexOf('seedCensusSql()');
    const writeAt = CHECKER_CODE.indexOf('writeSql(writePlanner)');
    expect(seedAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(seedAt);
  });
});

describe('AC-11 — les contrôles POSITIFS précèdent leurs dénis, partout', () => {
  it('dans le SQL généré : la lecture propre est planifiée avant la lecture étrangère', () => {
    const ownAt = CHECKER_CODE.indexOf('`SEL_A_OWN_${entry.table}`');
    const foreignAt = CHECKER_CODE.indexOf('`SEL_A_FGN_${entry.table}`');
    expect(ownAt).toBeGreaterThan(-1);
    expect(foreignAt).toBeGreaterThan(ownAt);
  });

  it('dans les assertions : chaque paire ouvre par POSITIVE CONTROL', () => {
    for (const marker of [
      "AC-3 POSITIVE CONTROL GUC=A: A's own ${table} row IS visible",
      'AC-3 POSITIVE CONTROL GUC=A: an OWN-tenant INSERT into ${entry.table} is ACCEPTED',
      "AC-3 POSITIVE CONTROL GUC=A: an UPDATE of A's own ${entry.table} row affects 1 row",
      "AC-3 POSITIVE CONTROL GUC=A: a DELETE of A's own ${entry.table} row affects 1 row",
    ]) {
      expect(CHECKER_CODE).toContain(marker);
    }
    // …et l'ordre du CODE D'ASSERTION (et non celui de la génération SQL, où les
    // deux étiquettes apparaissent aussi) : `INS_A_OWN` est asserté avant
    // `INS_A_FGN`. Les deux ancres portent l'argument qui suit l'étiquette, ce qui
    // est ce qui distingue le site d'assertion du site de génération.
    const insOwn = CHECKER_CODE.indexOf('`INS_A_OWN_${entry.table}`,\n          1,');
    const insFgn = CHECKER_CODE.indexOf(
      '`INS_A_FGN_${entry.table}`,\n          SQLSTATE_INSUFFICIENT_PRIVILEGE,',
    );
    expect(insOwn).toBeGreaterThan(-1);
    expect(insFgn).toBeGreaterThan(insOwn);
  });

  it('« permission denied » dans un chemin de contrôle positif est un ÉCHEC BRUYANT', () => {
    // C'est le faux vert exact que ce fichier existe pour refuser : `app_user`
    // n'avait AUCUN privilège avant la migration RLS, donc « les lignes étrangères
    // sont invisibles » seul aurait été vert sur une base sans policy.
    expect(CHECKER_CODE).toContain('which is a MISSING GRANT and never evidence of isolation');
    expect(CHECKER_CODE).toMatch(/permission denied\/i\.test\(identityRun\.stderr\)/);
    expect(CHECKER_CODE).toMatch(/permission denied\/i\.test\(readRun\.stderr\)/);
  });

  it('un 42501 n’est JAMAIS lu comme un déni : l’attendu vient de role_table_grants', () => {
    // Failure mode 3. Sept tables ne portent pas DELETE et trois ne portent pas
    // UPDATE : attraper l'erreur et la compter comme « refusé » laisserait la
    // suite verte sur une base à ZÉRO policy.
    expect(CHECKER_CODE).toContain("held.has('UPDATE')");
    expect(CHECKER_CODE).toContain("held.has('DELETE')");
    expect(CHECKER_CODE).toContain("held.has('INSERT')");
    expect(CHECKER_CODE).toContain('function expectSqlState');
    // …et la classification se fait par SQLSTATE, jamais par le TEXTE du message,
    // qui dépend de la locale (DNC-10).
    expect(checker.SQLSTATE_INSUFFICIENT_PRIVILEGE).toBe('42501');
    expect(CHECKER_CODE).toContain('probe.state !== expected');
    expect(CHECKER_CODE).not.toMatch(/state\s*(?:===|!==)\s*['"]permission denied/);
  });

  it('la MATRICE DE PRIVILÈGES elle-même est assertée, donc un grant ÉLARGI échoue', () => {
    // Sans ça, un GRANT DELETE ajouté par erreur à `audit_log` ferait simplement
    // BASCULER une assertion « refusé 42501 » en assertion « 0 ligne » — et les
    // deux sont vertes. C'est la seule direction qui blesse vraiment.
    expect(CHECKER_CODE).toContain('the privilege matrix equals the CLOSED set');
    expect(CHECKER_CODE).toContain('expectedMatrix');
    expect(checker.APPEND_ONLY_TABLES).toEqual(['audit_log', 'conversation_message']);
    expect(checker.FULL_DML).toBe('DELETE|INSERT|SELECT|UPDATE');
    expect(checker.APPEND_ONLY_DML).toBe('INSERT|SELECT');
  });

  it('la matrice couvre la SURFACE DE RÉFÉRENCE de `S-E01-1b`, et par des groupes NOMMÉS', () => {
    // `S-E01-1b` accorde `SELECT` à `app_user` sur `tenant`, `permission` et
    // `_prisma_migrations`. La matrice était `tenantTables ∪ DERIVED_TABLES` — un
    // ensemble qui, jusqu'à ce slice, ÉTAIT la totalité des grants. Trois entrées
    // mesurées en plus font échouer une ÉGALITÉ d'ensembles, et la réparation
    // localement la moins chère (passer à une inclusion) supprimerait la seule
    // chose qui rend `GRANT … ON ALL TABLES IN SCHEMA public` impossible à livrer.
    expect(CHECKER_CODE).toContain('...autoDiscriminant.map(');
    expect(CHECKER_CODE).toContain('...referencePresent.map(');
    expect(sibling.AUTO_DISCRIMINANT_PRIVILEGES).toBe('SELECT');
    expect(sibling.REFERENCE_PRIVILEGES).toBe('SELECT');
    expect([...sibling.REFERENCE_SURFACE].sort()).toEqual(['_prisma_migrations', 'permission']);
    // …et les deux constantes viennent du frère, jamais re-tapées ici.
    expect(CHECKER_CODE).toContain('AUTO_DISCRIMINANT_PRIVILEGES');
    expect(CHECKER_CODE).toContain('REFERENCE_PRIVILEGES');
    expect(CHECKER_CODE).not.toMatch(/AUTO_DISCRIMINANT_PRIVILEGES\s*=\s*'/);
    expect(CHECKER_CODE).not.toMatch(/REFERENCE_PRIVILEGES\s*=\s*'/);
    // L'égalité reste une ÉGALITÉ : aucune direction n'est relâchée.
    expect(CHECKER_CODE).toContain('expectSetEqual(');
    expect(CHECKER_CODE).not.toMatch(/expectSubsetOf|expectSupersetOf/);
    // `_prisma_migrations` est ABSENTE de cette base scratch (le ledger est
    // appliqué par psql, la CLI Prisma ne tourne pas) : sa présence est MESURÉE,
    // jamais supposée, sinon la matrice attend un grant qui n'existe pas.
    expect(CHECKER_CODE).toContain("REFERENCE_PRESENT|");
  });

  it('une étiquette MANQUANTE est un ÉCHEC DUR, jamais un zéro', () => {
    // Failure mode 2 : dans une session `ON_ERROR_STOP=0`, un rejet attendu
    // avorte la transaction et tout le reste rend 25P02 SANS AUCUNE SORTIE. Un
    // parseur qui lit « étiquette absente » comme 0 marque tout le reste PASS.
    expect(CHECKER_CODE).toContain('function readProbes');
    expect(CHECKER_CODE).toContain('emitted NOTHING, which a naive parser would read as');
    expect(CHECKER_CODE).toContain('planner.planned.filter');
    // Et le mécanisme qui rend l'avortement impossible : un SAVEPOINT implicite
    // par instruction, via le bloc EXCEPTION de plpgsql.
    expect(CHECKER_CODE).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(CHECKER_CODE).toContain('SQLSTATE');
  });

  it('le harnais de sonde est SECURITY INVOKER, écrit explicitement', () => {
    // Un `SECURITY DEFINER` ici exécuterait CHAQUE sonde comme le PROPRIÉTAIRE et
    // transformerait toute la suite en preuve sur le mauvais rôle — verte, et
    // parlant d'autre chose.
    expect(CHECKER_CODE).toContain('CREATE OR REPLACE FUNCTION public.adv_exec');
    expect(CHECKER_CODE).toContain('CREATE OR REPLACE FUNCTION public.adv_count');
    expect((CHECKER_CODE.match(/SECURITY INVOKER/g) ?? []).length).toBe(2);
    expect(CHECKER_CODE).not.toMatch(/SECURITY\s+DEFINER/);
  });
});

describe('AC-1b / AC-5 / AC-6 — qui, sans contexte, et la limite honnête', () => {
  it('il prouve AS QUI il s’est connecté avant la moindre assertion de visibilité', () => {
    const identityAt = CHECKER_CODE.indexOf('AC-1b the connection under test owns ZERO');
    const visibilityAt = CHECKER_CODE.indexOf("AC-3 POSITIVE CONTROL GUC=A: A's own ${table} row IS visible");
    expect(identityAt).toBeGreaterThan(-1);
    expect(visibilityAt).toBeGreaterThan(identityAt);
    expect(CHECKER_CODE).toContain('AC-1b the connection under test does not carry BYPASSRLS');
    expect(CHECKER_CODE).toContain('is NOT the owner named by DATABASE_URL');
  });

  it('les TROIS états sans GUC sont distincts et tous asserts (AC-5)', () => {
    // (i) connexion fraîche : le GUC est NULL. (ii) poolée : il vaut '' après un
    // `set_config(…, true)` COMMITé — l'état de RÉGIME de toute connexion Prisma.
    // (iii) '' posé explicitement. Les trois, sur les tables porteuses ET dérivées.
    expect(CHECKER_CODE).toContain('AC-5 state (i)');
    expect(CHECKER_CODE).toContain('AC-5 state (ii)');
    expect(CHECKER_CODE).toContain('AC-5 state (iii)');
    expect(CHECKER_CODE).toContain("POOLED_IS_NULL");
    expect(CHECKER_CODE).toContain('this is why the');
  });

  it('la LIMITE d’AC-6 est une assertion POSITIVE de la fuite, pas un commentaire', () => {
    // Une mise en garde imprimée ne rougit jamais. Une assertion que la fuite est
    // PRÉSENTE rougit le jour où `FORCE ROW LEVEL SECURITY` atterrit — et ce
    // jour-là l'application, qui se connecte comme ce rôle, rend zéro ligne.
    expect(CHECKER_CODE).toContain('OWNER_CTX_A_FOREIGN_');
    expect(CHECKER_CODE).toContain('AC-6 THE APPLICATION IS NOT ISOLATED');
    expect(CHECKER_CODE).toContain('the owner-bypass limit is PRESENT and asserted as present');
    // …et une fuite ABSENTE est un ÉCHEC, jamais un pass.
    expect(CHECKER_CODE).toContain('Both are failures of this assertion, and neither is a pass.');
  });

  it('la phrase d’honnêteté est imprimée sur le chemin VERT, dans la BANNIÈRE', () => {
    // ADR-045 §D5 : le vocabulaire de verdict ne contient AUCUN « isolated » nu.
    expect(CHECKER_CODE).toContain(
      'TENANT ADVERSARIAL SUITE: the NON-OWNER role IS isolated — the APPLICATION IS NOT (it connects as the owner)',
    );
    const successBranch = CHECKER_CODE.slice(CHECKER_CODE.indexOf("if (verdict === 'isolated') {"));
    expect(successBranch).toContain('WHAT THIS DOES NOT SAY');
    expect(successBranch).toContain('CONNECTION CUTOVER');
  });

  it('aucune distinction n’est portée par la COULEUR (un log CI non-TTY la retire)', () => {
    // Une séquence ANSI rendrait pass / fail / LIMIT indiscernables dans un log CI
    // non-TTY, qui les retire. Les trois marqueurs sont donc TEXTUELS.
    //
    // Les DEUX formes sont cherchées : l'octet ESC brut, et son échappement source.
    // L'octet est CONSTRUIT et jamais écrit ici — un caractère de contrôle brut dans
    // un fichier source est illisible en revue et invisible en diff.
    const ESC = String.fromCharCode(27);
    const ESCAPED = ['u001b', 'x1b', '033'].map((form) => `\\${form}[`);
    expect(CHECKER).not.toContain(ESC);
    for (const form of ESCAPED) expect(CHECKER).not.toContain(form);
    // La direction qui échoue échoue bien : sans elle, les lignes ci-dessus seraient
    // vertes sur un fichier vide comme sur un fichier colorisé.
    expect(`${ESC}[32mgreen`).toContain(ESC);
    expect(ESCAPED[0]).toBe('\\u001b[');
    expect(`console.log('${ESCAPED[0]}32m')`).toContain(ESCAPED[0]);
    expect(CHECKER_CODE).toContain('[OK]');
    expect(CHECKER_CODE).toContain('[FAIL]');
    expect(CHECKER_CODE).toContain('[LIMIT]');
  });

  it('AC-9 — un vert ne s’imprime pas sans le bloc CUTOVER READINESS', () => {
    // PF-02 un cran plus bas : la preuve est VRAIE et la conclusion « on peut
    // basculer » est FAUSSE. `withTenant` a ZÉRO appelant de production, donc
    // AC-5 (« pas de GUC ⇒ zéro ligne ») décrit la PANNE, pas la sûreté.
    expect(CHECKER_CODE).toContain('function cutoverReadiness');
    expect(CHECKER_CODE).toContain('AC-9 CUTOVER READINESS');
    expect(CHECKER_CODE).toContain('THE APPLICATION IS NOT READY TO CUT OVER');
    expect(CHECKER_CODE).toContain('.withTenant\\s*\\(');
    // …et la moitié « tables non accordées atteintes par du code de production ».
    expect(CHECKER_CODE).toContain('UNGRANTED');
    expect(CHECKER_CODE).toContain('prismaModelName');
    expect(checker.prismaModelName('outbox_event')).toBe('outboxEvent');
    expect(checker.prismaModelName('role_permission')).toBe('rolePermission');
    expect(checker.prismaModelName('role')).toBe('role');
  });
});

describe('AC-7 — la destruction, et l’escalade de privilège qui est INTERDITE', () => {
  it('le motif de nom scratch est le SIEN, et il rejette la base vivante', () => {
    // Deux motifs différents : ni ce check ni son frère ne peut détruire la base
    // scratch de l'autre quand les deux tournent en parallèle.
    expect(checker.SCRATCH_NAME_PATTERN.source).toBe('^tenant_adversarial_\\d+_\\d+$');
    expect(checker.SCRATCH_NAME_PATTERN.source).not.toBe(sibling.SCRATCH_NAME_PATTERN.source);
    // La direction qui compte : le nom de la base VIVANTE est refusé.
    expect(checker.SCRATCH_NAME_PATTERN.test('pilotage')).toBe(false);
    expect(checker.SCRATCH_NAME_PATTERN.test('postgres')).toBe(false);
    expect(checker.SCRATCH_NAME_PATTERN.test('rls_isolation_1_2')).toBe(false);
    expect(checker.SCRATCH_NAME_PATTERN.test('tenant_adversarial_123_456')).toBe(true);
  });

  it('le motif est vérifié AVANT le DROP, et l’égalité avec la source est refusée', () => {
    const dropAt = CHECKER_CODE.indexOf('DROP DATABASE IF EXISTS');
    const guardAt = CHECKER_CODE.lastIndexOf('SCRATCH_NAME_PATTERN.test(scratchName)', dropAt);
    expect(dropAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(dropAt);
    expect(CHECKER_CODE).toContain('scratchName === owner.database');
  });

  it('LA CHAÎNE INTERDITE : aucun `pg_signal_backend`, aucune escalade, nulle part', () => {
    // C'est le cœur d'AC-7. Acheter un teardown vert avec
    // `GRANT pg_signal_backend TO pilotage` serait une escalade de privilège
    // PERMANENTE pour le rôle exact dont la bascule parle. MESURÉ : `pilotage` est
    // rolsuper=false, rolbypassrls=false et membre d'AUCUN rôle, donc la branche
    // « terminate puis retry » du frère est INERTE pour le cas même qu'elle vise.
    expect(CHECKER_CODE).not.toMatch(/GRANT\s+pg_signal_backend/i);
    expect(CHECKER_CODE).not.toMatch(/ALTER\s+ROLE\s+\w+\s+SUPERUSER/i);
    expect(CHECKER_CODE).not.toMatch(/pg_terminate_backend/i);
    // La direction qui échoue échoue bien — sinon les trois lignes ci-dessus
    // seraient vertes sur un fichier vide.
    expect('GRANT pg_signal_backend TO pilotage;').toMatch(/GRANT\s+pg_signal_backend/i);
    expect('SELECT pg_terminate_backend(pid) FROM pg_stat_activity;').toMatch(/pg_terminate_backend/i);
  });

  it('le teardown est un SONDAGE BORNÉ de quiescence, et son épuisement est un ÉCHEC', () => {
    expect(checker.QUIESCE_ATTEMPTS).toBeGreaterThan(0);
    expect(checker.QUIESCE_ATTEMPTS).toBeLessThanOrEqual(200);
    expect(CHECKER_CODE).toContain('pg_stat_activity');
    expect(CHECKER_CODE).toContain('pid <> pg_backend_pid()');
    expect(CHECKER_CODE).toContain('AC-7 the scratch database quiesced before the drop');
    // …et l'échec du DROP n'est jamais avalé.
    expect(CHECKER_CODE).toContain('AC-7 the scratch database was dropped');
  });

  it('la garde `createdRole` est portée : un rôle préexistant n’est JAMAIS supprimé', () => {
    // Les rôles sont de l'état CLUSTER : c'est la seule action de teardown qu'une
    // base scratch ne défait pas. `app_user` EXISTE sur la machine de dev et
    // porte `.env:DATABASE_URL_APP` — un DROP inconditionnel casserait
    // l'environnement vivant et tous les runs suivants.
    expect(CHECKER_CODE).toContain('let createdRole = false;');
    expect(CHECKER_CODE).toContain('createdRole = true;');
    expect(CHECKER_CODE).toContain('if (createdRole) {');
    const dropRoleAt = CHECKER_CODE.indexOf('DROP ROLE IF EXISTS');
    const guardAt = CHECKER_CODE.lastIndexOf('if (createdRole) {', dropRoleAt);
    expect(dropRoleAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(dropRoleAt);
  });
});

describe('AC-8 — la mutation est INCONDITIONNELLE, contenue, et elle assertit un FAIT précis', () => {
  it('elle n’est ni un drapeau ni une variable (DNC-10)', () => {
    // Un `--weaken` ou un `VAL02_MUTATE=1` serait littéralement « un nouveau
    // drapeau qui laisse un appelant choisir ce qui est comparé ».
    expect(CHECKER_CODE).not.toMatch(/--weaken|MUTATE|mutationEnabled/);
    expect(CHECKER_CODE).toContain('const weakened = psql(');
  });

  it('le SQL LUI-MÊME vérifie qu’il est sur une base scratch avant de muter', () => {
    // Un objet cible côté JS ne suffit pas pour une instruction qui éteint un
    // contrôle de sécurité.
    expect(CHECKER_CODE).toContain("current_database() !~ '^tenant_adversarial_'");
    expect(CHECKER_CODE).toContain('RAISE EXCEPTION');
    expect(CHECKER_CODE).toContain('const guardedMutation = (statement)');
  });

  it('elle tourne APRÈS la preuve principale et ne fait qu’AJOUTER ses assertions', () => {
    const proofAt = CHECKER_CODE.indexOf('AC-6 the owner case really ran as the owner');
    const mutationAt = CHECKER_CODE.indexOf('const weakened = psql(');
    expect(proofAt).toBeGreaterThan(-1);
    expect(mutationAt).toBeGreaterThan(proofAt);
    // Elle ne peut PAS transformer un rouge en vert. Deux moitiés :
    //  (a) `failures` est `const`, donc non réassignable — c'est le moteur qui le
    //      garantit, pas ce spec ;
    //  (b) et aucune forme de vidage en place n'apparaît.
    expect(CHECKER_CODE).toContain('const failures = [];');
    expect(CHECKER_CODE).not.toMatch(/failures\.length\s*=\s*\d|failures\.splice\(/);
    // La direction qui échoue échoue bien — sinon (b) serait verte sur un vide.
    expect('failures.length = 0;').toMatch(/failures\.length\s*=\s*\d|failures\.splice\(/);
    expect('failures.splice(0);').toMatch(/failures\.length\s*=\s*\d|failures\.splice\(/);
    expect('report(failures.length === 0 ? "isolated" : "not_isolated")').not.toMatch(
      /failures\.length\s*=\s*\d|failures\.splice\(/,
    );
  });

  it('elle assertit un FAIT PRÉCIS qui BASCULE, pas « le compte d’échecs a monté »', () => {
    // Un compteur global est satisfait par n'importe quelle casse sans rapport —
    // DNC-08 commis par le correctif.
    expect(CHECKER_CODE).toContain('MUT_FOREIGN_school');
    expect(CHECKER_CODE).toContain('red.rows >= 1');
    expect(CHECKER_CODE).toContain('green.rows === 0');
    expect(CHECKER_CODE).toContain('MUTANT_KILLED');
    // Et l'absence de bascule est un ÉCHEC NOMMÉ : l'assertion validée est morte.
    expect(CHECKER_CODE).toContain('The assertion it was validating is DEAD');
  });

  it('l’affaiblissement est EXACTEMENT réversible sans réécrire le prédicat', () => {
    // Re-créer une policy supprimée exigerait de réécrire son expression ICI :
    // une SECONDE source de vérité pour l'expression même que la suite vérifie.
    expect(CHECKER_CODE).toContain('DISABLE ROW LEVEL SECURITY');
    expect(CHECKER_CODE).toContain('ENABLE ROW LEVEL SECURITY');
    expect(CHECKER_CODE).not.toMatch(/CREATE POLICY/);
  });
});

describe('AC-4 — SEPT tables dérivées depuis S-E01-1b, CINQ prouvées ici, et le chemin FK dans les DEUX sens', () => {
  it('le jeu prouvé est exactement celui que le frère nomme MOINS les non-couvertes NOMMÉES', () => {
    // Deux littéraux pour un même jeu, c'est la dérive qu'ADR-042 §D3 interdit.
    expect(CHECKER_CODE).toContain('DERIVED_TABLES');
    // Le littéral RESTE, et il est le cliquet : `S-E01-1b` a fait entrer `role`
    // (sa FK `role_school_id_fkey` est enfin matérialisée) puis `role_permission`
    // (le résidu à DEUX sauts, invisible à une dérivation d'un seul niveau). Une
    // huitième entrée arrivée en silence échoue ICI, avec son nom imprimé.
    expect(sibling.DERIVED_TABLES.map((d) => d.child).sort()).toEqual([
      'announcement_receipt',
      'branding',
      'grade_revision',
      'import_row',
      'role',
      'role_permission',
      'user_role',
    ]);
    // La partition, DÉRIVÉE dans les deux sens plutôt que re-tapée : ce que
    // `PLAN` prouve, c'est exactement le jeu du frère PRIVÉ des noms qu'
    // `UNCOVERED_EXPECTED` déclare non prouvés ici. Retirer un nom de la liste
    // sans ajouter la table à `PLAN` rougit, et l'inverse aussi.
    const derivedInPlan = checker.PLAN.filter((entry) => entry.derived).map((entry) => entry.table).sort();
    const provenHere = sibling.DERIVED_TABLES.map((d) => d.child)
      .filter((child) => !checker.UNCOVERED_EXPECTED.includes(child))
      .sort();
    expect(derivedInPlan).toEqual(provenHere);
    expect(derivedInPlan).toHaveLength(5);
  });

  it('les DEUX dérivées non couvertes sont NOMMÉES, et la raison est le grant `SELECT` seul', () => {
    // ADR-046 §D5 : `role` et `role_permission` sont des données de PRIVILÈGE,
    // donc `SELECT` et rien d'autre. Or la branche INSERT du vérificateur est un
    // ÉCHEC DUR quand le grant manque — délibérément, parce qu'une table qu'il ne
    // peut pas écrire rendrait ses dénis vacueux. Les mettre dans `PLAN`
    // exigerait de RELÂCHER cette branche : une protection réelle échangée
    // contre un chiffre de couverture. Elles sont prouvées PAR EXÉCUTION dans le
    // frère, ce que la note d'en-tête doit dire noir sur blanc.
    expect([...checker.UNCOVERED_EXPECTED].sort()).toEqual(['role', 'role_permission']);
    for (const table of ['role', 'role_permission']) {
      const entry = sibling.DERIVED_TABLES.find((d) => d.child === table);
      expect(entry?.privileges).toBe('SELECT');
      expect(checker.PLAN.some((planned) => planned.table === table)).toBe(false);
    }
    // …et la liste n'est PAS devenue une liste d'exemption : la phrase qui
    // l'interdit reste, et l'en-tête nomme désormais le frère qui les prouve.
    expect(CHECKER).toContain('never a way to make a red go away');
    expect(CHECKER).toContain('proven BY EXECUTION in the');
  });

  it('la dérivation elle-même est IMPORTÉE du frère, pas ré-écrite en SQL local', () => {
    // C'EST LE DÉFAUT QUE CE RUN A PAYÉ. Ce fichier portait sa PROPRE requête de
    // recensement, à UN SEUL niveau : elle s'accordait avec `DERIVED_TABLES`
    // uniquement tant qu'aucune table dérivée n'avait elle-même un enfant dérivé.
    // `role_permission` est cet enfant — 6 contre 7 — et le rouge serait apparu
    // au MERGE, pas sur le diff qui l'a causé.
    expect(CHECKER_CODE).toContain('DERIVED_SET_SQL');
    expect(CHECKER_CODE).toContain('AUTO_DISCRIMINANT_SQL');
    expect(sibling.DERIVED_SET_SQL).toContain('WITH RECURSIVE');
    // La requête locale d'un seul niveau ne doit pas revenir : elle se
    // reconnaît à son `string_agg(DISTINCT child.relname` sur `pg_constraint`.
    expect(CHECKER_CODE).not.toContain("string_agg(DISTINCT child.relname");
  });

  it('`outbox_event` a REJOINT le régime ordinaire : prouvé sur quatre verbes, plus « fail-closed »', () => {
    // CES SIX ASSERTIONS SONT INVERSÉES, PAS SUPPRIMÉES. Elles disaient
    // exactement le contraire tant que `S-E01-2d` n'avait pas atterri :
    // `outbox_event` ne détenait aucun discriminant, aucune policy et aucun grant,
    // donc la seule chose démontrable était son « permission denied ». `ADR-044`
    // lui a donné un `tenant_id` DÉNORMALISÉ, une policy et
    // `SELECT, INSERT, UPDATE` — donc la sonde fail-closed est devenue FAUSSE, et
    // un « permission denied » sur cette table serait désormais un GRANT MANQUANT,
    // c'est-à-dire le faux vert que tout le reste du fichier refuse. Les garder
    // côte à côte aurait asserté les deux moitiés d'une contradiction.
    expect(checker.PLAN.some((entry) => entry.table === 'outbox_event')).toBe(true);
    expect(CHECKER_CODE).not.toContain('OUTBOX_SQL');
    expect(CHECKER_CODE).not.toContain('is FAIL-CLOSED by execution');
    expect(CHECKER_CODE).not.toMatch(/const outboxRun = psql\(/);
    // Ce qui RESTE vrai d'`ADR-042 §D7`, et qui est la raison pour laquelle la
    // table n'est toujours pas DÉRIVÉE : `aggregate_id` n'est contraint par rien.
    expect(CHECKER).toContain('NO foreign key at all');
    // Le `DELETE` retenu par `ADR-044 §D3` : la matrice le NOMME, donc un grant
    // élargi en silence ÉCHOUE au lieu de faire basculer une assertion vers l'autre.
    expect(checker.OUTBOX_DML).toBe('INSERT|SELECT|UPDATE');
    expect(checker.OUTBOX_DML).not.toContain('DELETE');
    // …et il vient du frère, jamais re-tapé (deux littéraux pour un grant = ADR-042 §D3).
    expect(CHECKER_CODE).toContain('OUTBOX_PRIVILEGES');
    expect(CHECKER_CODE).not.toMatch(/OUTBOX_DML\s*=\s*'/);
  });

  it('les DEUX formes sont couvertes : la FK-qui-est-la-PK et une clé de substitution', () => {
    const branding = checker.PLAN.find((entry) => entry.table === 'branding');
    expect(branding?.key).toBe('school_id');
    const receipt = checker.PLAN.find((entry) => entry.table === 'announcement_receipt');
    expect(receipt?.key).toBe('id');
    // Le parent SANS ENFANT, pour que l'INSERT à parent étranger échoue pour
    // exactement UNE raison : la policy, et non l'index unique.
    expect(checker.SPARE_PARENTS).toContain('school2');
    expect(checker.SPARE_PARENTS).toContain('announcement2');
    expect(CHECKER).toContain('CHILDLESS');
  });

  it('la direction MIROIR (GUC = B) existe, sinon « tout refuser » passerait', () => {
    expect(CHECKER_CODE).toContain('`SEL_B_OWN_${entry.table}`');
    expect(CHECKER_CODE).toContain('`SEL_B_FGN_${entry.table}`');
    expect(CHECKER_CODE).toContain('AC-4 MIRRORED GUC=B');
  });

  it('le tenant A porte de l’hex MAJUSCULE, et les deux ids sont DISJOINTS du frère', () => {
    // PostgreSQL rend un `uuid` en minuscules : un prédicat en `tenant_id::text =
    // current_setting(…)` matcherait ZÉRO ligne pour ce tenant — fail-closed, et
    // totalement invisible. Parce que A est en majuscules, le sens du cast est
    // EXÉCUTÉ ici, pas simplement asserté sur du texte.
    expect(checker.TENANT_A).toMatch(/[A-F]/);
    expect(checker.TENANT_A).not.toBe(sibling.TENANT_A);
    expect(checker.TENANT_B).not.toBe(sibling.TENANT_B);
    expect(checker.SLOT_A).not.toBe(checker.SLOT_B);
  });

  it('il nomme le MÊME GUC que le TypeScript, en le lisant du frère', () => {
    expect(sibling.TENANT_GUC).toBe(TENANT_GUC);
    expect(CHECKER_CODE).toContain('TENANT_GUC');
    // Deux littéraux pour un seul nom de GUC : la dérive qu'ADR-042 §D3 interdit.
    expect(CHECKER_CODE).not.toContain(`'${TENANT_GUC}'`);
  });

  it('le frère est REQUIS et JAMAIS édité (contrainte dure 2 de la story)', () => {
    expect(CHECKER_CODE).toMatch(/require\(\s*'\.\/rls-isolation-check'\s*\)/);
    // La chaîne assertée est celle que l'en-tête PORTE (`:129`), et pas une
    // paraphrase : une assertion sur une phrase absente est verte le jour où on la
    // corrige et rouge sans rien dire de vrai le reste du temps.
    expect(CHECKER).toContain('never edited (hard constraint 2)');
  });
});

describe('AC-12 — le stage est CÂBLÉ dans `ci-gate.sh` ET dans `ci.yml`, qui ne s’appellent pas', () => {
  const GATE_SH = lf(readFileSync(join(REPO_ROOT, 'scripts', 'ci-gate.sh'), 'utf8'));
  const CI_YML = lf(readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const stripShellComments = (source: string): string => source.replace(/^\s*#.*$/gm, '');
  const stripYamlComments = (source: string): string => source.replace(/^\s*#.*$/gm, '');

  it('un stage COMMENTÉ ne satisfait pas l’ancrage (la direction qui échoue)', () => {
    expect(stripShellComments('  # run_stage 300 "x" node scripts/tenant-adversarial-check.js')).not.toContain(
      'tenant-adversarial-check.js',
    );
    expect(stripShellComments('  run_stage 300 "x" node scripts/tenant-adversarial-check.js')).toContain(
      'tenant-adversarial-check.js',
    );
  });

  it('`ci-gate.sh` le lance, avec une borne numérique (TOOL-06)', () => {
    expect(stripShellComments(GATE_SH)).toMatch(
      /run_stage\s+\d+\s+"tenant adversarial"\s+node\s+scripts\/tenant-adversarial-check\.js/,
    );
  });

  it('il a son PROPRE déclencheur, jamais imbriqué sous `^apps/api/prisma/`', () => {
    // La bascule S-E01-1 — le diff que cette suite existe pour protéger — touche
    // `.env` et `prisma.service.ts`, et RIEN sous `apps/api/prisma/`. Un stage
    // copié sur le déclencheur du garde RLS ne tournerait PAS sur ce diff-là.
    // Et TOOL-27 rend le stage voisin intermittent : un voisin instable ne doit
    // pas pouvoir colorer ce verdict.
    const code = stripShellComments(GATE_SH);
    const stageAt = code.indexOf('scripts/tenant-adversarial-check.js');
    const rlsAt = code.indexOf('scripts/rls-isolation-check.js');
    expect(stageAt).toBeGreaterThan(-1);
    expect(rlsAt).toBeGreaterThan(-1);
    // Le stage n'est pas dans le même bloc `if` : il est APRÈS le `fi` qui ferme
    // celui du garde RLS.
    const fiAt = code.indexOf('\n  fi', rlsAt);
    expect(fiAt).toBeGreaterThan(rlsAt);
    expect(stageAt).toBeGreaterThan(fiAt);
    // …et son déclencheur nomme la couture d'identité.
    expect(code).toContain('apps/api/src/shared/prisma/');
    expect(code).toContain('scripts/tenant-adversarial-check\\.js');
  });

  it('la branche `else` porte un `skip_stage` correspondant', () => {
    // Sans lui, un diff qui ne déclenche pas le stage ne dit rien du tout, et
    // « pas exécuté » devient indiscernable de « passé ».
    expect(stripShellComments(GATE_SH)).toMatch(/skip_stage\s+"tenant adversarial"/);
  });

  it('`ci.yml` le lance AUSSI — il re-liste les stages, il n’appelle pas `ci-gate.sh`', () => {
    // Sans cette moitié, un stage ajouté au seul `ci-gate.sh` ne tournerait JAMAIS
    // en CI (S-E02-2 AC-4).
    expect(CI_YML).not.toContain('bash scripts/ci-gate.sh');
    expect(stripYamlComments(CI_YML)).toContain('- run: node scripts/tenant-adversarial-check.js');
    // …et le rôle non-propriétaire est fourni au job.
    expect(stripYamlComments(CI_YML)).toMatch(/DATABASE_URL_APP:\s*postgresql:\/\/app_user/);
  });

  it('les deux portent la note anti-dérive que chaque stage frère porte', () => {
    const shellStage = GATE_SH.slice(Math.max(0, GATE_SH.indexOf('run_stage 300 "tenant adversarial"') - 1600));
    expect(shellStage).toContain('the two must not drift');
    const ymlStep = CI_YML.slice(Math.max(0, CI_YML.indexOf('- run: node scripts/tenant-adversarial-check.js') - 1600));
    expect(ymlStep).toContain('the two must not drift');
  });

  it('aucun `continue-on-error` ne le rend décoratif', () => {
    const step = CI_YML.slice(CI_YML.indexOf('- run: node scripts/tenant-adversarial-check.js'));
    expect(step.slice(0, 200)).not.toContain('continue-on-error');
  });
});

describe('Règle ADR — une citation qui ne résout pas est pire que pas de citation', () => {
  const ADR_DIR = join(REPO_ROOT, 'docs', 'adr');
  const ADR_NUMBERS = new Set(
    readdirSync(ADR_DIR)
      .map((name) => /^ADR-(\d{3})-/.exec(name)?.[1])
      .filter((n): n is string => Boolean(n)),
  );
  const cited = (source: string): string[] => [
    ...new Set([...source.matchAll(/ADR-(\d{3})/g)].map((m) => m[1] as string)),
  ];

  it('le registre lu n’est pas vide, et la direction qui échoue échoue bien', () => {
    expect(ADR_NUMBERS.size).toBeGreaterThanOrEqual(20);
    // `000` est RÉSERVÉ par construction : la numérotation commence à `001`, donc
    // ce contrôle négatif ne prend en otage aucun numéro futur.
    expect(ADR_NUMBERS.has('000')).toBe(false);
    expect(cited('voir ADR-000 D1')).toEqual(['000']);
  });

  it('le vérificateur ne cite QUE des ADR qui existent dans docs/adr/', () => {
    const numbers = cited(CHECKER);
    expect(numbers.length).toBeGreaterThan(0);
    for (const number of numbers) expect([...ADR_NUMBERS]).toContain(number);
  });

  it('ADR-045 existe, porte ses cinq décisions, et n’est pas ADR-044', () => {
    // `ADR-044` était réclamé par la branche `s-e01-2d` quand ce numéro a été
    // choisi ; elle est MAINTENANT fusionnée (`e53f2d9`), donc `ADR-044` existe
    // sur `main` et `045` reste le bon numéro — mais pour la raison inverse de
    // celle écrite ici au départ. Le mode de panne visé
    // (`project_parallel_runs_collide_on_ids`) est réel : l'allocation lit `main`
    // et pas les PR ouvertes. La boucle est fermée ci-dessous, où les DEUX numéros
    // doivent exister dans `docs/adr/`.
    expect(existsSync(ADR_PATH)).toBe(true);
    expect(ADR_NUMBERS.has('044')).toBe(true);
    expect(ADR_NUMBERS.has('045')).toBe(true);
    const adr = lf(readFileSync(ADR_PATH, 'utf8'));
    for (const heading of ['## D1 —', '## D2 —', '## D3 —', '## D4 —', '## D5 —']) {
      expect(adr).toContain(heading);
    }
    expect(adr).toContain('Supersedes nothing');
    expect(adr).toContain('ADR-032');
    expect(adr).toContain('ADR-042');
    expect(CHECKER).toContain('ADR-045');
  });
});

describe('G-TRUTH — aucune phrase du diff ne peut se lire « l’app est isolée par RLS »', () => {
  it('le vérificateur énonce la limite au lieu de la taire', () => {
    expect(CHECKER).toMatch(/APPLICATION IS NOT|NOT isolated/);
    expect(CHECKER).toMatch(/owner/i);
    expect(CHECKER).toContain('CONNECTION CUTOVER');
  });

  it('l’ADR l’énonce aussi, et nomme ce qui bloque encore la bascule', () => {
    const adr = lf(readFileSync(ADR_PATH, 'utf8'));
    expect(adr).toContain('never says the application is isolated');
    expect(adr).toContain('CUTOVER READINESS');
    expect(adr).toContain('withTenant');
  });

  /**
   * AC-9 — corrigé au land par le run 54. La première rédaction testait
   * `withTenantCallers === 0` : UN SEUL appelant sur 722 faisait donc passer la
   * ligne « prêt à basculer » au vert affirmatif, alors que 721 sites ne posent
   * toujours aucun GUC et renverraient ZÉRO LIGNE après la bascule. C'est le
   * défaut de `PF-02` lui-même, reproduit dans le bloc écrit pour le refuser.
   *
   * Les quatre cas ci-dessous sont écrits pour ÉCHOUER sur l'ancienne rédaction :
   * le cas « partiel » est celui qu'elle déclarait vert.
   */
  describe('AC-9 — la lecture « prêt à basculer » ne peut pas devenir verte sur une couverture partielle', () => {
    it('zéro appelant reste une LIMITE', () => {
      const v = checker.cutoverVerdict({ files: 223, withTenantCallers: 0, prismaCallSites: 722 });
      expect(v.kind).toBe('limit');
      expect(v.label).toContain('ZERO production callers');
      expect(v.detail).toContain('NOT READY TO CUT OVER');
    });

    it('UN appelant sur 722 reste une LIMITE — la régression que ce correctif ferme', () => {
      const v = checker.cutoverVerdict({ files: 223, withTenantCallers: 1, prismaCallSites: 722 });
      expect(v.kind).toBe('limit');
      expect(v.kind).not.toBe('ok');
      expect(v.label).toContain('PARTIAL');
      // Le nombre de sites NON couverts est nommé, pas seulement celui des couverts.
      expect(v.detail).toContain('721');
      expect(v.detail).toContain('NOT READY TO CUT OVER');
    });

    it('la couverture COMPLÈTE est la seule qui autorise le vert affirmatif', () => {
      const v = checker.cutoverVerdict({ files: 223, withTenantCallers: 722, prismaCallSites: 722 });
      expect(v.kind).toBe('ok');
      expect(v.label).toContain('every production Prisma call site');
    });

    it('une lecture de sources vide reste un ÉCHEC, jamais une limite tolérée (DNC-08)', () => {
      const v = checker.cutoverVerdict({ files: 0, withTenantCallers: 0, prismaCallSites: 0 });
      expect(v.kind).toBe('vacuous');
      expect(v.detail).toContain('vacuous');
    });
  });

  it('le vérificateur ne contient AUCUN « isolated » nu dans sa bannière de succès', () => {
    const banner = /const banner =\s*([\s\S]*?);\n/.exec(CHECKER_CODE)?.[1] ?? '';
    expect(banner.length).toBeGreaterThan(50);
    expect(banner).toContain('the APPLICATION IS NOT');
    // La direction qui échoue : une bannière nue serait détectée.
    expect("'RLS: isolated'").not.toContain('the APPLICATION IS NOT');
  });
});
