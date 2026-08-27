import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-3d / `AC-4` / `PF-356` / `PF-12` axe 4 / `ADR-076` — LE CLIQUET :
 * aucune lecture élève ne fait CO-OCCURRER une clé `schoolId` NUE et un jeu
 * d'ids ABAC (`id: { in: … }`) dans le même `where`.
 *
 * LA RÈGLE, EN UNE LIGNE
 * ----------------------
 * Dans un `where` de lecture élève, `schoolId` (lié à une VALEUR, donc une
 * égalité) et `id: { in: … }` sont MUTUELLEMENT EXCLUSIFS. Le sentinel non
 * restreint (`studentIds === null`, admins) garde son école de travail ; un jeu
 * d'ids explicite est déjà l'autorité et repart sans clé d'école.
 *
 * POURQUOI LA RÈGLE PORTE SUR LA CO-OCCURRENCE ET NON SUR `schoolId`
 * -----------------------------------------------------------------
 * Une règle énoncée « aucun `schoolId` dans un `where` élève » signalerait
 * QUATORZE littéraux mesurés ce run, dont la totalité des compteurs d'analytics
 * d'établissement, le cache d'import et la file de réclamations d'enfant —
 * et, pire, elle signalerait la BRANCHE ADMIN que `AC-3` exige de PRÉSERVER.
 * Au moment du gate il ne resterait que les trois sorties que R-30 interdit :
 * une allowlist longue, une conversion hors périmètre, ou un relâchement de la
 * règle jusqu'à ce qu'elle passe. Le discriminant est donc la CO-OCCURRENCE,
 * c'est-à-dire exactement la forme du défaut : « l'autorité ABAC, rétrécie par
 * une heuristique d'école ».
 *
 * ET C'EST CE QUI TRANCHE `calendar.controller.ts` AU MOMENT DE LA CONCEPTION,
 * pas au moment où le gate rougirait. Ce handler bâtit bien
 * `{ tenantId, schoolId }` depuis `ctx.forTenant` puis l'intersecte avec la
 * visibilité ABAC du parent — le MÊME défaut, sur un AUTRE agrégat. Il n'est
 * PAS contrevenant ici parce que son `where` porte sur `calendarEvent`, pas sur
 * `student` : la règle est bornée PAR CONSTRUCTION aux lectures élève, pas par
 * une exemption nominative. Le résidu est ENREGISTRÉ (`PF-389`, P2), non
 * corrigé — une tranche qui resserre la liste élève n'élargit pas au calendrier
 * au passage.
 *
 * POURQUOI LE ROUGE-AVANT EST UNE FIXTURE ET NON `git show origin/main:`
 * ---------------------------------------------------------------------
 * `AC-4` demandait « un ROUGE-AVANT authentique contre les sources
 * `origin/main` ». Ce dépôt a DÉJÀ tranché contre cet idiome et l'a écrit :
 * `walk-read-gate.spec.ts` enregistre qu'un contrôle bâti sur `git show HEAD:`
 * S'INVERSE à l'instant où la tranche est committée, et que la CI checkout en
 * profondeur 1. L'idiome maison est la CONSTRUCTION PRÉ-TRANCHE reconstruite
 * DANS la spec (`audit-provenance-gate`, `open-redirect-gate`). C'est ce qui est
 * fait plus bas, et la déviation est ÉNONCÉE ici plutôt que prise en silence —
 * `ADR-076 §D5` la porte.
 *
 * ANTI-VACUITÉ — un cliquet qui ne reconnaît RIEN doit ÉCHOUER, jamais passer
 * ---------------------------------------------------------------------------
 * Quatre étages, tous PAR RACINE ou PAR SIGNAL, jamais un plancher global :
 *  1. la marche a bien vu chaque racine (`apps/api`, `apps/worker`,
 *     `packages/*`) — un plancher global resterait satisfait par `apps/api`
 *     seul pendant qu'une racine sort silencieusement du corpus ;
 *  2. le classifieur RECONNAÎT encore des lectures élève et des `where` élève ;
 *  3. il reconnaît encore les DEUX signaux SÉPARÉMENT sur du CODE RÉEL —
 *     14 littéraux portent un `schoolId` nu, 7 portent un `id: { in: … }`. Un
 *     détecteur devenu aveugle rendrait zéro contrevenant en ne voyant rien ;
 *  4. le foyer canonique `student-scope-where.ts` apparaît dans les DEUX
 *     recensements — c'est le contrôle positif le plus fort disponible : le
 *     même fichier porte les deux clés, dans des littéraux DISJOINTS, et passe.
 *
 * PAS DE SONDE FICHIER DANS L'ARBRE RÉEL (TOOL-15 / 17 / 18) : les fixtures de
 * ce cliquet sont des CHAÎNES compilées en mémoire par `ts.createSourceFile`.
 * Rien n'est écrit, rien n'est supprimé, donc rien ne peut disparaître sous un
 * worker jest voisin.
 *
 * CE QUE CE CLIQUET NE PROUVE PAS
 * -------------------------------
 * 1. Il prouve une FORME. Il est aveugle à une clé d'école apportée par un
 *    spread OPAQUE (`{ ...someHelper(), id: { in } }`) — mais le helper est
 *    lui-même marché, et ses propres littéraux sont jugés. La classe fermée est
 *    « la co-occurrence LITTÉRALE », qui est celle du défaut mesuré.
 * 2. Il ne prouve pas que la portée ABAC décide JUSTE : cela est porté, et
 *    EXÉCUTÉ, par `student-access.service.spec.ts` et
 *    `student-scope-where.spec.ts`.
 * 3. Il ne dit RIEN de la vivacité déployée. Aucune sonde live n'a tourné ce
 *    run (Docker refuse de démarrer, `pilotage@5432` porte 0 école / 0 élève /
 *    0 tutelle) et aucune n'est revendiquée.
 * 4. LIMITE R-1 CONNUE, DÉJÀ ENREGISTRÉE SOUS `PF-333` : `ci-gate.sh` ne fait
 *    tourner la suite complète que quand le diff touche `GATE_MACHINERY`
 *    (`apps/api/src/shared/quality/` en fait partie, donc ce cliquet tourne sur
 *    CETTE PR). Pas de ré-allocation d'identifiant.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/** Le modèle Prisma jugé. INJECTÉ dans le classifieur (convention `PF-295`). */
const MODEL_NAME = 'student';

/** La clé d'ÉCOLE dont la présence NUE, aux côtés d'un jeu d'ids, est le défaut. */
const SCHOOL_KEY = 'schoolId';

/** La clé qui porte le jeu ABAC. */
const ID_KEY = 'id';

/** Le type qui DÉCLARE « ceci est un `where` élève », même hors site d'appel. */
const WHERE_TYPE = 'Prisma.StudentWhereInput';

/** Le fichier qui DOIT être le foyer de la disjonction. */
const CANONICAL_HOME = 'apps/api/src/modules/students/student-scope-where.ts';

const READ_OPERATIONS: ReadonlySet<string> = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardés, exprès (DNC-08).
const walkRead = require(WALK_READ_PATH) as {
  maxVanishedFor: (n: number) => number;
  mapWalkedFiles: <V>(
    paths: string[],
    build: (path: string, source: string) => [string, V],
  ) => { entries: [string, V][]; skipped: string[] };
  warnSkipped: (label: string, skipped: string[]) => boolean;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ts = require('typescript') as any;
/* eslint-enable @typescript-eslint/no-require-imports */

/* ================================================================== *
 * LA MARCHE — trois racines, plancher PAR RACINE
 * ================================================================== */

function walkTs(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '__fixtures__') {
        walkTs(path, out);
      }
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      out.push(path);
    }
  }
  return out;
}

function walkPackages(): string[] {
  const out: string[] = [];
  if (!existsSync(PACKAGES_DIR)) return out;
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    walkTs(join(PACKAGES_DIR, entry.name, 'src'), out);
  }
  return out;
}

const API_FILES = walkTs(API_SRC).sort();
const WORKER_FILES = walkTs(WORKER_SRC).sort();
const PACKAGE_FILES = walkPackages().sort();
const ALL_FILES = [...API_FILES, ...WORKER_FILES, ...PACKAGE_FILES];

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/** Planchers PAR RACINE — mesurés 2026-08-26 à 171 / 61 / 53, posés avec marge. */
const MIN_API_FILES = 150;
const MIN_WORKER_FILES = 50;
const MIN_PACKAGE_FILES = 45;

/** Planchers de RECONNAISSANCE — mesurés 42 / 43 / 14 / 7. */
const MIN_READ_SITES = 30;
const MIN_JUDGED_CLAUSES = 30;
const MIN_SCHOOL_KEYED_CLAUSES = 8;
const MIN_ID_SET_CLAUSES = 4;

/* ================================================================== *
 * LE CLASSIFIEUR — clés CONTRIBUÉES, spreads conditionnels COMPRIS
 * ================================================================== */

type Clause = {
  line: number;
  /** `true` ⇔ le `where` lie `schoolId` à une VALEUR (identifiant, accès de propriété, littéral). */
  bindsSchool: boolean;
  /** `true` ⇔ le `where` lie `id` à un littéral portant `in` — un jeu ABAC. */
  bindsIdSet: boolean;
  /** L'origine du littéral, pour que le message d'échec porte le SITE. */
  origin: 'read-call' | 'typed-binding' | 'typed-return';
};

/** Le membre `key` d'un littéral d'objet, s'il y en a un. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function memberOf(objectLiteral: any, key: string): any {
  if (!objectLiteral || !ts.isObjectLiteralExpression(objectLiteral)) return undefined;
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name =
      ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
    if (name === key) return prop.initializer;
  }
  return undefined;
}

/**
 * Les clés que ce littéral CONTRIBUE — y compris celles apportées par un SPREAD
 * CONDITIONNEL.
 *
 * C'EST LE CŒUR DU CLASSIFIEUR, et un « membre de premier niveau » naïf RATERAIT
 * le défaut : la construction pré-tranche écrivait
 * `{ tenantId, schoolId, ...(scope.studentIds === null ? {} : { id: { in: … } }) }`,
 * où `id` n'est PAS un membre de premier niveau mais une clé que ce `where`
 * porte tout de même, dans exactement le cas qui compte. Une clé apportée par un
 * spread conditionnel EST une clé de ce `where`.
 *
 * Un spread OPAQUE (appel de fonction, identifiant) n'est pas dépliable ici : il
 * est ignoré, et la limite est énoncée dans le docblock (§1).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contributedKeys(literal: any, out: Array<{ key: string; value: any }> = []) {
  if (!literal || !ts.isObjectLiteralExpression(literal)) return out;
  for (const prop of literal.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const key =
        ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
      if (key !== undefined) out.push({ key, value: prop.initializer });
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      // `schoolId,` — la forme EXACTE du défaut pré-tranche.
      out.push({ key: prop.name.text as string, value: prop.name });
    } else if (ts.isSpreadAssignment(prop)) {
      let expression = prop.expression;
      if (ts.isParenthesizedExpression(expression)) expression = expression.expression;
      if (ts.isObjectLiteralExpression(expression)) {
        contributedKeys(expression, out);
      } else if (ts.isConditionalExpression(expression)) {
        contributedKeys(expression.whenTrue, out);
        contributedKeys(expression.whenFalse, out);
      }
    }
  }
  return out;
}

/** Une ÉGALITÉ sur l'école : `schoolId`, `schoolId: ctx.schoolId`, `schoolId: 'x'`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSchoolEquality(value: any): boolean {
  return (
    ts.isIdentifier(value) || ts.isPropertyAccessExpression(value) || ts.isStringLiteral(value)
  );
}

/** Un JEU d'ids : `id: { in: … }`. Un `id: <valeur>` nu est une lecture d'UNE ligne, pas un jeu. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isIdSet(value: any): boolean {
  return ts.isObjectLiteralExpression(value) && memberOf(value, 'in') !== undefined;
}

/** Recense, pour UN fichier, chaque `where` élève JUGÉ, et compte les sites de lecture. */
function classify(
  path: string,
  source: string,
  modelName: string,
  whereType: string,
): { clauses: Clause[]; readSites: number } {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const clauses: Clause[] = [];
  let readSites = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const record = (literal: any, origin: Clause['origin']) => {
    if (!literal || !ts.isObjectLiteralExpression(literal)) return;
    const keys = contributedKeys(literal);
    clauses.push({
      line: (sf.getLineAndCharacterOfPosition(literal.getStart(sf)).line as number) + 1,
      bindsSchool: keys.some((k) => k.key === SCHOOL_KEY && isSchoolEquality(k.value)),
      bindsIdSet: keys.some((k) => k.key === ID_KEY && isIdSet(k.value)),
      origin,
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    // (a) le `where` d'un `<expr>.student.<lecture>(…)`.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === modelName) {
        if (READ_OPERATIONS.has(node.expression.name.text as string)) {
          readSites += 1;
          record(memberOf(node.arguments[0], 'where'), 'read-call');
        }
      }
    }

    // (b) une liaison ANNOTÉE `Prisma.StudentWhereInput` — le `where` construit
    //     à distance de son site d'appel, qui est PRÉCISÉMENT la forme du défaut.
    if (
      ts.isVariableDeclaration(node) &&
      node.type &&
      (node.type.getText(sf) as string) === whereType &&
      node.initializer
    ) {
      record(node.initializer, 'typed-binding');
    }

    // (c) le RETOUR d'une fonction annotée `Prisma.StudentWhereInput` — c'est
    //     par là que le foyer canonique est reconnu PAR CONSTRUCTION, sans
    //     nommer son chemin dans le classifieur.
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)) &&
      node.type &&
      (node.type.getText(sf) as string) === whereType &&
      node.body
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const seekReturns = (child: any) => {
        if (ts.isReturnStatement(child) && child.expression) {
          let expression = child.expression;
          if (ts.isParenthesizedExpression(expression)) expression = expression.expression;
          if (ts.isObjectLiteralExpression(expression)) record(expression, 'typed-return');
          if (ts.isConditionalExpression(expression)) {
            record(expression.whenTrue, 'typed-return');
            record(expression.whenFalse, 'typed-return');
          }
        }
        ts.forEachChild(child, seekReturns);
      };
      seekReturns(node.body);
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { clauses, readSites };
}

/* ================================================================== *
 * L'EXÉCUTION SUR L'ARBRE RÉEL
 * ================================================================== */

type FileFacts = { clauses: Clause[]; readSites: number };

const { entries, skipped } = walkRead.mapWalkedFiles<FileFacts>(ALL_FILES, (path, source) => [
  rel(path),
  classify(path, source, MODEL_NAME, WHERE_TYPE),
]);
const CLASSIFIED = new Map(entries);
walkRead.warnSkipped('student-school-scope-gate', skipped);

type Site = Clause & { file: string };

const ALL_CLAUSES: Site[] = [...CLASSIFIED.entries()].flatMap(([file, facts]) =>
  facts.clauses.map((clause) => ({ ...clause, file })),
);
const READ_SITES = [...CLASSIFIED.values()].reduce((n, f) => n + f.readSites, 0);

const SCHOOL_KEYED = ALL_CLAUSES.filter((c) => c.bindsSchool);
const ID_SET_KEYED = ALL_CLAUSES.filter((c) => c.bindsIdSet);

/**
 * L'ALLOWLIST MANUELLE — ELLE EST VIDE, ET UN TEST L'EXIGE VIDE.
 *
 * Elle existe pour que sa VACUITÉ soit une assertion plutôt qu'une absence : une
 * exemption future devra être ÉCRITE ICI avec sa raison, et fera rougir le test
 * de longueur juste en dessous — c'est-à-dire qu'elle sera une DÉCISION, pas un
 * effet de bord. Clé par FICHIER, jamais par ligne (une clé de ligne rancit à la
 * première édition et se « répare » en la remontant).
 */
const MANUAL_ALLOWLIST: ReadonlyArray<{ file: string; reason: string }> = [];

const OFFENDERS: Site[] = ALL_CLAUSES.filter(
  (site) =>
    site.bindsSchool &&
    site.bindsIdSet &&
    !MANUAL_ALLOWLIST.some((a) => a.file === site.file),
);

const describeSite = (s: Site) =>
  `${s.file}:${s.line} (${s.origin}) — un \`where\` ${MODEL_NAME} fait CO-OCCURRER \`${SCHOOL_KEY}\` ` +
  `et \`${ID_KEY}: { in: … }\` : l'autorité ABAC est rétrécie par une heuristique d'école (PF-356 / ADR-076)`;

/* ================================================================== *
 * LE CORPUS EST BIEN LE CORPUS — anti-vacuité, PAR RACINE puis PAR SIGNAL
 * ================================================================== */

describe('la dérivation n’est pas vacante', () => {
  it('a marché `apps/api/src` — plancher PAR RACINE', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(MIN_API_FILES);
  });

  it('a marché `apps/worker/src`', () => {
    expect(WORKER_FILES.length).toBeGreaterThanOrEqual(MIN_WORKER_FILES);
  });

  it('a marché `packages/*/src`', () => {
    expect(PACKAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
  });

  it("porte l'identité comptable — un plancher sur la LISTE ne se transporte pas sur la CARTE", () => {
    expect(CLASSIFIED.size + skipped.length).toBe(ALL_FILES.length);
  });

  it("n'a pas perdu plus que le budget calibré sur la taille du corpus", () => {
    expect(skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(ALL_FILES.length));
  });

  it('a RECONNU des LECTURES élève — zéro contravention sur zéro reconnaissance ne prouve rien', () => {
    expect(READ_SITES).toBeGreaterThanOrEqual(MIN_READ_SITES);
  });

  it('a RECONNU des `where` élève JUGÉS, toutes origines confondues', () => {
    expect(ALL_CLAUSES.length).toBeGreaterThanOrEqual(MIN_JUDGED_CLAUSES);
    // Les TROIS origines sont vivantes : si l'une tombait à zéro, le cliquet
    // aurait cessé de voir une forme entière de `where` sans le dire.
    for (const origin of ['read-call', 'typed-binding', 'typed-return'] as const) {
      expect(ALL_CLAUSES.filter((c) => c.origin === origin).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('PLANCHER ANTI-VACUITÉ 1 — le signal `schoolId` est reconnu sur du CODE RÉEL', () => {
    // 14 mesurés (analytics d'établissement, cache d'import, réclamations…).
    // Un détecteur devenu aveugle rendrait zéro contrevenant en ne voyant rien.
    expect(SCHOOL_KEYED.length).toBeGreaterThanOrEqual(MIN_SCHOOL_KEYED_CLAUSES);
  });

  it('PLANCHER ANTI-VACUITÉ 2 — le signal `id: { in: … }` est reconnu sur du CODE RÉEL', () => {
    // 7 mesurés (règles d'absence, annonces, présences, snapshots worker…).
    expect(ID_SET_KEYED.length).toBeGreaterThanOrEqual(MIN_ID_SET_CLAUSES);
  });

  it('CONTRÔLE POSITIF SUR DU CODE RÉEL — le foyer canonique porte les DEUX clés, dans des littéraux DISJOINTS', () => {
    // C'est le contrôle le plus fort disponible sans planter de sonde : le même
    // fichier est reconnu par les deux détecteurs, et il PASSE — ce qui prouve
    // que la règle est bien une DISJONCTION et non une interdiction de clé.
    expect(CLASSIFIED.has(CANONICAL_HOME)).toBe(true);
    expect(SCHOOL_KEYED.filter((c) => c.file === CANONICAL_HOME).length).toBeGreaterThanOrEqual(1);
    expect(ID_SET_KEYED.filter((c) => c.file === CANONICAL_HOME).length).toBeGreaterThanOrEqual(1);
    expect(OFFENDERS.filter((c) => c.file === CANONICAL_HOME)).toEqual([]);
  });
});

/* ================================================================== *
 * LE CLIQUET LUI-MÊME
 * ================================================================== */

describe('AC-4 — aucune lecture élève n’intersecte une école HEURISTIQUE avec un jeu d’ids ABAC', () => {
  it('zéro contrevenant sur les trois racines', () => {
    // Le message porte le SITE (`file:line`), jamais un simple compte.
    expect(OFFENDERS.map(describeSite)).toEqual([]);
  });

  it("l'allowlist manuelle est VIDE, et cette vacuité est ASSERTÉE", () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
    expect(MANUAL_ALLOWLIST).toHaveLength(0);
  });

  it('le site HISTORIQUE du défaut est encore MARCHÉ, et il est propre', () => {
    // Cette liste ne pilote AUCUNE exemption : elle refuse un vert obtenu parce
    // que la marche aurait cessé de voir le fichier où le défaut vivait.
    const HISTORIC = 'apps/api/src/modules/students/students.controller.ts';
    expect(CLASSIFIED.has(HISTORIC)).toBe(true);
    expect(OFFENDERS.filter((c) => c.file === HISTORIC)).toEqual([]);
  });

  it('aucun `SKIP_*` / `ALLOW_*` / `NODE_ENV` ne peut désarmer ce cliquet (DNC-10)', () => {
    const SELF = readFileSync(join(__dirname, 'student-school-scope-gate.spec.ts'), 'utf8');
    // Un `SKIP_…` ou un `ALLOW_…` ne peut désarmer quoi que ce soit qu'en étant
    // LU dans l'environnement : c'est donc la LECTURE qu'on interdit, pas les
    // noms — qui apparaissent en prose et dans le titre de ce test. Les motifs
    // sont CONCATÉNÉS (`PF-295`).
    for (const needle of ['pro' + 'cess.env', "require('node:pro" + "cess')"]) {
      expect(SELF).not.toContain(needle);
    }
  });
});

/* ================================================================== *
 * ROUGE-AVANT / VERT-APRÈS, sur fixtures EN MÉMOIRE (aucune sonde plantée)
 * ================================================================== */

const FIXTURE_PATH = join(API_SRC, 'modules', '__fixture', 'fixture.controller.ts');

/** Toute source de fixture est CONCATÉNÉE, jamais écrite en un littéral unique. */
const fixture = (...lines: string[]) => [...lines, ''].join('\n');

const runFixture = (source: string) => classify(FIXTURE_PATH, source, MODEL_NAME, WHERE_TYPE);

const onlyClause = (result: { clauses: Clause[] }): Clause => {
  expect(result.clauses).toHaveLength(1);
  return result.clauses[0] as Clause;
};

const isOffending = (c: Clause) => c.bindsSchool && c.bindsIdSet;

describe('ROUGE-AVANT — la construction PRÉ-TRANCHE doit être SIGNALÉE', () => {
  it('LA FORME EXACTE mesurée le 2026-08-26 dans `students.controller.ts` est contrevenante', () => {
    // Ceci EST le rouge-avant de `AC-4`, reconstruit plutôt que lu sur
    // `origin/main` — cf. §« pourquoi » du docblock et `ADR-076 §D5`.
    const result = runFixture(
      fixture(
        'export async function list(prisma: Db, me: Me, scope: Scope, schoolId: string) {',
        `  const where: ${WHERE_TYPE} = {`,
        '    tenantId: me.tenantId,',
        `    ${SCHOOL_KEY},`,
        `    ...(scope.studentIds === null ? {} : { ${ID_KEY}: { in: scope.studentIds } }),`,
        '  };',
        `  return prisma.${MODEL_NAME}.findMany({ where });`,
        '}',
      ),
    );
    // Le site d'appel est bien COMPTÉ comme une lecture, mais son `where` est un
    // identifiant, pas un littéral : la clause jugée est la liaison ANNOTÉE.
    expect(result.readSites).toBe(1);
    const clause = onlyClause(result);
    expect(clause.origin).toBe('typed-binding');
    expect(clause.bindsSchool).toBe(true);
    expect(clause.bindsIdSet).toBe(true);
    expect(isOffending(clause)).toBe(true);
  });

  it('LA FORME EN LIGNE — la même co-occurrence écrite directement au site d’appel', () => {
    const clause = onlyClause(
      runFixture(
        fixture(
          'export async function list(prisma: Db, me: Me, scope: Scope, schoolId: string) {',
          `  return prisma.${MODEL_NAME}.findMany({`,
          `    where: { tenantId: me.tenantId, ${SCHOOL_KEY}, ${ID_KEY}: { in: scope.studentIds } },`,
          '  });',
          '}',
        ),
      ),
    );
    expect(isOffending(clause)).toBe(true);
  });

  it("L'INVERSION — déplacer la clause dans un helper « partagé » ne la sauve PAS", () => {
    // Le helper est ANNOTÉ, donc son retour est jugé exactement comme un site
    // d'appel. Extraire n'est pas exempter.
    const clause = onlyClause(
      runFixture(
        fixture(
          `export function scopedWhere(me: Me, scope: Scope, ${SCHOOL_KEY}: string): ${WHERE_TYPE} {`,
          `  return { tenantId: me.tenantId, ${SCHOOL_KEY}, ${ID_KEY}: { in: scope.studentIds } };`,
          '}',
        ),
      ),
    );
    expect(isOffending(clause)).toBe(true);
  });

  it('la co-occurrence apportée par un spread conditionnel INVERSÉ compte aussi', () => {
    const clause = onlyClause(
      runFixture(
        fixture(
          'export async function list(prisma: Db, me: Me, scope: Scope, ctx: Ctx) {',
          `  return prisma.${MODEL_NAME}.count({`,
          '    where: {',
          '      tenantId: me.tenantId,',
          `      ...(scope.studentIds === null ? {} : { ${ID_KEY}: { in: scope.studentIds } }),`,
          `      ...(ctx.narrow ? { ${SCHOOL_KEY}: ctx.${SCHOOL_KEY} } : {}),`,
          '    },',
          '  });',
          '}',
        ),
      ),
    );
    expect(isOffending(clause)).toBe(true);
  });

  it('un `count` compte autant qu’un `findMany` — un total peut divulguer la taille d’une école', () => {
    const clause = onlyClause(
      runFixture(
        fixture(
          'export async function total(prisma: Db, me: Me, scope: Scope, schoolId: string) {',
          `  return prisma.${MODEL_NAME}.count({`,
          `    where: { tenantId: me.tenantId, ${SCHOOL_KEY}, ${ID_KEY}: { in: scope.studentIds } },`,
          '  });',
          '}',
        ),
      ),
    );
    expect(clause.origin).toBe('read-call');
    expect(isOffending(clause)).toBe(true);
  });
});

describe('CONTRÔLE POSITIF — sans lui, un comparateur toujours-rouge « prouverait » tout', () => {
  it('la branche ADMIN passe — `tenantId` + `schoolId`, AUCUN jeu d’ids (AC-3)', () => {
    const clause = onlyClause(
      runFixture(
        fixture(
          `export function adminWhere(me: Me, ${SCHOOL_KEY}: string): ${WHERE_TYPE} {`,
          `  return { tenantId: me.tenantId, ${SCHOOL_KEY} };`,
          '}',
        ),
      ),
    );
    expect(clause.bindsSchool).toBe(true);
    expect(clause.bindsIdSet).toBe(false);
    expect(isOffending(clause)).toBe(false);
  });

  it('la branche ABAC passe — `tenantId` + `id: { in: … }`, AUCUNE clé d’école', () => {
    const clause = onlyClause(
      runFixture(
        fixture(
          `export function scopedWhere(me: Me, scope: Scope): ${WHERE_TYPE} {`,
          `  return { tenantId: me.tenantId, ${ID_KEY}: { in: scope.studentIds } };`,
          '}',
        ),
      ),
    );
    expect(clause.bindsIdSet).toBe(true);
    expect(clause.bindsSchool).toBe(false);
    expect(isOffending(clause)).toBe(false);
  });

  it('LA DISJONCTION ELLE-MÊME passe — deux branches, deux littéraux, un seul fichier', () => {
    // La forme du foyer canonique, jouée en fixture : le fichier porte les deux
    // clés, aucun `where` ne les porte ENSEMBLE.
    const result = runFixture(
      fixture(
        `export function studentScopeWhere(input: In): ${WHERE_TYPE} {`,
        '  if (input.studentIds === null) {',
        `    return { tenantId: input.tenantId, ${SCHOOL_KEY}: input.${SCHOOL_KEY} };`,
        '  }',
        `  return { tenantId: input.tenantId, ${ID_KEY}: { in: [...input.studentIds] } };`,
        '}',
      ),
    );
    expect(result.clauses).toHaveLength(2);
    expect(result.clauses.filter((c) => c.bindsSchool)).toHaveLength(1);
    expect(result.clauses.filter((c) => c.bindsIdSet)).toHaveLength(1);
    expect(result.clauses.filter(isOffending)).toEqual([]);
  });

  it('un `id` NU (lecture d’UNE ligne) n’est pas un jeu ABAC — la fiche élève reste libre', () => {
    // `GET /students/:id` lit une ligne par son id et gate ensuite sur
    // `canAccessStudent`. Le signaler ne laisserait que les sorties interdites.
    const clause = onlyClause(
      runFixture(
        fixture(
          'export async function one(prisma: Db, id: string, schoolId: string) {',
          `  return prisma.${MODEL_NAME}.findFirst({ where: { ${ID_KEY}, ${SCHOOL_KEY} } });`,
          '}',
        ),
      ),
    );
    expect(clause.bindsIdSet).toBe(false);
    expect(isOffending(clause)).toBe(false);
  });

  it('un `where` d’un AUTRE modèle n’est pas jugé — la règle est bornée PAR CONSTRUCTION (PF-389)', () => {
    // `calendar.controller.ts` porte la MÊME faute sur `calendarEvent`. Elle est
    // ENREGISTRÉE (`PF-389`), pas exemptée : le classifieur ne la voit pas parce
    // que la règle porte sur les lectures élève, pas parce qu'une allowlist la
    // protège. C'est la différence entre une borne et une exemption.
    const result = runFixture(
      fixture(
        'export async function events(prisma: Db, me: Me, ctx: Ctx, ids: string[]) {',
        '  return prisma.calendarEvent.findMany({',
        `    where: { tenantId: me.tenantId, ${SCHOOL_KEY}: ctx.${SCHOOL_KEY}, ${ID_KEY}: { in: ids } },`,
        '  });',
        '}',
      ),
    );
    expect(result.clauses).toEqual([]);
    expect(result.readSites).toBe(0);
  });

  it('une ÉCRITURE élève n’est pas jugée — poser une ligne dans une école n’est pas une portée de lecture', () => {
    const result = runFixture(
      fixture(
        'export async function move(prisma: Db, me: Me, ids: string[], schoolId: string) {',
        `  return prisma.${MODEL_NAME}.updateMany({`,
        `    where: { tenantId: me.tenantId, ${SCHOOL_KEY}, ${ID_KEY}: { in: ids } },`,
        '    data: { updatedAt: new Date() },',
        '  });',
        '}',
      ),
    );
    expect(result.clauses).toEqual([]);
    expect(result.readSites).toBe(0);
  });
});
