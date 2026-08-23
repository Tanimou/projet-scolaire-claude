import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { TENANT_GUC } from '../prisma/prisma.service';
// S-E01-1k / AC-5 — la liste GÉNUINEMENT IMPORTÉE, celle sur laquelle
// `appRoleVerdict` démarre. La fidélité du lecteur du gate se prouve CONTRE
// elle : sans cet import, tout ce fichier pourrait être vert sur une liste que
// personne ne charge.
import { APP_ROLE_REQUIRED_PRIVILEGES } from '../prisma/tenant-scope';

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

/**
 * Commentaires JS retirés, longueur préservée — un garde commenté ne garde rien.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ PF-220 — POURQUOI CE N'EST PLUS DEUX `.replace()` : l'ancienne forme a    │
 * │ EFFACÉ 54 305 CARACTÈRES DE CODE EXÉCUTABLE                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * L'ancienne forme était `source.replace(/\/\*[\s\S]*?\*\//g, …)`, qui ne
 * connaît pas les chaînes. `S-E01-1e` a introduit des raisons d'énumération qui
 * CITENT des globs — `apps/worker/src/` suivi de deux étoiles. Ce fragment,
 * **à l'intérieur d'une chaîne de caractères**, ouvre un faux commentaire de
 * bloc qui court jusqu'à la fermeture suivante : MESURÉ, 54 305 caractères
 * blanchis d'un coup, dont `postgresClient('psql')` à la ligne 3017.
 *
 * **La moitié bruyante n'est pas la dangereuse.** Un `toContain` sur du code
 * effacé ÉCHOUE, donc il se voit — c'est ce qui a rendu ~100 cas rouges d'un
 * coup. Mais toute assertion NÉGATIVE de ce fichier — « aucun drapeau de
 * contournement » (DNC-10), « aucune liste gelée », chaque `not.toMatch(…)` —
 * serait passée **VACUEUSEMENT VERTE**, puisque le motif interdit aurait été
 * blanchi avec le reste. Un garde dont on annule les interdits en citant un glob
 * n'est pas un garde.
 *
 * Donc : un balayage qui suit l'ÉTAT (chaîne simple, double, gabarit,
 * commentaire de ligne, commentaire de bloc) et ne blanchit que les VRAIS
 * commentaires. Longueurs et `\n` préservés comme avant, parce que plusieurs
 * assertions comparent des OFFSETS (`indexOf` de `main()` APRÈS
 * `require.main === module`).
 */
function executableJs(source: string): string {
  const out = source.split('');
  let state: 'code' | 'line' | 'block' | "'" | '"' | '`' = 'code';

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (ch === '/' && next === '*') {
        state = 'block';
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 1;
      } else if (ch === '/' && next === '/') {
        state = 'line';
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 1;
      } else if (ch === '/') {
        // LITTÉRAL REGEX, et il FAUT le sauter : `RAW_SQL_RE` (ligne 1907)
        // contient un backtick DANS une classe de caractères. Un balayage qui
        // ignore les regex y entre en état « gabarit » et se désynchronise pour
        // tout le reste du fichier — mesuré : le mot « skipped » d'un docblock
        // de la ligne 2067 survivait, parce que ce commentaire n'était plus vu
        // comme un commentaire.
        //
        // Division ou regex ? On regarde le dernier caractère SIGNIFIANT : après
        // une valeur (identifiant, chiffre, `)`, `]`) c'est une division ; sinon
        // c'est un littéral regex. C'est l'heuristique usuelle, et elle suffit
        // ici parce qu'aucune division de ce fichier n'est suivie d'un guillemet.
        let k = i - 1;
        while (k >= 0 && /\s/.test(source[k] as string)) k -= 1;
        const prev = k >= 0 ? (source[k] as string) : '';
        const isDivision = prev !== '' && /[\w$)\]]/.test(prev);
        if (!isDivision) {
          let j = i + 1;
          let inClass = false;
          for (; j < source.length; j += 1) {
            const c = source[j];
            if (c === '\\') {
              j += 1;
              continue;
            }
            if (c === '[') inClass = true;
            else if (c === ']') inClass = false;
            else if (c === '/' && !inClass) break;
            else if (c === '\n') break; // regex non terminée : on abandonne
          }
          i = j;
        }
      } else if (ch === "'" || ch === '"' || ch === '`') {
        state = ch;
      }
      continue;
    }

    if (state === 'line') {
      if (ch === '\n') state = 'code';
      else out[i] = ' ';
      continue;
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 1;
        state = 'code';
      } else if (ch !== '\n') {
        out[i] = ' ';
      }
      continue;
    }

    // Dans une chaîne : on ne blanchit RIEN, et un échappement saute le
    // caractère suivant pour qu'un `\'` ne referme pas la chaîne.
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === state) state = 'code';
  }

  return out.join('');
}

const CHECKER_CODE = executableJs(CHECKER);

/**
 * S-E01-1k — les deux formes que la clôture dérivée fait circuler, NOMMÉES une
 * seule fois : un `any` ici rendrait muettes toutes les assertions ci-dessous.
 */
interface PrismaModelNode {
  name: string;
  clientProperty: string;
  table: string | null;
  fields: Map<string, { type: string; isRelation: boolean; list: boolean; optional: boolean }>;
  relations: Map<string, string>;
  compoundKeys: Map<string, string[]>;
}
interface DerivedPair {
  table: string;
  privilege: string;
  origin: 'root' | 'relation' | 'policy';
  example: string;
  via: string | null;
  hits: number;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const checker = require(CHECKER_PATH) as {
  APPEND_ONLY_TABLES: readonly string[];
  APPEND_ONLY_DML: string;
  FULL_DML: string;
  MIN_COVERED_TABLES: number;
  // S-E01-1c / TOOL-32 — the verb-aware classifier, exported as PURE parts so
  // this spec drives every branch with no database and no repository scan.
  MIN_CLASSIFIED_CALL_SITES: number;
  PRISMA_RECEIVERS: readonly string[];
  VERB_PRIVILEGES: Record<string, readonly string[]>;
  privilegesForVerb: (verb: string) => readonly string[] | null;
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
  // S-E01-1d (b) — `withTenantCallers` (occurrences of the string `.withTenant(`)
  // became `scopedCallSites` (call sites ATTRIBUTED to a brace-matched scope
  // callback), and `enumeratedCallSites` + `enumeratedOutsideScope` were added.
  // The typed handle moves WITH the checker on purpose: a stale field name here
  // is a TYPECHECK failure, not a silently passing spec.
  // S-E01-1e / ADR-051 §D2 — `enumerationDrift` joins the verdict's inputs, and
  // the enumeration entries gain `kind` (+ `statements` on the identity layer).
  // Same rule: a stale field name here is a TYPECHECK failure.
  cutoverVerdict: (counts: {
    files: number;
    scopedCallSites: number;
    enumeratedCallSites?: number;
    prismaCallSites: number;
    enumeratedOutsideScope?: ReadonlyArray<{ glob: string; reason?: unknown }>;
    enumerationDrift?: ReadonlyArray<{ glob: string; kind: string; detail: string }>;
  }) => { kind: 'vacuous' | 'limit' | 'ok' | 'unreasoned'; label: string; detail: string };
  ENUMERATED_OUTSIDE_SCOPE: ReadonlyArray<{
    kind: 'surface' | 'bootstrap';
    glob: string;
    reason: string;
    statements?: ReadonlyArray<{ model: string; verb: string; reason: string }>;
  }>;
  ENUMERATION_KINDS: readonly string[];
  enumerationDrift: (
    declared: ReadonlyArray<unknown>,
    observedByGlob: Map<string, Map<string, number>>,
  ) => Array<{ glob: string; kind: string; detail: string }>;
  SCOPE_RECEIVERS: readonly string[];
  SCOPE_SAFE_RECEIVERS: readonly string[];
  classifyCallSite: (
    receiver: string,
    at: { covered: boolean; enumerated: boolean },
  ) => 'scoped' | 'owner-inside-scope' | 'enumerated' | 'uncovered';
  globToRegExp: (glob: string) => RegExp;
  matchingParen: (text: string, openIndex: number) => number;
  scopeCallbackRanges: (text: string) => {
    ranges: ReadonlyArray<{ start: number; end: number }>;
    foreignScopeReceivers: Map<string, number>;
    unbalanced: number;
  };
  prismaModelName: (table: string) => string;
  // S-E01-1k / ADR-059 — la clôture de privilèges DÉRIVÉE. Même règle que
  // ci-dessus : un nom de champ périmé ici est un échec de TYPECHECK, jamais un
  // spec qui passe en silence.
  APP_ROLE_CLOSURE_EXCEPTIONS: ReadonlyArray<{ table: string; privilege: string; why: string }>;
  MIN_CLOSURE_INPUT_SITES: number;
  PRISMA_ARGUMENT_KEYS: Record<string, 'relation' | 'inert' | 'write-payload'>;
  RELATION_MODIFIER_KEYS: readonly string[];
  NESTED_WRITE_KEYS: readonly string[];
  closureKey: (table: string, privilege: string) => string;
  parseAppRoleRequiredPrivileges: (source: string) => {
    pairs: Array<{ table: string; privilege: string; why: string; key: string }>;
    problems: Array<{ kind: string; detail?: string; table?: string; privilege?: string }>;
  };
  parsePrismaSchema: (source: string) => {
    models: Map<string, PrismaModelNode>;
    byClientProperty: Map<string, PrismaModelNode>;
    modelToTable: Map<string, string>;
    problems: Array<{ kind: string; model?: string; detail?: string }>;
  };
  parseDerivedChildParents: (sql: string) => {
    parents: Map<string, { parent: string; fk: string; privileges: string }>;
    problems: Array<{ kind: string; detail?: string }>;
  };
  derivePrivilegeClosure: (input: {
    sources: ReadonlyArray<{ path: string; text: string }>;
    schema: unknown;
    derivedChildParents?: Map<string, { parent: string; fk: string; privileges: string }>;
  }) => {
    derived: Map<string, DerivedPair>;
    problems: Array<{ kind: string; where?: string; detail?: string }>;
    scopedSites: number;
    sitesWalked: number;
    unbalancedFiles: Map<string, number>;
  };
  privilegeClosureDrift: (input: {
    declared?: ReadonlyArray<{ table: string; privilege: string; why?: string }>;
    declaredProblems?: ReadonlyArray<{ kind: string; detail?: string; table?: string; privilege?: string }>;
    derived?: Map<string, DerivedPair>;
    derivedProblems?: ReadonlyArray<{ kind: string; where?: string; detail?: string }>;
    exceptions?: ReadonlyArray<unknown>;
    unbalancedFiles?: Map<string, number>;
    scopedSites?: number;
  }) => Array<{ kind: string; pair: string | null; detail: string }>;
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
  // S-E01-1c — the guard family, IMPORTED from the sibling by both the checker
  // and this spec, so "which tables the write guard covers" has ONE definition.
  WRITE_GUARD_PREFIX: string;
  WRITE_GUARD_TABLES: readonly string[];
  WRITE_GUARD_COMMANDS: ReadonlyArray<{ suffix: string; polcmd: string; using: boolean; withCheck: boolean }>;
  DERIVED_DELETE_ALLOWED: readonly string[];
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
    // basculer » est FAUSSE. ~~`withTenant` a ZÉRO appelant de production~~ —
    // DATÉ S-E01-1d : il en a désormais, mais SIX sites d'appel sur 794 sont
    // couverts, donc AC-5 (« pas de GUC ⇒ zéro ligne ») décrit toujours la PANNE
    // des 675 sites restants, pas la sûreté.
    expect(CHECKER_CODE).toContain('function cutoverReadiness');
    expect(CHECKER_CODE).toContain('AC-9 CUTOVER READINESS');
    expect(CHECKER_CODE).toContain('THE APPLICATION IS NOT READY TO CUT OVER');
    // Le PIN SUIT LE COMPTEUR. Il épinglait `.withTenant\s*\(` — le comptage par
    // OCCURRENCE DE CHAÎNE que cette story a remplacé, parce que quatre
    // ouvertures de portée couvrent six sites d'appel et qu'un compteur
    // d'ouvertures SOUS-ESTIME donc par construction. Épingler l'ancien motif
    // après l'avoir supprimé du checker, c'est épingler l'absence : le test
    // devient rouge sur le diff qui le corrige, ce qui est exactement ce qui
    // vient de se produire. On épingle le NOUVEAU motif, celui qui reconnaît une
    // ouverture de portée avec son RÉCEPTEUR (un `.run(` nu ne suffit pas — il y
    // en a cinq dans l'arbre qui n'ouvrent aucune portée, dont `store.run`).
    expect(CHECKER_CODE).toContain('SCOPE_OPENING_RE');
    expect(CHECKER_CODE).toContain('(withTenant|run)\\s*\\(');
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

  it('les DEUX dérivées non couvertes sont NOMMÉES, et leurs privilèges sont ceux qu’ADR-047 a DÉCIDÉS', () => {
    // S-E01-1c / ADR-047 §D1 — CETTE ASSERTION EST INVERSÉE, PAS SUPPRIMÉE.
    // Elle disait `privileges === 'SELECT'` et citait ADR-046 §D5 : `role` et
    // `role_permission` sont des données de PRIVILÈGE, donc lecture seule. Cette
    // phrase était, DANS SES PROPRES TERMES, un énoncé de périmètre pour
    // `S-E01-1b`, et la dette qu'elle nommait était `PF-193`. ADR-047 prend la
    // décision différée : les verbes d'écriture sont accordés, bornés par six
    // policies `AS RESTRICTIVE` qui rendent un rôle SYSTÈME inécrivable — un
    // RÉTRÉCISSEMENT par rapport à aujourd'hui, où l'app écrit ces tables comme
    // PROPRIÉTAIRE, sur tous les tenants, sous aucun prédicat.
    //
    // L'ASYMÉTRIE EST LE POINT, et elle est MESURÉE : il n'existe aucun site
    // `rolePermission.update*` dans `apps/api/src` ni `apps/worker/src`, donc
    // `role_permission` ne reçoit PAS `UPDATE`. Une symétrie de rédaction aurait
    // accordé un privilège sans appelant — exactement le « pure blast radius »
    // qu'ADR-042 §D5 refuse, et que sa modification (ADR-047 §D4) préserve.
    expect([...checker.UNCOVERED_EXPECTED].sort()).toEqual(['role', 'role_permission']);
    const decided: Record<string, string> = {
      role: 'SELECT, INSERT, UPDATE, DELETE',
      role_permission: 'SELECT, INSERT, DELETE',
    };
    for (const table of ['role', 'role_permission']) {
      const entry = sibling.DERIVED_TABLES.find((d) => d.child === table);
      expect(entry?.privileges).toBe(decided[table]);
      // Et le garde reste COMPLET PAR COMMANDE même là où le grant ne l'est pas :
      // `role_permission` reçoit quand même sa policy `FOR UPDATE`, pour qu'un
      // élargissement futur du GRANT ne puisse pas ouvrir un trou en une ligne.
      expect(sibling.WRITE_GUARD_TABLES).toContain(table);
      expect(checker.PLAN.some((planned) => planned.table === table)).toBe(false);
    }
    expect(sibling.WRITE_GUARD_COMMANDS.map((k) => k.suffix)).toEqual([
      'insert',
      'update',
      'delete',
    ]);
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

/**
 * TOOL-33 / S-E01-1d (b) — LE STAGE VOISIN, ET SA DÉPENDANCE D'ORDRE.
 *
 * `scripts/tenant-scope-check.js` est la PREUVE EXÉCUTÉE d'AC-2 : la seule chose
 * de l'arbre qui fasse passer une instruction par la couture RÉELLE et regarde
 * PostgreSQL la refuser. Elle pilote le seam COMPILÉ, donc elle ne peut tourner
 * qu'APRÈS `prisma generate` et APRÈS `build` — la même garantie dont
 * `boot-check.js` dépend déjà.
 *
 * C'est cette dépendance qui est épinglée ici, pas l'existence du fichier : un
 * stage placé avant le build serait présent, câblé, et VACUEUSEMENT rouge (ou,
 * pire, tenté d'être « réparé » par un skip). AC-9 de la story demande que
 * l'ordre soit ÉNONCÉ là où le stage est créé ; ce `describe` vérifie qu'il l'est
 * et qu'il est vrai.
 */
describe('TOOL-33 — la preuve exécutée est câblée APRÈS le build, dans les deux fichiers', () => {
  const GATE_SH = lf(readFileSync(join(REPO_ROOT, 'scripts', 'ci-gate.sh'), 'utf8'));
  const CI_YML = lf(readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const SCOPE_CHECK = lf(readFileSync(join(REPO_ROOT, 'scripts', 'tenant-scope-check.js'), 'utf8'));
  /**
   * La moitié EXÉCUTABLE de la preuve.
   *
   * La distinction est load-bearing ici et pas une précaution : le fichier
   * DÉCRIT, dans son en-tête, les choses qu'il refuse de faire — « ne pas
   * “réparer” cela avec `GRANT pg_signal_backend TO pilotage` », « aucune branche
   * sur `NODE_ENV` ». Une assertion négative sur le texte BRUT serait donc rouge
   * à cause de l'avertissement lui-même, et la seule façon de la rendre verte
   * serait de SUPPRIMER l'avertissement. Les négations portent sur le code, les
   * affirmations sur le texte.
   */
  const SCOPE_CODE = executableJs(SCOPE_CHECK);
  const stripComments = (source: string): string => source.replace(/^\s*#.*$/gm, '');

  it('`ci-gate.sh` le lance, avec une borne NUMÉRIQUE (TOOL-06)', () => {
    expect(stripComments(GATE_SH)).toMatch(
      /run_stage\s+\d+\s+"tenant scope \(executed proof\)"\s+node\s+scripts\/tenant-scope-check\.js/,
    );
  });

  it('il est APRÈS `build` et APRÈS `boot` — la dépendance d’ordre, mesurée et non racontée', () => {
    const code = stripComments(GATE_SH);
    const buildAt = code.indexOf('run_stage 1800 "build" pnpm build');
    const bootAt = code.indexOf('node scripts/boot-check.js');
    const scopeAt = code.indexOf('node scripts/tenant-scope-check.js');
    expect(buildAt).toBeGreaterThan(-1);
    expect(bootAt).toBeGreaterThan(buildAt);
    expect(scopeAt).toBeGreaterThan(bootAt);
  });

  it('la dépendance d’ordre est ÉNONCÉE dans un commentaire, là où le stage est créé', () => {
    const created = GATE_SH.indexOf('run_stage 180 "tenant scope (executed proof)"');
    expect(created).toBeGreaterThan(-1);
    const comment = GATE_SH.slice(Math.max(0, created - 3200), created);
    expect(comment).toContain('ORDERING DEPENDENCY');
    expect(comment).toContain('prisma generate');
    expect(comment).toContain('build');
    // …et la note anti-dérive que chaque stage frère porte (S-E02-2 AC-4).
    expect(comment).toContain('the two must not drift');
    // …et la limite NOMMÉE : le tier 3 est `--full`, donc une PR en tier rapide
    // rend `GATE: PASS` sans avoir jamais exécuté cette preuve. Une limite non
    // écrite est une limite qu'on redécouvre en la prenant pour une garantie.
    expect(comment).toContain('NAMED LIMIT');
  });

  it('AUCUNE branche `skip_stage` ne lui est offerte — il échoue ou il passe (DNC-08)', () => {
    expect(stripComments(GATE_SH)).not.toMatch(/skip_stage\s+"tenant scope/);
  });

  it('`ci.yml` le lance AUSSI, après `boot-check.js`, sans `continue-on-error`', () => {
    const yml = stripComments(CI_YML);
    expect(yml).toContain('- run: node scripts/tenant-scope-check.js');
    expect(yml.indexOf('- run: node scripts/tenant-scope-check.js')).toBeGreaterThan(
      yml.indexOf('- run: node scripts/boot-check.js'),
    );
    expect(yml.indexOf('- run: node scripts/tenant-scope-check.js')).toBeGreaterThan(yml.indexOf('- run: pnpm build'));
    const step = CI_YML.slice(CI_YML.indexOf('- run: node scripts/tenant-scope-check.js'));
    expect(step.slice(0, 200)).not.toContain('continue-on-error');
    const note = CI_YML.slice(Math.max(0, CI_YML.indexOf('- run: node scripts/tenant-scope-check.js') - 1600));
    expect(note).toContain('the two must not drift');
  });

  it('le stage voisin `tenant adversarial` se déclenche aussi sur le NOUVEAU fichier', () => {
    // Sans cette alternative, un diff qui ne touche QUE le nouveau vérificateur
    // saute le stage que son édition est la plus susceptible de déplacer.
    expect(stripComments(GATE_SH)).toContain('scripts/tenant-scope-check\\.js');
  });

  it('le chemin « artefact manquant » ÉCHOUE en nommant la commande qui le produit (DNC-08)', () => {
    // Copié de `boot-check.js:147-152` : un build absent n'est pas un skip, c'est
    // l'état dans lequel tout le reste passerait vacueusement.
    expect(SCOPE_CHECK).toContain('pnpm build');
    expect(SCOPE_CHECK).toContain('pnpm --filter @pilotage/api exec prisma generate');
    expect(SCOPE_CHECK).toContain('NOT a skip');
    // …et il n'y a AUCUN drapeau, AUCUNE branche NODE_ENV, AUCUNE variable
    // d'échappement capable de transformer un refus en passage (DNC-10).
    // Assertions sur le CODE : l'en-tête NOMME ces interdits, et une négation sur
    // le texte brut serait rouge à cause de l'avertissement lui-même.
    expect(SCOPE_CODE).not.toMatch(/process\.env\.(ALLOW|SKIP)_/);
    expect(SCOPE_CODE).not.toContain('NODE_ENV');
    // …et surtout PAS le « correctif » qui achèterait un teardown vert au prix
    // d'une escalade de privilège permanente sur le rôle même que la bascule vise
    // (TOOL-27). L'avertissement, lui, DOIT rester dans la prose.
    expect(SCOPE_CODE).not.toMatch(/GRANT\s+pg_signal_backend/i);
    expect(SCOPE_CODE).not.toMatch(/GRANT\s+\w+\s+TO\s+/i);
    expect(SCOPE_CODE).not.toMatch(/\bSUPERUSER\b/);
    expect(SCOPE_CODE).not.toMatch(/ALTER\s+ROLE/i);
    expect(SCOPE_CHECK).toContain('KNOWN HAZARD — TOOL-27, DO NOT REINTRODUCE IT');
    expect(SCOPE_CHECK).toContain('GRANT pg_signal_backend');
  });

  it('la preuve ne peut détruire qu’un nom qu’elle a elle-même généré (AC-3)', () => {
    expect(checkerScopePattern().test('tenant_scope_123_1700000000000')).toBe(true);
    expect(checkerScopePattern().test('pilotage')).toBe(false);
    expect(SCOPE_CHECK).toContain('refusing to use');
    // Le client `app_user` est déconnecté AVANT le drop, et l'absence de session
    // est vérifiée depuis une AUTRE connexion — TOOL-27 fermé par construction et
    // non par un retry privilégié.
    expect(SCOPE_CHECK).toContain('$disconnect()');
    expect(SCOPE_CHECK).toContain('pg_stat_activity');
    expect(SCOPE_CHECK).toContain('pg_database WHERE datname');
  });

  it('l’ORDRE d’AC-2 est celui du fichier : identité, puis contrôle POSITIF, puis déni', () => {
    // L'ordre est la preuve. Un déni mesuré avant le contrôle positif est vert
    // sur un rôle qui n'aurait de toute façon rien pu lire — `app_user` ne
    // détenait AUCUN privilège avant S-E01-2b.
    const whoAmI = SCOPE_CHECK.indexOf('AC-2.1 current_user is readable');
    const positive = SCOPE_CHECK.indexOf('AC-2.2 POSITIVE CONTROL — tenant A READS');
    const denial = SCOPE_CHECK.indexOf('AC-2.3 DENIAL — tenant B');
    const cleanup = SCOPE_CHECK.indexOf('AC-4 the app_user client was disconnected');
    expect(whoAmI).toBeGreaterThan(-1);
    expect(positive).toBeGreaterThan(whoAmI);
    expect(denial).toBeGreaterThan(positive);
    expect(cleanup).toBeGreaterThan(denial);
    // Le propriétaire est lu au CATALOGUE, jamais écrit en dur.
    expect(SCOPE_CHECK).toContain('read from the CATALOG');
    // L'assertion porte sur le code d'erreur Prisma, jamais sur une ligne de log.
    expect(SCOPE_CHECK).toContain("'P2025'");
  });

  function checkerScopePattern(): RegExp {
    // `require`, jamais `import` : le fichier est du CommonJS hors du tsconfig de
    // l'application, et son `main()` est derrière `require.main === module` — le
    // charger ne crée donc AUCUNE base de données.
    //
    // La directive ci-dessous est NÉCESSAIRE, et le commentaire qu'elle remplace
    // affirmait exactement le contraire : « la règle est déjà désactivée pour ce
    // fichier plus haut » est FAUX. Le `eslint-disable` de la ligne 71 est refermé
    // par un `eslint-enable` ligne 138 — c'est un BLOC, pas une portée de fichier —
    // donc ce site, mille lignes plus bas, n'a jamais été couvert. MESURÉ, pas
    // supposé : le gate a rendu `1011:19 error A require() style import is
    // forbidden`, et c'est la seule erreur de tout le lint. Un commentaire qui
    // AFFIRME une contrainte au lieu de la vérifier est le défaut que ce dépôt a
    // déjà payé trois fois (TOOL-22, TOOL-23, TOOL-25) : on désactive donc À LA
    // LIGNE, où la portée est visible depuis le site lui-même.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const proof = require(join(REPO_ROOT, 'scripts', 'tenant-scope-check.js')) as {
      SCRATCH_NAME_PATTERN: RegExp;
    };
    return proof.SCRATCH_NAME_PATTERN;
  }
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
    it('zéro site couvert reste une LIMITE', () => {
      const v = checker.cutoverVerdict({ files: 223, scopedCallSites: 0, prismaCallSites: 722 });
      expect(v.kind).toBe('limit');
      expect(v.label).toContain('ZERO production Prisma call sites');
      expect(v.detail).toContain('NOT READY TO CUT OVER');
    });

    it('UN site couvert sur 722 reste une LIMITE — la régression que ce correctif ferme', () => {
      // Le cas qui compte le plus, réécrit dans la NOUVELLE unité : la première
      // rédaction testait `withTenantCallers === 0`, donc un seul appelant sur
      // 722 faisait passer la ligne « prêt à basculer » au vert affirmatif alors
      // que 721 sites ne posent aucun GUC. Changer l'unité ne doit pas rouvrir
      // cette porte : `scopedCallSites: 1` reste une LIMITE.
      const v = checker.cutoverVerdict({ files: 223, scopedCallSites: 1, prismaCallSites: 722 });
      expect(v.kind).toBe('limit');
      expect(v.kind).not.toBe('ok');
      expect(v.label).toContain('only PART of the corpus');
      // Le nombre de sites NON couverts est nommé, pas seulement celui des couverts.
      expect(v.detail).toContain('721');
      expect(v.detail).toContain('NOT READY TO CUT OVER');
    });

    it('la couverture COMPLÈTE est la seule qui autorise le vert affirmatif', () => {
      const v = checker.cutoverVerdict({ files: 223, scopedCallSites: 722, prismaCallSites: 722 });
      expect(v.kind).toBe('ok');
      expect(v.label).toContain('every production Prisma call site');
    });

    it('l’ÉNUMÉRATION compte dans le mur, mais seulement avec sa raison', () => {
      // Le mur est `scoped + enumerated === total`. Une énumération LÉGITIME —
      // chaque entrée porte sa raison — a le droit de le fermer.
      const v = checker.cutoverVerdict({
        files: 223,
        scopedCallSites: 600,
        enumeratedCallSites: 122,
        prismaCallSites: 722,
        enumeratedOutsideScope: [{ glob: 'apps/worker/src/**', reason: 'le worker n’a pas de tenant de requête' }],
      });
      expect(v.kind).toBe('ok');
      expect(v.detail).toContain('600 scoped + 122 enumerated === 722');
    });

    /**
     * LE MUTANT « VERT FABRIQUÉ » — le cas que cette story ajoute, et le seul de
     * ce `describe` qui décrit une ATTAQUE plutôt qu'un état du corpus.
     *
     * Il y a deux façons d'atteindre la branche affirmative : convertir des sites
     * d'appel, ou ÉLARGIR l'énumération. La seconde est gratuite, invisible dans
     * un résumé de diff, et produit exactement le vert qu'un relecteur cherche.
     * L'énumération est une liste de RAISONS ; une entrée sans raison ferme
     * l'écart sans rien couvrir.
     *
     * OBSERVÉ ROUGE AVANT D'ÊTRE OBSERVÉ VERT : exécuté contre le `cutoverVerdict`
     * NON durci (celui qui ne connaît que `files/scoped/prisma` et ignore
     * `enumeratedOutsideScope`), ce cas rendait `kind === 'ok'` — le vert
     * fabriqué — et l'assertion échouait. Une assertion qui n'a jamais été rouge
     * ne prouve rien.
     */
    it('MUTANT — une énumération GONFLÉE sans raison ne peut PAS rendre le verdict affirmatif', () => {
      const v = checker.cutoverVerdict({
        files: 223,
        scopedCallSites: 1,
        // Gonflé pour fermer exactement l'écart, sans qu'un seul site ait été couvert.
        enumeratedCallSites: 721,
        prismaCallSites: 722,
        enumeratedOutsideScope: [{ glob: 'apps/api/src/**' }],
      });
      expect(v.kind).not.toBe('ok');
      expect(v.kind).toBe('unreasoned');
      expect(v.label).toContain('carries a reason for every entry');
      expect(v.detail).toContain('"Not converted yet" is not a reason');
    });

    it('MUTANT — une raison VIDE ne vaut pas mieux qu’une raison absente', () => {
      const v = checker.cutoverVerdict({
        files: 223,
        scopedCallSites: 1,
        enumeratedCallSites: 721,
        prismaCallSites: 722,
        enumeratedOutsideScope: [{ glob: 'apps/api/src/**', reason: '   ' }],
      });
      expect(v.kind).toBe('unreasoned');
    });

    it('une arithmétique IMPOSSIBLE (scoped + enumerated > total) n’est jamais un vert', () => {
      const v = checker.cutoverVerdict({
        files: 223,
        scopedCallSites: 700,
        enumeratedCallSites: 100,
        prismaCallSites: 722,
        enumeratedOutsideScope: [{ glob: 'apps/worker/src/**', reason: 'une raison' }],
      });
      expect(v.kind).not.toBe('ok');
      expect(v.kind).toBe('unreasoned');
      expect(v.detail).toContain('EXCEEDS');
    });

    it('une lecture de sources vide reste un ÉCHEC, jamais une limite tolérée (DNC-08)', () => {
      const v = checker.cutoverVerdict({ files: 0, scopedCallSites: 0, prismaCallSites: 0 });
      expect(v.kind).toBe('vacuous');
      expect(v.detail).toContain('vacuous');
    });

    it('la constante d’énumération EN SOURCE porte une raison pour CHAQUE entrée', () => {
      expect(checker.ENUMERATED_OUTSIDE_SCOPE.length).toBeGreaterThan(0);
      for (const entry of checker.ENUMERATED_OUTSIDE_SCOPE) {
        expect(typeof entry.glob).toBe('string');
        expect(entry.glob.length).toBeGreaterThan(0);
        expect(typeof entry.reason).toBe('string');
        // Une raison d'une poignée de caractères est une case cochée, pas une raison.
        expect(entry.reason.trim().length).toBeGreaterThan(30);
        // « pas encore converti » N'EST PAS une raison : cela appartient au
        // compte des sites NON couverts, jamais à l'énumération.
        expect(entry.reason.toLowerCase()).not.toContain('not converted');
        expect(entry.reason.toLowerCase()).not.toContain('pas encore');
        expect(entry.reason.toLowerCase()).not.toContain('todo');
      }
    });
  });

  /**
   * S-E01-1e / PF-199 / ADR-051 §D2 — LE CLIQUET AU NIVEAU DE L'INSTRUCTION.
   *
   * L'énumération portait UNE raison par GLOB, et cette grossièreté échouait
   * dans la direction SILENCIEUSE : `user-sync.service.ts` excusait 5
   * instructions le jour où la ligne a été écrite, et excusait ce que ce fichier
   * contiendrait DEMAIN. Une sixième requête sans rapport ajoutée à ce fichier
   * était excusée **sans AUCUN diff sur l'énumération**.
   *
   * Le contrôle décisif est M1 : sur le VRAI arbre, ajouter une requête à un
   * fichier déjà excusé fait passer `enumerated` de 120 à 121 et laisse
   * `uncovered` à 659 — le mur arithmétique ne dit RIEN. Seul le cliquet
   * ensembliste le voit. C'est pour cela qu'il existe.
   *
   * PAS DE PLANCHER DE RATIO. Un plancher est un bouton, et un bouton ici est un
   * drapeau de contournement déguisé (DNC-10). Le paragraphe du ledger qui en
   * réclame un est périmé et déjà contredit par le commentaire livré de
   * `cutoverVerdict`.
   */
  describe('AC-7 / PF-199 — l’allow-list de bootstrap MORD, dans les DEUX directions', () => {
    const GLOB = 'apps/api/src/modules/students/student-access.service.ts';
    /** Typé explicitement : les mutants ci-dessous SUPPRIMENT `kind` et POUSSENT dans `statements`. */
    type DeclaredEntry = {
      kind?: string;
      glob: string;
      reason: string;
      statements?: Array<{ model: string; verb: string; reason: string }>;
    };
    const declared = (): DeclaredEntry[] => [
      {
        kind: 'surface',
        glob: 'apps/worker/src/**',
        reason: 'le worker n’a pas de tenant de requête : un job porte le sien dans sa charge utile',
      },
      {
        kind: 'bootstrap',
        glob: GLOB,
        reason: 'PF-199 — `scopeForUser` résout la portée ABAC elle-même, une couche sous `ensureUser`',
        statements: [
          { model: 'guardianship', verb: 'findMany', reason: 'résout QUELS élèves un parent peut voir' },
          { model: 'student', verb: 'findFirst', reason: 'le contrôle élève-unique sur le même chemin pré-portée' },
        ],
      },
    ];
    const observed = (pairs: ReadonlyArray<[string, number]>) =>
      new Map([[GLOB, new Map(pairs)]]);
    const truth = observed([
      ['guardianship.findMany', 1],
      ['student.findFirst', 1],
    ]);
    /**
     * L'élément `index`, ou une ERREUR NOMMÉE s'il est absent.
     *
     * `noUncheckedIndexedAccess` a raison : `drift[0]` peut être `undefined`, et
     * un `!` transformerait « le cliquet n'a RIEN signalé » — le mode de
     * défaillance que ces cas existent pour attraper — en un `TypeError`
     * illisible une ligne plus loin. La longueur est déjà assertie juste avant
     * chaque appel ; ceci en fait une propriété du TYPE plutôt qu'une convention
     * tacite entre deux lignes voisines.
     */
    const at = <T>(items: readonly T[], index: number): T => {
      const item = items[index];
      if (item === undefined) {
        throw new Error(`dérive attendue à l’index ${index}, mais il y en a ${items.length}`);
      }
      return item;
    };

    /** Le verdict complet, pour prouver que le cliquet REFUSE et ne se contente pas de signaler. */
    const verdictWith = (drift: ReturnType<typeof checker.enumerationDrift>) =>
      checker.cutoverVerdict({
        files: 228,
        scopedCallSites: 24,
        enumeratedCallSites: 120,
        prismaCallSites: 803,
        enumerationDrift: drift,
      });

    it('M0 CONTRÔLE POSITIF — déclaré === observé ne dérive pas, et le verdict reste la LIMITE attendue', () => {
      // Une preuve qui ne montre que l'absence est verte pour la mauvaise raison :
      // sans ce contrôle, un `enumerationDrift` qui rendrait toujours `[]` passerait.
      const drift = checker.enumerationDrift(declared(), truth);
      expect(drift).toEqual([]);
      expect(verdictWith(drift).kind).toBe('limit');
    });

    it('M1 une SIXIÈME requête ajoutée à un fichier déjà excusé ÉCHOUE, en la NOMMANT', () => {
      const drift = checker.enumerationDrift(
        declared(),
        observed([
          ['guardianship.findMany', 1],
          ['student.findFirst', 1],
          ['student.findMany', 1],
        ]),
      );
      expect(drift).toHaveLength(1);
      expect(at(drift, 0).kind).toBe('undeclared-statement');
      expect(at(drift, 0).detail).toContain('student.findMany');
      expect(verdictWith(drift).kind).toBe('unreasoned');
    });

    it('M1b un DOUBLON — la même instruction une deuxième fois — échoue aussi (multi-ensemble, pas ensemble)', () => {
      // Le collapse des doublons laisserait passer une SECONDE copie d'une
      // instruction déjà déclarée : exactement la direction silencieuse.
      const drift = checker.enumerationDrift(
        declared(),
        observed([
          ['guardianship.findMany', 2],
          ['student.findFirst', 1],
        ]),
      );
      expect(drift).toHaveLength(1);
      expect(at(drift, 0).kind).toBe('undeclared-statement');
      expect(at(drift, 0).detail).toContain('2×');
    });

    it('M2 une entrée MORTE (déclarée, jamais observée) échoue — l’énumération ne s’élargit pas en silence', () => {
      const entries = declared();
      at(entries, 1).statements!.push({
        model: 'school',
        verb: 'findMany',
        reason: 'une excuse maintenue en vie après la suppression du code qu’elle excusait',
      });
      const drift = checker.enumerationDrift(entries, truth);
      expect(drift).toHaveLength(1);
      expect(at(drift, 0).kind).toBe('dead-entry');
      expect(verdictWith(drift).kind).toBe('unreasoned');
    });

    it('M3 une instruction qui PERD sa raison échoue', () => {
      const entries = declared();
      at(at(entries, 1).statements!, 0).reason = '   ';
      const drift = checker.enumerationDrift(entries, truth);
      expect(drift.map((d) => d.kind)).toContain('statement-without-reason');
      expect(verdictWith(drift).kind).toBe('unreasoned');
    });

    it('M4 une entrée SANS `kind` est inclassable, donc REFUSÉE (DNC-08) — jamais rabattue sur le kind grossier', () => {
      const entries = declared();
      delete at(entries, 1).kind;
      const drift = checker.enumerationDrift(entries, truth);
      expect(drift).toHaveLength(1);
      expect(at(drift, 0).kind).toBe('unknown-kind');
    });

    it('M5 un `surface` qui nomme UN fichier .ts sous modules/** échoue — la porte du module qui se cache', () => {
      const drift = checker.enumerationDrift(
        [
          {
            kind: 'surface',
            glob: 'apps/api/src/modules/lessons/lessons.controller.ts',
            reason: 'un module en cours de conversion qui essaierait de se cacher derrière le kind grossier',
          },
        ],
        new Map(),
      );
      expect(drift).toHaveLength(1);
      expect(at(drift, 0).kind).toBe('surface-hides-a-module-file');
    });

    it('M6 un `bootstrap` SANS `statements` échoue : ce kind existe pour nommer les instructions', () => {
      const drift = checker.enumerationDrift(
        [{ kind: 'bootstrap', glob: GLOB, reason: 'PF-199 — la résolution d’identité ne peut pas précéder sa propre clé' }],
        new Map(),
      );
      expect(drift).toHaveLength(1);
      expect(at(drift, 0).kind).toBe('bootstrap-without-statements');
    });

    it('M7 un `surface` qui porte AUSSI des `statements` échoue : deux unités dans une entrée, c’est la dérive', () => {
      const drift = checker.enumerationDrift(
        [{ kind: 'surface', glob: 'apps/worker/src/**', reason: 'le worker n’a pas de tenant de requête, par construction de la file', statements: [] }],
        new Map(),
      );
      expect(drift.map((d) => d.kind)).toContain('surface-with-statements');
    });

    it('la constante LIVRÉE est à DEUX COUCHES, et chaque instruction porte SA raison', () => {
      const kinds = new Set(checker.ENUMERATED_OUTSIDE_SCOPE.map((e) => e.kind));
      expect([...kinds].sort()).toEqual(['bootstrap', 'surface']);
      expect([...checker.ENUMERATION_KINDS].sort()).toEqual(['bootstrap', 'surface']);

      const bootstrap = checker.ENUMERATED_OUTSIDE_SCOPE.filter((e) => e.kind === 'bootstrap');
      // NON VACUITÉ : une couche B vide rendrait tout ce bloc vert à vide.
      expect(bootstrap.length).toBeGreaterThanOrEqual(5);
      for (const entry of bootstrap) {
        expect(entry.statements?.length ?? 0).toBeGreaterThan(0);
        for (const statement of entry.statements ?? []) {
          expect(typeof statement.model).toBe('string');
          expect(typeof statement.verb).toBe('string');
          // Une raison de quelques caractères est une case cochée, pas une raison.
          expect(statement.reason.trim().length).toBeGreaterThan(30);
          expect(statement.reason.toLowerCase()).not.toContain('not converted');
          expect(statement.reason.toLowerCase()).not.toContain('pas encore');
        }
      }
      // La couche A ne porte JAMAIS de statements : sa raison est une propriété
      // de l'arbre entier, et l'énumérer instruction par instruction serait de
      // la cérémonie, pas de la preuve.
      for (const entry of checker.ENUMERATED_OUTSIDE_SCOPE.filter((e) => e.kind === 'surface')) {
        expect(entry.statements).toBeUndefined();
      }
      // Les défauts STRUCTURELS de la constante livrée (kind absent, `surface`
      // portant des statements, `surface` nommant un fichier de module) sont
      // décidables sans lire le dépôt, donc assérés ici. La comparaison
      // ensembliste contre le CORPUS, elle, appartient au scan
      // (`cutoverReadiness`) : ce spec tourne sans système de fichiers.
      const structural = checker
        .enumerationDrift(checker.ENUMERATED_OUTSIDE_SCOPE, new Map())
        .filter((d) => d.kind !== 'dead-entry');
      expect(structural).toEqual([]);
    });

    it('AUCUN plancher de ratio n’est introduit : le mur reste `scoped + enumerated === total` (DNC-10)', () => {
      expect(CHECKER_CODE).not.toMatch(/RATIO_FLOOR|MIN_SCOPED_RATIO|COVERAGE_FLOOR/);
      // La règle doit vivre dans du code qui S'EXÉCUTE (la chaîne que le
      // vérificateur IMPRIME), pas seulement dans un commentaire — `CHECKER_CODE`
      // a justement les commentaires blanchis, donc cette assertion ne peut pas
      // être satisfaite par de la prose.
      //
      // Le fragment attendu s'arrête AVANT `wearing a` : la phrase est écrite en
      // concaténation et la coupure tombe entre « wearing » et « a different
      // hat ». La version d'origine de ce cas réclamait le mot d'après et ne
      // pouvait donc JAMAIS passer — elle n'avait jamais été exécutée.
      expect(CHECKER_CODE).toContain('No ratio floor: a floor is a knob');
      // Le mur lui-même, inchangé.
      const short = checker.cutoverVerdict({
        files: 228,
        scopedCallSites: 802,
        enumeratedCallSites: 0,
        prismaCallSites: 803,
      });
      expect(short.kind).toBe('limit');
    });
  });

  /**
   * S-E01-1e — LE COMPTEUR DEVIENT AVEUGLE-AU-RÉCEPTEUR NON, IL LE CESSE.
   *
   * `PRISMA_CALL_SITE_RE` matche `prisma.`, `this.prisma.` et `tx.` à
   * l'identique, et `covers()` est purement POSITIONNEL. Un
   * `this.scope.run(id, async (tx) => { await this.prisma.grade.findMany() })`
   * comptait donc COUVERT : l'instruction part sur la connexion du PROPRIÉTAIRE
   * — qui échappe à ses propres policies — pendant que le compteur la crédite au
   * callback. Un handler à moitié converti produisait un compte `scoped` PLUS
   * ÉLEVÉ qu'un handler correct, c'est-à-dire une métrique qui bouge dans le
   * mauvais sens exactement quand le code est faux.
   */
  describe('AC-11 — un récepteur PROPRIÉTAIRE dans une portée compte NON COUVERT, et il est NOMMÉ', () => {
    it('`tx.` dans une portée est COUVERT, `this.prisma.` / `prisma.` ne le sont pas', () => {
      expect(checker.classifyCallSite('tx', { covered: true, enumerated: false })).toBe('scoped');
      expect(checker.classifyCallSite('this.prisma', { covered: true, enumerated: false })).toBe(
        'owner-inside-scope',
      );
      expect(checker.classifyCallSite('prisma', { covered: true, enumerated: false })).toBe(
        'owner-inside-scope',
      );
    });

    it('l’ORDRE porte la propriété : un site propriétaire DANS une portée ne peut pas être blanchi en `enumerated`', () => {
      // Sinon un fichier allow-listé qui ouvrirait une portée pourrait faire
      // passer ses `this.prisma.` de la colonne « défaut » à la colonne « excusé ».
      expect(checker.classifyCallSite('this.prisma', { covered: true, enumerated: true })).toBe(
        'owner-inside-scope',
      );
      expect(checker.classifyCallSite('this.prisma', { covered: false, enumerated: true })).toBe(
        'enumerated',
      );
      expect(checker.classifyCallSite('tx', { covered: false, enumerated: false })).toBe('uncovered');
    });

    it('le jeu des récepteurs SÛRS est une constante nommée et FERMÉE', () => {
      expect([...checker.SCOPE_SAFE_RECEIVERS]).toEqual(['tx']);
      expect(CHECKER_CODE).toContain('ownerReceiverInsideScope');
      // …et il est REMONTÉ en `fail`, pas seulement compté (PF-200 : compter sans
      // remonter est la forme silencieuse du même défaut).
      expect(CHECKER_CODE).toContain('no OWNER-connection receiver runs inside a tenant-scope callback');
    });
  });

  /**
   * S-E01-1d (b) — L'ATTRIBUTION, pilotée sur des sources SYNTHÉTIQUES.
   *
   * Le compteur est passé de « combien de fois la chaîne `.withTenant(`
   * apparaît » à « combien de sites d'appel Prisma sont DANS une portée », par
   * appariement de parenthèses. La technique a deux modes de défaillance et un
   * seul est bruyant :
   *
   *   • une `)` dans une chaîne ferme la plage TROP TÔT → sous-report, visible ;
   *   • une `(` dans une chaîne, une regex ou un commentaire ne ferme JAMAIS →
   *     la plage court jusqu'à la fin du fichier et **tous les sites restants du
   *     fichier comptent COUVERTS**. C'est un vert fabriqué exprimé en nombre,
   *     que personne ne relit.
   *
   * Les cas ci-dessous exercent exactement ces bords, sans base et sans scan du
   * dépôt — un appariement qui n'est éprouvé que par le corpus réel est un
   * appariement dont les branches pathologiques ne sont jamais testées.
   */
  describe('AC-9 — l’attribution par appariement de parenthèses tient sur les sources pathologiques', () => {
    const rangesOf = (source: string) => checker.scopeCallbackRanges(source);
    const coveredCount = (source: string): number => {
      const { ranges, unbalanced } = rangesOf(source);
      if (unbalanced > 0) return 0;
      let covered = 0;
      const re = /(?<![.\w])(?:prisma|this\.prisma|tx)\.([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)/g;
      for (const match of source.matchAll(re)) {
        const at = match.index;
        if (at === undefined) continue;
        if (ranges.some((r) => at > r.start && at < r.end)) covered += 1;
      }
      return covered;
    };

    it('une `)` DANS UNE CHAÎNE ne ferme pas la plage trop tôt', () => {
      const source =
        "this.scope.run(id, async (tx) => { logger.log('a ) b'); await tx.calendarEvent.findMany(); });";
      expect(coveredCount(source)).toBe(1);
    });

    it('une `(` DANS UNE REGEX ne fait pas courir la plage jusqu’à la fin du fichier', () => {
      const source =
        'this.scope.run(id, async (tx) => { const re = /\\(/; await tx.calendarEvent.findMany(); });\n' +
        'await this.prisma.grade.findMany();';
      // Le site HORS portée, après le `});`, ne doit PAS être attribué.
      expect(coveredCount(source)).toBe(1);
    });

    it('une `(` DANS UN COMMENTAIRE ne fait pas courir la plage non plus', () => {
      const source =
        'this.scope.run(id, async (tx) => { // (\n  await tx.calendarEvent.findMany();\n});\n' +
        'await this.prisma.grade.findMany();';
      expect(coveredCount(source)).toBe(1);
    });

    it('une `(` dans un littéral de gabarit, substitutions comprises, ne désynchronise pas', () => {
      const source =
        'this.scope.run(id, async (tx) => { log(`x ( ${fn({ a: 1 })} y`); await tx.calendarEvent.findMany(); });\n' +
        'await this.prisma.grade.findMany();';
      expect(coveredCount(source)).toBe(1);
    });

    it('un rappel qui NE FERME PAS est REMONTÉ, et ses sites comptent NON COUVERTS (fail-closed)', () => {
      // La direction dangereuse : sous-reporter une couverture est une limite,
      // sur-reporter est un mensonge. `unbalanced` force la seconde à devenir la
      // première.
      const source = 'this.scope.run(id, async (tx) => { await tx.calendarEvent.findMany();';
      expect(rangesOf(source).unbalanced).toBe(1);
      expect(coveredCount(source)).toBe(0);
    });

    it('un `.run(` ÉTRANGER n’ouvre pas de portée — il est REMONTÉ', () => {
      // MESURÉ sur ce dépôt : `store.run(` dans `tenant-scope.ts:89` est le seul
      // `.run(` hors du jeu aujourd'hui. Demain, un
      // `this.queue.run(async () => { await this.prisma.x.findMany() })`
      // fabriquerait de la couverture sur la connexion du PROPRIÉTAIRE.
      const source = 'somethingElse.run(async () => { await prisma.calendarEvent.findMany(); });';
      const result = rangesOf(source);
      expect(result.ranges.length).toBe(0);
      expect([...result.foreignScopeReceivers.keys()]).toEqual(['somethingElse.run']);
      expect(coveredCount(source)).toBe(0);
    });

    it('le jeu des récepteurs qui OUVRENT une portée est une constante nommée et FERMÉE', () => {
      expect([...checker.SCOPE_RECEIVERS].sort()).toEqual([
        'scope',
        'tenantScope',
        'this.scope',
        'this.tenantScope',
      ]);
      expect(CHECKER_CODE).toContain('SCOPE_RECEIVERS.includes(receiver)');
      expect(CHECKER_CODE).toContain('foreignScopeReceivers');
    });

    it('`withTenant` ouvre une portée quel que soit son récepteur — c’est la méthode de PrismaService', () => {
      const source = 'this.prisma.withTenant(id, async (tx) => { await tx.calendarEvent.findMany(); });';
      expect(coveredCount(source)).toBe(1);
    });

    it('`matchingParen` rend -1 plutôt qu’une supposition quand rien ne ferme', () => {
      expect(checker.matchingParen('f(a, b)', 1)).toBe(6);
      expect(checker.matchingParen('f(a, (b)', 1)).toBe(-1);
      expect(checker.matchingParen("f('(')", 1)).toBe(5);
    });

    it('`**` traverse les séparateurs, `*` non, et un `.` reste un `.`', () => {
      expect(checker.globToRegExp('apps/worker/src/**').test('apps/worker/src/a/b/c.ts')).toBe(true);
      expect(checker.globToRegExp('apps/api/src/*.ts').test('apps/api/src/a/b.ts')).toBe(false);
      expect(checker.globToRegExp('apps/api/src/main.ts').test('apps/api/src/mainXts')).toBe(false);
    });
  });

  /**
   * S-E01-1c / TOOL-32 — AC-10 : le bloc CUTOVER READINESS devient CONSCIENT DU
   * VERBE et CONSCIENT DU RÉCEPTEUR.
   *
   * LE DÉFAUT MESURÉ QU'IL FERME, en deux moitiés indépendantes :
   *
   *   1. VERBE. L'ancienne rédaction ne posait qu'une question — « du code de
   *      production mentionne-t-il une table qui ne détient AUCUNE ligne de
   *      grant ? ». Une table détenant `SELECT` et ÉCRITE par la production
   *      PASSAIT. C'est exactement l'état de `role` / `role_permission` après
   *      `S-E01-1b`, c'est-à-dire `PF-193` : le contrôle censé dire « la bascule
   *      est sûre » était aveugle au seul bloqueur de son propre chemin.
   *   2. RÉCEPTEUR. L'ancre était `\bprisma\.`. MESURÉ sur ce checkout : 722
   *      sites `prisma.<modèle>.<verbe>` et 86 sites `tx.<modèle>.<verbe>`. Les
   *      CINQ écritures de PF-193 sont des appels `tx.` (elles sont dans un
   *      `$transaction(async (tx …)`), comme `tx.tenant.upsert` (PF-185). Un
   *      classifieur conscient du verbe posé sur l'ancienne ancre en aurait
   *      rendu ZÉRO.
   *
   * Le classifieur est une fonction PURE, donc chaque branche est pilotée ici
   * sans base de données et sans scan du dépôt.
   */
  describe('AC-10 — le classifieur verbe -> privilège est PUR, et un verbe inconnu est REMONTÉ', () => {
    it('les quatre familles de verbes rendent le privilège que le moteur exigera', () => {
      for (const verb of ['create', 'createMany', 'createManyAndReturn']) {
        expect(checker.privilegesForVerb(verb)).toEqual(['INSERT']);
      }
      for (const verb of ['update', 'updateMany']) {
        expect(checker.privilegesForVerb(verb)).toEqual(['UPDATE']);
      }
      for (const verb of ['delete', 'deleteMany']) {
        expect(checker.privilegesForVerb(verb)).toEqual(['DELETE']);
      }
      for (const verb of [
        'findFirst',
        'findFirstOrThrow',
        'findMany',
        'findUnique',
        'findUniqueOrThrow',
        'count',
        'aggregate',
        'groupBy',
      ]) {
        expect(checker.privilegesForVerb(verb)).toEqual(['SELECT']);
      }
    });

    it('`upsert` exige LES DEUX, et c’est la raison pour laquelle un contrôle par table ne pouvait rien dire', () => {
      // `register.controller.ts` fait `tenant.upsert` sur une table qui détient
      // `SELECT`. Un contrôle « la table a-t-elle une ligne de grant ? » répond
      // oui ; la vérité est qu'il lui manque INSERT **et** UPDATE (PF-185).
      expect(checker.privilegesForVerb('upsert')).toEqual(['INSERT', 'UPDATE']);
    });

    it('un verbe INCONNU rend `null` — remonté, jamais silencieusement ignoré', () => {
      // Le mode de défaillance d'une table de correspondance est qu'un NOUVEAU
      // verbe Prisma se classe « n'a besoin de rien ». `null` force la branche
      // qui l'imprime.
      expect(checker.privilegesForVerb('rollbackEverything')).toBeNull();
      expect(checker.privilegesForVerb('constructor')).toBeNull();
      expect(checker.privilegesForVerb('toString')).toBeNull();
      expect(CHECKER_CODE).toContain('UNRECOGNISED verb was reported rather than dropped');
    });

    it('le jeu de RÉCEPTEURS est une constante nommée qui contient `tx`', () => {
      expect([...checker.PRISMA_RECEIVERS].sort()).toEqual(['prisma', 'this.prisma', 'tx']);
      // Le regex est CONSTRUIT depuis la constante : ajouter un récepteur est UNE
      // seule édition, jamais deux littéraux qui divergent.
      expect(CHECKER_CODE).toContain('PRISMA_RECEIVERS.map(');
      // …et un alias de callback hors du jeu est REMONTÉ, pas supposé absent.
      expect(CHECKER_CODE).toContain('foreignReceivers');
      expect(CHECKER_CODE).toContain('TRANSACTION_ALIAS_RE');
    });

    it('la NON-VACUITÉ est asserée dans LES DEUX SENS', () => {
      // Un scan qui ne classe rien imprimerait un bulletin de santé impeccable
      // pour un corpus qu'il n'a jamais lu — le défaut de PF-02 lui-même.
      expect(checker.MIN_CLASSIFIED_CALL_SITES).toBeGreaterThanOrEqual(400);
      expect(CHECKER_CODE).toContain('MIN_CLASSIFIED_CALL_SITES');
      // …et l'autre sens : une comparaison qui répond toujours « non » ferait de
      // chaque `[LIMIT]` un faux positif.
      expect(CHECKER_CODE).toContain('readiness.satisfied.length === 0');
    });

    it('le résidu est AGRÉGÉ par (table, verbe), avec le nombre de sites et UN exemple path:line', () => {
      expect(CHECKER_CODE).toContain('AC-9 CUTOVER BLOCKER:');
      expect(CHECKER_CODE).toContain('call site(s) via');
      expect(CHECKER_CODE).toContain('entry.example');
      // La logique de RATIO de `cutoverVerdict` n'est PAS touchée par AC-10 :
      // « quelle proportion des sites pose le GUC » et « ce verbe a-t-il son
      // privilège » sont deux questions, et fusionner les deux réponses est la
      // façon dont l'une masque l'autre.
      //
      // S-E01-1d (b) — CES DEUX ÉPINGLES ONT CHANGÉ DE CIBLE, ET C'EST LE POINT.
      // Elles épinglaient le texte `uncovered > 0` et `withTenantCallers === 0`,
      // c'est-à-dire l'ANCIENNE unité ; elles cassaient donc mécaniquement le
      // jour où le compteur devenait juste. Ce qu'il faut épingler n'est pas le
      // nom du compteur mais **le MUR** : la branche affirmative n'existe que
      // pour l'ÉGALITÉ `scoped + enumerated === total`. Une épingle sur le mur
      // échoue encore si quelqu'un réintroduit un SEUIL RÉGLABLE (`>= floor`,
      // `ratio > 0.9`, un `MIN_*` de couverture) — ce que l'ancienne rédaction ne
      // faisait plus dès qu'on renommait la variable.
      expect(CHECKER_CODE).toContain('const uncovered = prismaCallSites - scopedCallSites - enumeratedCallSites');
      expect(CHECKER_CODE).toContain('if (uncovered !== 0)');
      // …et la branche affirmative reste la SEULE à mener à `kind: 'ok'`.
      expect(CHECKER_CODE).toContain("kind: 'ok'");
      // Le mur est une ÉGALITÉ, jamais un plancher : aucun seuil de couverture
      // réglable n'a le droit d'exister dans ce fichier (DNC-10).
      expect(CHECKER_CODE).not.toMatch(/scopedCallSites\s*[><]=?/);
      expect(CHECKER_CODE).not.toMatch(/MIN_(?:SCOPED|COVERAGE|COVERED_CALL)/);
      // Le consommateur mappe FAIL-CLOSED : seul `ok` atteint `record`.
      expect(CHECKER_CODE).toContain("if (verdict.kind === 'ok') record(");
      expect(CHECKER_CODE).toContain('else fail(verdict.label, verdict.detail)');
    });

    it('AC-10 porte son propre fail-before / pass-after sur `role` et `role_permission`', () => {
      // Les deux tables ÉTAIENT dans la liste des bloqueurs avant cette story
      // (SELECT détenu, cinq sites d'écriture). Leur ABSENCE est ce que « PF-193
      // est fermée » VEUT DIRE, et elle est assertée plutôt que racontée.
      expect(CHECKER_CODE).toContain('AC-10 PF-193 is CLOSED');
      expect(CHECKER_CODE).toContain('WRITE_GUARD_TABLES');
      expect([...sibling.WRITE_GUARD_TABLES].sort()).toEqual(['role', 'role_permission']);
    });

    it('les bords honnêtes du scan sont IMPRIMÉS, y compris celui que la technique ne peut pas voir', () => {
      // Le SQL brut ne porte ni modèle ni verbe : PF-197, deux `CREATE UNIQUE
      // INDEX` au boot, tous deux emballés dans un try/catch qui les dégrade en
      // `logger.warn` — donc silencieux après la bascule.
      expect(CHECKER_CODE).toContain('rawSqlSites');
      expect(CHECKER_CODE).toContain('PF-197');
      // Et les écritures IMBRIQUÉES de Prisma, qui n'émettent aucun jeton
      // `récepteur.modèle.verbe` : la LISTE de sites est incomplète même quand
      // le VERDICT est juste, et le dire est la différence avec le taire.
      expect(CHECKER_CODE).toContain('NESTED writes');
    });

    it('AC-11 — le résidu est REPORTÉ TEL QUE MESURÉ, et il falsifie deux findings pré-alloués', () => {
      // MESURÉ ce run : `20260813120000` accorde `SELECT, INSERT, UPDATE,
      // DELETE` à chaque table tenant-scopée non append-only. La prémisse « les
      // 44 ne détiennent que SELECT, INSERT » — sur laquelle PF-195 et PF-196
      // reposaient — est donc FAUSSE, et un id dépensé sur un défaut inexistant
      // est pire que pas d'id du tout.
      expect(CHECKER_CODE).toContain('falsifies two pre-allocated findings');
      expect(CHECKER_CODE).toContain('20260813120000:480');
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

/**
 * S-E01-1k / PF-246 / PF-219 / ADR-059 — LA CLÔTURE DE LA SONDE DE DÉMARRAGE
 * CESSE D'ÊTRE ÉCRITE À LA MAIN ET DEVIENT DÉRIVÉE.
 *
 * CE QUE CE `describe` ACHÈTE, ET POURQUOI IL EST ICI PLUTÔT QUE DANS UN MODULE.
 * `APP_ROLE_REQUIRED_PRIVILEGES` est parcourue AU DÉMARRAGE par `appRoleVerdict` :
 * une paire MANQUANTE fait certifier `enforcing: true` sur une clôture jamais
 * vérifiée (42501 à l'exécution), une paire EN TROP rend `refused_unusable` et
 * refuse la DEUXIÈME connexion de l'application — admin, teacher, parent ET
 * student tombent ENSEMBLE. Le rayon de souffle est global, donc la preuve l'est
 * aussi : elle vit avec les autres gardes transverses, pas dans un module.
 *
 * TOUT CE QUI SUIT EST HERMÉTIQUE (ADR-039) : des fonctions PURES nourries de
 * source SYNTHÉTIQUE, sans base de données et sans scan du dépôt — sauf UNE
 * assertion, la fidélité du lecteur (AC-5), qui DOIT lire le vrai fichier
 * puisque c'est précisément ce qu'elle prouve.
 *
 * LES TROIS PIÈGES QUE CES TESTS ÉPINGLENT, chacun mesuré et non imaginé :
 *  1. `tx` est le paramètre de callback de la portée locataire ET de
 *     `this.prisma.$transaction`, qui tourne sur la connexion du PROPRIÉTAIRE.
 *     Un grep `tx.` produit trois paires FANTÔMES. Seule l'attribution
 *     POSITIONNELLE les distingue.
 *  2. Une relation traversée par un `where`, un `select`, un `include`, un
 *     `orderBy` ou un `_count.select` est une table LUE sous RLS. Un dérivateur
 *     qui ne voit que les délégués racines est MOINS complet que la liste qu'il
 *     remplace, et ses angles morts se présentent comme des `dead-entry` — donc
 *     comme une invitation à supprimer un droit dont le runtime a besoin.
 *  3. Un `include: CONSTANTE_HISSÉE` (20 sites mesurés, dont huit `PLAN_INCLUDE`)
 *     est invisible à un dérivateur qui ne lit que les littéraux en ligne.
 */
describe('S-E01-1k / ADR-059 — la clôture de privilèges est DÉRIVÉE, dans les deux sens', () => {
  /** Un schéma SYNTHÉTIQUE minuscule : la forme, pas le vrai catalogue. */
  const SCHEMA = [
    'enum Status { active }',
    'model Grade {',
    '  id           String  @id',
    '  tenantId     String  @map("tenant_id")',
    '  assessmentId String  @map("assessment_id")',
    '  assessment   Assessment @relation(fields: [assessmentId], references: [id])',
    '  @@map("grade")',
    '}',
    'model Assessment {',
    '  id       String @id',
    '  termId   String @map("term_id")',
    '  term     Term   @relation(fields: [termId], references: [id])',
    '  grades   Grade[]',
    '  @@unique([id, termId])',
    '  @@map("assessment")',
    '}',
    'model Term {',
    '  id     String @id',
    '  status Status',
    '  @@map("term")',
    '}',
    'model Booking {',
    '  id     String @id',
    '  tutorId String @map("tutor_id")',
    '  tutor  Tutor  @relation(fields: [tutorId], references: [id])',
    '  @@map("booking")',
    '}',
    'model Tutor {',
    '  id       String    @id',
    '  bookings Booking[]',
    '  @@map("tutor")',
    '}',
    'model AuditLog {',
    '  id String @id',
    '  @@map("audit_log")',
    '}',
  ].join('\n');

  const schema = (): ReturnType<typeof checker.parsePrismaSchema> => checker.parsePrismaSchema(SCHEMA);
  const derive = (
    text: string,
    path = 'apps/api/src/modules/fixture/fixture.service.ts',
  ): ReturnType<typeof checker.derivePrivilegeClosure> =>
    checker.derivePrivilegeClosure({ sources: [{ path, text }], schema: schema() });
  const keys = (out: ReturnType<typeof checker.derivePrivilegeClosure>): string[] =>
    [...out.derived.values()].map((e) => `${e.table}.${e.privilege}`).sort();

  // -------------------------------------------------------------------------
  describe('ADR-059 §D2 — le graphe modèle → table → relation vient de schema.prisma', () => {
    it('il lit les @@map, les relations ET les clés composées', () => {
      const parsed = schema();
      expect(parsed.problems).toEqual([]);
      expect(parsed.modelToTable.get('grade')).toBe('grade');
      expect(parsed.byClientProperty.get('grade')?.relations.get('assessment')).toBe('Assessment');
      // `@@unique([id, termId])` devient la clé de recherche `id_termId`, qui
      // n'est NI une colonne NI une relation. Sans elle, `where:
      // { id_termId: {...} }` remontait comme un champ inconnu — un refus
      // fail-closed sur une simple recherche scalaire (mesuré deux fois sur le
      // vrai corpus).
      expect([...(parsed.byClientProperty.get('assessment')?.compoundKeys.keys() ?? [])]).toEqual(['id_termId']);
    });

    it('un modèle SANS @@map est NOMMÉ, jamais toléré (DNC-08)', () => {
      const bad = checker.parsePrismaSchema('model Orphan {\n  id String @id\n}');
      expect(bad.problems.map((p) => p.kind)).toContain('model-without-map');
    });

    it('un schéma VIDE est un PROBLÈME, pas un graphe vide', () => {
      // La direction dangereuse : un graphe vide rend toute relation invisible et
      // fait passer la liste déclarée ENTIÈRE pour morte.
      const empty = checker.parsePrismaSchema('');
      expect(empty.problems.map((p) => p.kind)).toContain('no-models');
      expect(empty.models.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('AC-2 / AC-1 — l’attribution est POSITIONNELLE, jamais un grep `tx.`', () => {
    /**
     * LE PIÈGE, REPRODUIT EN MINIATURE. Les deux callbacks lient `tx`. Le premier
     * est la portée locataire (`app_user`, RLS appliqué) ; le second est
     * `this.prisma.$transaction`, la connexion du PROPRIÉTAIRE, qui échappe aux
     * policies. Un dérivateur sans attribution positionnelle rend DEUX paires.
     */
    const BOTH = [
      'export class Fixture {',
      '  async run(a: string) {',
      '    await this.scope.run(a, async (tx) => {',
      '      await tx.grade.findMany({ where: { tenantId: a } });',
      '    });',
      '    await this.prisma.$transaction(async (tx) => {',
      '      await tx.booking.create({ data: { id: a } });',
      '    });',
      '  }',
      '}',
    ].join('\n');

    it('UNE paire dérivée, pas deux : l’écriture du `$transaction` propriétaire est REFUSÉE', () => {
      const out = derive(BOTH);
      expect(out.problems).toEqual([]);
      expect(out.scopedSites).toBe(1);
      expect(keys(out)).toEqual(['grade.SELECT']);
      // La direction qui échoue, énoncée : la paire fantôme est ABSENTE.
      expect(out.derived.has(checker.closureKey('booking', 'INSERT'))).toBe(false);
    });

    it('un récepteur PROPRIÉTAIRE dans une portée ne compte pas non plus', () => {
      const owner = [
        'export class Fixture {',
        '  async run(a: string) {',
        '    await this.scope.run(a, async (tx) => {',
        '      await this.prisma.grade.findMany({ where: { tenantId: a } });',
        '    });',
        '  }',
        '}',
      ].join('\n');
      const out = derive(owner);
      // `classifyCallSite` rend `owner-inside-scope` : la requête tourne sur la
      // connexion du propriétaire, donc elle n'exige AUCUN droit d'`app_user`.
      expect(out.scopedSites).toBe(0);
      expect(keys(out)).toEqual([]);
    });

    it('un fichier dont la portée ne se referme pas contribue ZÉRO et est NOMMÉ (TOOL-39)', () => {
      const unbalanced = [
        '/**',
        ' * Une phrase de docblock qui nomme this.scope.run( sans jamais la refermer.',
        ' */',
        'export class Fixture {',
        '  async run(a: string) {',
        '    await this.scope.run(a, async (tx) => {',
        '      await tx.grade.findMany({ where: { tenantId: a } });',
        '    });',
        '  }',
        '}',
      ].join('\n');
      const out = derive(unbalanced);
      expect(out.unbalancedFiles.size).toBe(1);
      expect(keys(out)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('AC-3 — la PROFONDEUR RELATIONNELLE est marchée, et l’illisible est NOMMÉ', () => {
    it('trois niveaux : grade → assessment → term, depuis un `select` imbriqué', () => {
      const deep = [
        'export class Fixture {',
        '  async run(a: string) {',
        '    await this.scope.run(a, async (tx) => {',
        '      await tx.grade.findMany({',
        '        where: { tenantId: a },',
        '        select: { id: true, assessment: { select: { term: { select: { id: true } } } } },',
        '      });',
        '    });',
        '  }',
        '}',
      ].join('\n');
      const out = derive(deep);
      expect(out.problems).toEqual([]);
      expect(keys(out)).toEqual(['assessment.SELECT', 'grade.SELECT', 'term.SELECT']);
      expect(out.derived.get(checker.closureKey('term', 'SELECT'))?.origin).toBe('relation');
      expect(out.derived.get(checker.closureKey('term', 'SELECT'))?.via).toBe('select.assessment.term');
    });

    it('un FILTRE relationnel de `where` compte autant qu’un `include` — c’est PF-246', () => {
      const filtered = [
        'export class Fixture {',
        '  async run(a: string) {',
        '    await this.scope.run(a, async (tx) => {',
        '      await tx.grade.findFirst({ where: { tenantId: a, assessment: { termId: a } } });',
        '    });',
        '  }',
        '}',
      ].join('\n');
      expect(keys(derive(filtered))).toEqual(['assessment.SELECT', 'grade.SELECT']);
    });

    it('`orderBy` sur une relation est une JOINTURE, donc une LECTURE', () => {
      const ordered = [
        'export class Fixture {',
        '  async run(a: string) {',
        '    await this.scope.run(a, async (tx) => {',
        '      await tx.grade.findMany({ where: { tenantId: a }, orderBy: { assessment: { id: "desc" } } });',
        '    });',
        '  }',
        '}',
      ].join('\n');
      expect(keys(derive(ordered))).toEqual(['assessment.SELECT', 'grade.SELECT']);
    });

    it('`_count: { select: { relation } }` compte ; `_count: { _all: true }` ne compte pas', () => {
      const counted = [
        'export class Fixture {',
        '  async run(a: string) {',
        '    await this.scope.run(a, async (tx) => {',
        '      await tx.tutor.findMany({ select: { id: true, _count: { select: { bookings: true } } } });',
        '      await tx.tutor.findMany({ select: { _count: { _all: true } } });',
        '    });',
        '  }',
        '}',
      ].join('\n');
      expect(keys(derive(counted))).toEqual(['booking.SELECT', 'tutor.SELECT']);
    });

    it('PF-250 — une CONSTANTE HISSÉE passée en `include:` est RÉSOLUE, pas ignorée', () => {
      // La forme mesurée sur le vrai arbre : `PLAN_INCLUDE` est déclaré ligne 21,
      // HORS de toute portée, et utilisé à huit sites d'appel DANS une portée. Un
      // dérivateur en-ligne-seulement rend zéro relation, puis la comparaison
      // bidirectionnelle déclare MORTES deux paires correctement déclarées.
      const hoisted = [
        'const PLAN_INCLUDE = {',
        '  assessment: { select: { term: { select: { id: true } } } },',
        '} satisfies Prisma.GradeInclude;',
        'export class Fixture {',
        '  async run(a: string) {',
        '    await this.scope.run(a, async (tx) => {',
        '      await tx.grade.findMany({ where: { tenantId: a }, include: PLAN_INCLUDE });',
        '    });',
        '  }',
        '}',
      ].join('\n');
      const out = derive(hoisted);
      expect(out.problems).toEqual([]);
      expect(keys(out)).toEqual(['assessment.SELECT', 'grade.SELECT', 'term.SELECT']);
    });

    it('un identifiant NON résoluble est NOMMÉ et FAIT ÉCHOUER — jamais « aucune relation »', () => {
      const unknown = [
        'export class Fixture {',
        '  async run(a: string) {',
        '    await this.scope.run(a, async (tx) => {',
        '      await tx.grade.findMany({ where: { tenantId: a }, include: SOMETHING_ELSE });',
        '    });',
        '  }',
        '}',
      ].join('\n');
      const out = derive(unknown);
      expect(out.problems.map((p) => p.kind)).toEqual(['unresolvable-argument-reference']);
      // …et le problème REMONTE jusqu'au verdict, il ne reste pas dans un coin.
      const drift = checker.privilegeClosureDrift({
        declared: declaredFixture(40),
        derived: out.derived,
        derivedProblems: out.problems,
        scopedSites: 70,
      });
      expect(drift.map((f) => f.kind)).toContain('unparseable-argument');
    });

    it('une clé d’argument HORS du jeu FERMÉ est NOMMÉE (DNC-08)', () => {
      const weird = [
        'export class Fixture {',
        '  async run(a: string) {',
        '    await this.scope.run(a, async (tx) => {',
        '      await tx.grade.findMany({ whereish: { tenantId: a } });',
        '    });',
        '  }',
        '}',
      ].join('\n');
      expect(derive(weird).problems.map((p) => p.kind)).toEqual(['unknown-argument-key']);
      // Le jeu est FERMÉ, et il est affirmé ici plutôt que raconté.
      expect(checker.PRISMA_ARGUMENT_KEYS.orderBy).toBe('relation');
      expect(checker.PRISMA_ARGUMENT_KEYS.data).toBe('write-payload');
      expect(checker.PRISMA_ARGUMENT_KEYS.whereish).toBeUndefined();
    });

    it('une ÉCRITURE IMBRIQUÉE sous `data` est REFUSÉE plutôt que modélisée', () => {
      // Grepé sur les cinq modules convertis à aaff53b : ZÉRO. Ce n'est donc pas
      // un trou vivant, c'est le PROCHAIN PF-246, et il coûte une entrée de jeu
      // fermé à désamorcer.
      const nested = [
        'export class Fixture {',
        '  async run(a: string) {',
        '    await this.scope.run(a, async (tx) => {',
        '      await tx.booking.create({ data: { id: a, tutor: { connect: { id: a } } } });',
        '    });',
        '  }',
        '}',
      ].join('\n');
      expect(derive(nested).problems.map((p) => p.kind)).toEqual(['nested-write-under-payload']);
    });

    it('PF-252 — une policy FK-dérivée ajoute le SELECT du PARENT, que nul site d’appel ne montre', () => {
      const sql = [
        'derived CONSTANT text[][] := ARRAY[',
        "  ARRAY['announcement_receipt', 'announcement_id', 'announcement', 'SELECT, INSERT, UPDATE'],",
        "  ARRAY['grade_revision',       'grade_id',        'grade',        'SELECT, INSERT']",
        '];',
      ].join('\n');
      const policies = checker.parseDerivedChildParents(sql);
      expect(policies.problems).toEqual([]);
      expect(policies.parents.get('grade_revision')?.parent).toBe('grade');
      const out = checker.derivePrivilegeClosure({
        sources: [
          {
            path: 'apps/api/src/modules/fixture/fixture.service.ts',
            text: [
              'export class Fixture {',
              '  async run(a: string) {',
              '    await this.scope.run(a, async (tx) => {',
              '      await tx.booking.findMany({ where: { tenantId: a } });',
              '    });',
              '  }',
              '}',
            ].join('\n'),
          },
        ],
        schema: schema(),
        derivedChildParents: new Map([['booking', { parent: 'tutor', fk: 'tutor_id', privileges: 'SELECT' }]]),
      });
      expect(keys(out)).toEqual(['booking.SELECT', 'tutor.SELECT']);
      expect(out.derived.get(checker.closureKey('tutor', 'SELECT'))?.origin).toBe('policy');
    });

    it('un tableau ARRAY vide ou introuvable dans la migration est un PROBLÈME', () => {
      expect(checker.parseDerivedChildParents('-- rien ici').problems.map((p) => p.kind)).toEqual([
        'derived-policy-table-not-found',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe('ADR-059 §D1 — le côté DÉCLARÉ est LU, jamais retapé ni pris dans dist/', () => {
    const FIXTURE = [
      'export const APP_ROLE_REQUIRED_PRIVILEGES: readonly AppRolePrivilegeRequirement[] = Object.freeze([',
      "  // Un commentaire qui cite `assessment: { teachingAssignment: { subjectId } }`,",
      '  // exactement la forme qui avait fabriqué trois entrées fantômes.',
      "  { table: 'grade', privilege: 'SELECT', why: 'les notes publiées de l’élève lui-même' },",
      '  {',
      "    table: 'assessment',",
      "    privilege: 'SELECT',",
      "    why: 'relation TRAVERSÉE, pas racine : chaque note descend son assessment ' +",
      "      '(titre, barème, coefficient)',",
      '  },',
      ']);',
    ].join('\n');

    it('il lit les entrées, y compris une raison CONCATÉNÉE sur plusieurs lignes', () => {
      const read = checker.parseAppRoleRequiredPrivileges(FIXTURE);
      expect(read.pairs.map((p) => `${p.table}.${p.privilege}`)).toEqual(['grade.SELECT', 'assessment.SELECT']);
      // La deuxième raison est REJOINTE, pas tronquée à son premier fragment :
      // une raison tronquée fait juger la garde anti-vacuité sur une phrase
      // qu'elle n'a jamais vue.
      expect(read.pairs[1]?.why).toContain('coefficient');
    });

    it('une accolade dans un COMMENTAIRE ne fabrique pas d’entrée fantôme', () => {
      const read = checker.parseAppRoleRequiredPrivileges(FIXTURE);
      expect(read.problems.filter((p) => p.kind === 'entry-without-pair')).toEqual([]);
    });

    it('une constante ABSENTE, un `Object.freeze(` introuvable, une entrée sans paire : tous NOMMÉS', () => {
      expect(
        checker.parseAppRoleRequiredPrivileges('const AUTRE = [];').problems.map((p) => p.kind),
      ).toEqual(['constant-not-found']);
      expect(
        checker
          .parseAppRoleRequiredPrivileges('const APP_ROLE_REQUIRED_PRIVILEGES = [{ table: "x" }];')
          .problems.map((p) => p.kind),
      ).toEqual(['object-freeze-boundary-not-found']);
      const noPair = checker.parseAppRoleRequiredPrivileges(
        'const APP_ROLE_REQUIRED_PRIVILEGES = Object.freeze([{ privilege: "SELECT", why: "une raison assez longue" }]);',
      );
      expect(noPair.problems.map((p) => p.kind)).toContain('entry-without-pair');
    });

    it('une raison VACUEUSE est refusée par la MÊME règle que `tenant-scope.ts:159-164`', () => {
      const vacuous = checker.parseAppRoleRequiredPrivileges(
        'const APP_ROLE_REQUIRED_PRIVILEGES = Object.freeze([{ table: "grade", privilege: "SELECT", why: "grade" }]);',
      );
      expect(vacuous.problems.map((p) => p.kind)).toContain('entry-with-vacuous-reason');
    });

    it('un parseur qui rend [] est un feu VERT qui ne prouve rien — il est REFUSÉ (AC-4)', () => {
      const none = checker.parseAppRoleRequiredPrivileges(
        'const APP_ROLE_REQUIRED_PRIVILEGES = Object.freeze([]);',
      );
      expect(none.problems.map((p) => p.kind)).toContain('no-entries-parsed');
    });

    it('AUCUN chemin sous `apps/api/dist` n’est lu — dist est PÉRIMÉ par construction', () => {
      // Les agents ne construisent jamais (GUARDRAILS §4), donc `dist` décrit un
      // état que la source a déjà dépassé : comparer contre lui, c'est PF-246
      // reproduit DANS son propre correctif.
      const READER = lf(readFileSync(join(REPO_ROOT, 'scripts', 'lib', 'app-role-closure.js'), 'utf8'));
      expect(executableJs(READER)).not.toContain('apps/api/dist');
      // La négation porte sur une LECTURE, pas sur le mot : le vérificateur NOMME
      // `apps/api/dist` dans la phrase qui explique pourquoi il ne le lit pas, et
      // une assertion sur le mot nu ne serait verte qu’en supprimant l’explication.
      expect(CHECKER_CODE).not.toMatch(/(?:require|readFileSync|readFileOrEmpty)\([^)]*dist/);
      // …et la source qu'il lit est NOMMÉE.
      expect(CHECKER_CODE).toContain('apps/api/src/shared/prisma/tenant-scope.ts');
    });

    /**
     * AC-5 — LA FIDÉLITÉ DU LECTEUR, la seule assertion de ce `describe` qui lit
     * un vrai fichier, parce que c'est exactement ce qu'elle prouve : ce que le
     * gate PARSE est ce que l'application IMPORTE. Sans elle, tout le reste
     * pourrait être vert sur une liste que personne ne charge au démarrage.
     */
    it('AC-5 — ce que le gate PARSE === ce que l’application IMPORTE, paire par paire', () => {
      const source = lf(
        readFileSync(join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'prisma', 'tenant-scope.ts'), 'utf8'),
      );
      const parsed = checker.parseAppRoleRequiredPrivileges(source);
      expect(parsed.problems).toEqual([]);
      const fromParse = parsed.pairs.map((p) => `${p.table}.${p.privilege}`).sort();
      const fromImport = APP_ROLE_REQUIRED_PRIVILEGES.map((r) => `${r.table}.${r.privilege}`).sort();
      expect(fromParse).toEqual(fromImport);
      // Non-vacuité : une comparaison de deux ensembles vides serait verte.
      expect(fromImport.length).toBeGreaterThanOrEqual(38);
      // …et les RAISONS sont lues entières, pas seulement les paires.
      for (const pair of parsed.pairs) expect(pair.why.trim().length).toBeGreaterThan(10);
    });
  });

  // -------------------------------------------------------------------------
  /**
   * AC-7 — CHAQUE ESPÈCE DE DÉRIVE EST POUSSÉE AU ROUGE EXPRÈS.
   *
   * Le même motif qu'`enumerationDrift` : un cliquet qu'on ne peut pas faire
   * rougir n'est pas un cliquet, c'est une décoration qu'on supprimera le premier
   * vendredi où elle gêne.
   */
  describe('AC-7 — `privilegeClosureDrift` MORD, espèce par espèce', () => {
    const derivedMap = (
      pairs: ReadonlyArray<[string, string, ('root' | 'relation' | 'policy')?]>,
    ): Map<string, DerivedPair> => {
      const out = new Map<string, DerivedPair>();
      for (const [table, privilege, origin] of pairs) {
        out.set(checker.closureKey(table, privilege), {
          table,
          privilege,
          origin: origin ?? 'root',
          example: 'apps/api/src/modules/fixture/fixture.service.ts:1',
          via: null,
          hits: 1,
        });
      }
      return out;
    };

    it('le CHEMIN VERT existe : 40 paires des deux côtés, zéro finding', () => {
      const declared = declaredFixture(40);
      const derived = derivedMap(declared.map((d) => [d.table, d.privilege] as [string, string]));
      expect(
        checker.privilegeClosureDrift({ declared, derived, scopedSites: 70 }),
      ).toEqual([]);
    });

    it('`undeclared-pair` — une instruction de portée en a besoin, la liste ne la porte pas', () => {
      const declared = declaredFixture(40);
      const derived = derivedMap([
        ...declared.map((d) => [d.table, d.privilege] as [string, string]),
        ['guardian', 'SELECT', 'relation'],
      ]);
      const drift = checker.privilegeClosureDrift({ declared, derived, scopedSites: 70 });
      expect(drift.map((f) => f.kind)).toEqual(['undeclared-pair']);
      expect(drift[0]?.pair).toBe('guardian.SELECT');
      // Le finding NOMME son site d'appel : un mur de paires sans `file:line` est
      // un cliquet qu'on supprime le premier vendredi.
      expect(drift[0]?.detail).toContain('fixture.service.ts:1');
    });

    it('`dead-entry-advisory` — et son détail INTERDIT la suppression sur ce seul constat (PM-1)', () => {
      const declared = declaredFixture(40);
      const derived = derivedMap(declared.slice(1).map((d) => [d.table, d.privilege] as [string, string]));
      const drift = checker.privilegeClosureDrift({ declared, derived, scopedSites: 70 });
      expect(drift.map((f) => f.kind)).toEqual(['dead-entry-advisory']);
      // L'ASYMÉTRIE est ENCODÉE, pas commentée : la complétude de la dérivation
      // est bornée par ce qu'une analyse statique VOIT, donc « mort » veut dire
      // « le marcheur ne l'a pas vu » au moins aussi souvent que « personne n'en
      // a besoin ». Supprimer sur cette foi = 42501 sur quatre portails.
      expect(drift[0]?.detail).toContain('DO NOT DELETE IT ON THIS FINDING ALONE');
      expect(drift[0]?.detail).toContain('MEASURED negative');
    });

    it('TOOL-39 — tant qu’un fichier ne se referme pas, AUCUN `dead-entry` n’est réclamé', () => {
      const declared = declaredFixture(40);
      const drift = checker.privilegeClosureDrift({
        declared,
        derived: derivedMap([]),
        unbalancedFiles: new Map([['apps/api/src/modules/x/x.service.ts', 1]]),
        scopedSites: 70,
      });
      // Fail-closed VERS la déclaration — le côté sûr. Un `.run(` égaré dans un
      // docblock ferait sinon passer un module entier pour des droits morts.
      expect(drift.map((f) => f.kind)).toEqual(['unbalanced-scope-file']);
      expect(drift[0]?.detail).toContain('x.service.ts');
    });

    it('`entry-without-reason` — une liste de RAISONS, pas de chemins', () => {
      const declared = [...declaredFixture(39), { table: 'zz', privilege: 'SELECT', why: '   ' }];
      const derived = derivedMap(declared.map((d) => [d.table, d.privilege] as [string, string]));
      const drift = checker.privilegeClosureDrift({ declared, derived, scopedSites: 70 });
      expect(drift.map((f) => f.kind)).toEqual(['entry-without-reason']);
    });

    it('`unparseable-argument` et `unmapped-relation-target` remontent du marcheur au verdict', () => {
      const declared = declaredFixture(40);
      const derived = derivedMap(declared.map((d) => [d.table, d.privilege] as [string, string]));
      const drift = checker.privilegeClosureDrift({
        declared,
        derived,
        derivedProblems: [
          { kind: 'unparseable-argument', where: 'a.ts:1', detail: 'ne ferme pas' },
          { kind: 'unmapped-relation-target', where: 'b.ts:2', detail: 'aucune table' },
        ],
        scopedSites: 70,
      });
      expect(drift.map((f) => f.kind).sort()).toEqual(['unmapped-relation-target', 'unparseable-argument']);
    });

    it('`exception-without-reason` et `dead-exception` — AC-6 vérifiée AVANT d’être crue', () => {
      // Une exception excuse une paire que la dérivation NE PEUT PAS VOIR. Donc
      // `seen` est DÉCLARÉE **et** dérivée : l'excuse est morte, la paire n'est
      // pas en dérive, et le seul finding qu’elle doit produire est le sien.
      const declared = [...declaredFixture(40), { table: 'seen', privilege: 'SELECT', why: 'lue par le handler de la fixture, dans sa portée' }];
      const derived = derivedMap(declared.map((d) => [d.table, d.privilege] as [string, string]));
      const drift = checker.privilegeClosureDrift({
        declared,
        derived,
        scopedSites: 70,
        exceptions: [
          // Une raison qui RÉPÈTE la table : refusée par la garde anti-vacuité.
          { table: 'ghost', privilege: 'SELECT', why: 'ghost' },
          // Une exception que la dérivation VOIT maintenant : elle est MORTE.
          { table: 'seen', privilege: 'SELECT', why: 'la dérivation ne peut pas voir ce chemin car X' },
        ],
      });
      expect(drift.map((f) => f.kind).sort()).toEqual(['dead-exception', 'exception-without-reason']);
    });

    it('une exception VALIDE excuse la paire — et c’est la seule façon d’en excuser une', () => {
      // La forme RÉELLE d’une exception : une paire DÉCLARÉE que la dérivation ne
      // voit pas. Sans l'exception elle serait un `dead-entry-advisory` ; avec
      // elle, et seulement avec une raison qui dit POURQUOI, le verdict est vide.
      const declared = [...declaredFixture(40), { table: 'invisible', privilege: 'SELECT', why: 'exigée par un trigger, hors de tout site d’appel' }];
      const derived = derivedMap(declaredFixture(40).map((d) => [d.table, d.privilege] as [string, string]));
      const drift = checker.privilegeClosureDrift({
        declared,
        derived,
        scopedSites: 70,
        exceptions: [
          {
            table: 'invisible',
            privilege: 'SELECT',
            why: 'la dérivation ne peut pas la voir : le privilège est exigé par un TRIGGER, pas par un site d’appel',
          },
        ],
      });
      expect(drift).toEqual([]);
    });

    it('AC-4 — les DEUX planchers de non-vacuité sont des MURS (DNC-10)', () => {
      // Côté déclaré : une liste effondrée est une panne de parseur, jamais un
      // corpus qui a rétréci.
      const thin = checker.privilegeClosureDrift({
        declared: declaredFixture(3),
        derived: derivedMap([]),
        scopedSites: 70,
      });
      expect(thin.map((f) => f.kind)).toContain('vacuous-comparison');
      // Côté dérivé : zéro site attribué `scoped` rendrait TOUTE la liste morte.
      const noSites = checker.privilegeClosureDrift({
        declared: declaredFixture(40),
        derived: derivedMap(declaredFixture(40).map((d) => [d.table, d.privilege] as [string, string])),
        scopedSites: 0,
      });
      expect(noSites.map((f) => f.kind)).toContain('vacuous-comparison');
      // Et le plancher est une CONSTANTE nommée, pas un argument tunable.
      expect(checker.MIN_CLOSURE_INPUT_SITES).toBeGreaterThanOrEqual(40);
    });

    it('la comparaison est un ENSEMBLE, pas un multi-ensemble', () => {
      // Un DEUXIÈME site d'appel qui a besoin du même privilège n'est pas une
      // deuxième obligation. (`enumerationDrift` compare des multi-ensembles
      // parce qu'une deuxième EXCUSE est un vrai élargissement ; un deuxième
      // BESOIN est le même droit.)
      const declared = declaredFixture(40);
      const derived = derivedMap(declared.map((d) => [d.table, d.privilege] as [string, string]));
      const head = declared[0]!;
      const first = derived.get(checker.closureKey(head.table, head.privilege));
      if (first) first.hits = 17;
      expect(checker.privilegeClosureDrift({ declared, derived, scopedSites: 70 })).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('AC-10 / DNC-10 — la dérivation est dans le VERDICT, et rien ne peut l’éteindre', () => {
    it('la dérive fait ÉCHOUER, elle n’est pas imprimée en `[LIMIT]`', () => {
      // Une note dont personne n'échoue reproduirait PF-02 DANS le mécanisme
      // construit pour le fermer.
      const at = CHECKER_CODE.indexOf('readiness.closureDrift.length > 0');
      expect(at).toBeGreaterThan(-1);
      const branch = CHECKER_CODE.slice(at, at + 400);
      expect(branch).toContain('fail(');
      expect(branch).not.toContain('limit(');
    });

    it('AUCUN drapeau, AUCUNE variable d’environnement ne touche la clôture', () => {
      const CLOSURE_CODE = [
        executableJs(lf(readFileSync(join(REPO_ROOT, 'scripts', 'lib', 'app-role-closure.js'), 'utf8'))),
        executableJs(lf(readFileSync(join(REPO_ROOT, 'scripts', 'lib', 'prisma-schema-graph.js'), 'utf8'))),
        executableJs(lf(readFileSync(join(REPO_ROOT, 'scripts', 'lib', 'js-source-scan.js'), 'utf8'))),
      ].join('\n');
      expect(CLOSURE_CODE).not.toContain('process.env');
      expect(CLOSURE_CODE).not.toMatch(/\b(SKIP|ALLOW|FORCE|BYPASS|IGNORE|DISABLE)_[A-Z_]+/);
      expect(CLOSURE_CODE).not.toContain('NODE_ENV');
    });

    it('la liste d’exceptions AC-6 est VIDE sur le corpus d’aujourd’hui, et c’est une MESURE', () => {
      // Le jour où elle ne l'est plus, chaque entrée doit dire POURQUOI la
      // dérivation ne peut pas la voir — pas « autoriser cette table ».
      expect(checker.APP_ROLE_CLOSURE_EXCEPTIONS).toEqual([]);
    });

    it('un SEUL matcher de délimiteurs existe (TOOL-39), et il est PARTAGÉ', () => {
      // Deux matchers auraient été la maladie de cette tranche elle-même.
      expect(CHECKER_CODE).toContain("require('./lib/js-source-scan')");
      expect(CHECKER_CODE).not.toContain('function matchingParen(');
      // …et le comportement re-exporté est IDENTIQUE à celui qui était livré.
      expect(checker.matchingParen('f(a, b)', 1)).toBe(6);
      expect(checker.matchingParen('f(a, (b)', 1)).toBe(-1);
      expect(checker.matchingParen("f('(')", 1)).toBe(5);
    });
  });
});

/**
 * Une liste déclarée SYNTHÉTIQUE de `n` paires, au-dessus des deux planchers.
 * Elle existe pour que chaque assertion de dérive isole SON espèce au lieu de
 * tomber d'abord sur une comparaison vacueuse.
 */
function declaredFixture(n: number): Array<{ table: string; privilege: string; why: string }> {
  return Array.from({ length: n }, (_unused, i) => ({
    table: `t${String(i).padStart(2, '0')}`,
    privilege: 'SELECT',
    why: `la table t${i} est lue par le handler numéro ${i} de la fixture, dans sa portée`,
  }));
}
