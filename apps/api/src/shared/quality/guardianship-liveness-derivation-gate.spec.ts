import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-3c / PF-12 / PF-358 / ADR-074 — LE CLIQUET : plus aucune surface ne
 * RE-DÉRIVE « ce lien parent↔enfant est-il vivant ? ».
 *
 * LES DEUX RÈGLES, EN UNE LIGNE CHACUNE
 * -------------------------------------
 * Hors du module qui DÉCLARE `guardianshipLiveWhere`, est un contrevenant :
 *
 *   R-A — une LECTURE Prisma du modèle `guardianship` dont le `where` épelle le
 *         statut en littéral — `status: 'active'` (la portée VIVANT) ou
 *         `status: { not: 'revoked' }` (la portée AU REGISTRE) — au lieu
 *         d'importer le prédicat canonique.
 *
 *   R-B — un COMPTE de relation NON FILTRÉ : `_count: { select: {
 *         guardianships: true } }`. C'est le défaut de `PF-358` dans sa forme
 *         la plus pure — un nombre qui compte les liens RÉVOQUÉS et qui, faute
 *         de `where`, n'est distinguable d'un oubli par AUCUNE relecture.
 *
 * POURQUOI R-B EST À TOLÉRANCE ZÉRO ET SANS MARQUEUR D'EXEMPTION
 * --------------------------------------------------------------
 * Mesuré sur l'arbre APRÈS conversion : zéro. Les trois sites qui portaient la
 * forme (`students.controller.ts`, et deux dans `guardians.controller.ts` — la
 * liste et le garde de suppression) portent tous désormais un `where`. Une
 * règle dont le résidu légitime est vide n'a pas besoin d'exemption, et lui en
 * donner une par avance serait ouvrir la porte que le cliquet existe pour
 * fermer.
 *
 * ⚠ R-B NE JUGE PAS LES `include` / `select` DE RELATION SANS `where`, et c'est
 * délibéré. `guardians.controller.ts` `GET /:id` rend `guardianships: {
 * include: { student: true } }` — TOUS LES ÉTATS, révoqués compris — parce que
 * la fiche d'un parent est une vue de gestion qui doit montrer l'historique.
 * Rendre des LIGNES que l'appelant peut inspecter n'est pas la même chose
 * qu'affirmer un NOMBRE dont la portée est invisible. Ces sites DÉCLARENT leur
 * intention par `GUARDIANSHIP_ALL_STATES_ARE_DELIBERATE` (ADR-074 §2.6) — dans
 * leur propre code, là où un relecteur la voit, plutôt que dans une allowlist
 * ici, qui serait l'une des trois sorties interdites
 * (`academic-year-resolution-gate.spec.ts:20-32`).
 *
 * POURQUOI R-A DIT « LECTURE », COMME SON PRÉCÉDENT MAISON
 * --------------------------------------------------------
 * Les mêmes raisons, et le même piège. `child-claims.service.ts` porte trois
 * `status: 'pending'` dans des `updateMany` (`:629`, `:781`, `:883`) : ce sont
 * des gardes d'état-DE-DÉPART sur une mutation — de la concurrence optimiste,
 * pas des lectures de vivacité. `guardians.controller.ts:319` écrit
 * `status: 'active'` dans un `data`, ce qui est une transition d'état. Une
 * règle énoncée sur « toute requête » les attraperait tous, et il ne resterait
 * alors que les trois sorties interdites. Les verbes d'écriture ne sont pas
 * dans `READ_OPERATIONS` : la catégorie est reconnue PAR CONSTRUCTION, il n'y a
 * aucun nom en exception.
 *
 * CE QUE LE CLIQUET NE PROUVE PAS
 * -------------------------------
 * 1. Il prouve une FORME. Que la portée VIVANT soit la BONNE portée pour tel
 *    site est porté par les tests de comportement
 *    (`guardians.controller.spec.ts` — rouge-avant / vert-après sur le garde de
 *    suppression) et par les tests unitaires du module contractuel.
 *
 * 2. IL NE COUVRE PAS LA FAMILLE `pending` DE L'ANALYTIQUE. `analytics.service.ts`
 *    compte les `Guardianship` `pending` comme substitut d'un modèle
 *    `EnrollmentRequest` qui n'existe pas (`:2471-2472`, `:2931`, `:3027`).
 *    Ce n'est PAS la question de vivacité : c'est « qu'est-ce qui attend une
 *    décision ? ». Les rabattre ici changerait un KPI sans rien fermer. Hors
 *    portée, ENREGISTRÉ en `PF-373`, et un test plus bas assied que la famille
 *    existe toujours — pour qu'on ne la déclare pas fermée par inadvertance.
 *
 * 3. LIMITE CONNUE, la même que ses frères : `scripts/ci-gate.sh` ne fait
 *    tourner la suite complète que quand le diff touche `GATE_MACHINERY`. Ce
 *    fichier en fait partie, donc le cliquet tourne sur CETTE PR ; une PR
 *    future ne touchant que `packages/**` ne l'exécuterait pas (`PF-333`).
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/** Le nom du modèle Prisma jugé. INJECTÉ dans le classifieur (PF-295). */
const MODEL_NAME = 'guardianship';

/** Le nom de la relation comptée, pour R-B. INJECTÉ pour la même raison. */
const RELATION_NAME = 'guardianships';

/** La fonction qui DÉFINIT le foyer légitime. */
const PREDICATE_FUNCTION = 'guardianshipLiveWhere';

/**
 * Les opérations de LECTURE. Tout ce qui n'est pas là — `update`, `updateMany`,
 * `upsert`, `create`, `delete`, `deleteMany` — est une écriture, donc une
 * transition d'état, donc hors de R-A PAR CONSTRUCTION.
 */
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

/** Les deux valeurs jugées : la portée VIVANT, et l'état TERMINAL nié. */
const LIVE_VALUE = 'active';
const ENDED_VALUE = 'revoked';

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardés, exprès (DNC-08) : s'ils s'évaporent, cette suite doit mourir au
// CHARGEMENT plutôt que dégénérer en « rien à vérifier ».
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

/**
 * Les `*.spec.ts` sont HORS corpus : une spec n'émet aucune requête de
 * production, elle porte des fakes et des fixtures délibérément contrevenantes
 * — dont celles de ce fichier. Les juger produirait un auto-rouge que l'on
 * « corrigerait » par une exclusion, c'est-à-dire par une allowlist déguisée.
 */
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

/** Les `src` de TOUS les paquets de l'espace de travail — découverts, pas listés. */
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

/**
 * Planchers PAR RACINE, jamais des égalités (convention maison : tout plancher
 * est `>=`). Un plancher GLOBAL resterait satisfait par `apps/api` seul pendant
 * que `packages/` — le foyer du prédicat — disparaîtrait de la marche en
 * silence.
 */
const MIN_API_FILES = 150;
const MIN_WORKER_FILES = 50;
const MIN_PACKAGE_FILES = 38;

/**
 * Plancher de RECONNAISSANCE : le nombre de sites `guardianship.*` que la
 * marche doit encore VOIR. Zéro contravention sur zéro reconnaissance ne prouve
 * rien — c'est le mode d'échec que ce plancher existe pour rendre impossible.
 */
const MIN_MODEL_CALL_SITES = 10;

/* ================================================================== *
 * LE CLASSIFIEUR — noms de modèle et de relation INJECTÉS (PF-295)
 * ================================================================== */

type ModelCall = {
  operation: string;
  line: number;
  isRead: boolean;
  /** `true` ⇔ le `where` épelle `status: 'active'`. */
  spellsLive: boolean;
  /** `true` ⇔ le `where` épelle `status: { not: 'revoked' }`. */
  spellsNotEnded: boolean;
};

/** `status: 'active'` ou `status: <X>.active`, à n'importe quelle profondeur. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function spellsStatusLiteral(node: any, value: string): boolean {
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : undefined;
      if (key === 'status') {
        const v = n.initializer;
        if (ts.isStringLiteral(v) && v.text === value) {
          found = true;
          return;
        }
        if (ts.isPropertyAccessExpression(v) && v.name.text === value) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** `status: { not: 'revoked' }`, à n'importe quelle profondeur. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function spellsStatusNot(node: any, value: string): boolean {
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : undefined;
      if (key === 'status' && ts.isObjectLiteralExpression(n.initializer)) {
        const not = memberOf(n.initializer, 'not');
        if (not && ts.isStringLiteral(not) && not.text === value) {
          found = true;
          return;
        }
        if (not && ts.isPropertyAccessExpression(not) && not.name.text === value) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

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

/** R-A : recense chaque appel `<expr>.<modelName>.<op>(…)`. */
function classifyCalls(path: string, source: string, modelName: string): ModelCall[] {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const out: ModelCall[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const operationAccess = node.expression;
      const receiver = operationAccess.expression;
      if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === modelName) {
        const operation = operationAccess.name.text as string;
        const where = memberOf(node.arguments[0], 'where');
        out.push({
          operation,
          line: (sf.getLineAndCharacterOfPosition(node.getStart(sf)).line as number) + 1,
          isRead: READ_OPERATIONS.has(operation),
          spellsLive: where !== undefined && spellsStatusLiteral(where, LIVE_VALUE),
          spellsNotEnded: where !== undefined && spellsStatusNot(where, ENDED_VALUE),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * R-C : recense chaque `<relation>: { where: … }` dont le `where` épelle le
 * statut en littéral — les `where` ANCRÉS SUR LA RELATION, à l'intérieur d'un
 * `include` / `select` / `_count`.
 *
 * POURQUOI CETTE RÈGLE EXISTE : R-A SEULE A UN ANGLE MORT, ET IL EST MESURÉ
 * -------------------------------------------------------------------------
 * R-A ne voit que les appels `<expr>.guardianship.<op>()`. Or la MAJORITÉ des
 * sites convertis par cette tranche ne sont PAS de cette forme : ce sont des
 * relations lues depuis `student` ou `guardian`
 * (`students.controller.ts:264`, `classes.controller.ts:165`,
 * `lessons.controller.ts:230`, `guardians.controller.ts:118`,
 * `enrollment-xlsx.generator.ts:45`).
 *
 * La preuve rouge-avant l'a MONTRÉ plutôt que supposé : en rendant
 * `students.controller.ts` à son état d'avant la tranche, R-B a bien signalé le
 * `_count` non filtré (`:276`) et R-A n'a RIEN vu du
 * `guardianships: { where: { status: 'active' } }` quatorze lignes plus haut.
 * Écrit ici plutôt que corrigé en silence : un cliquet dont on ignore la portée
 * réelle est un cliquet qui rassure sans couvrir.
 */
function classifyRelationWheres(
  path: string,
  source: string,
  relation: string,
): Array<{ line: number; spellsLive: boolean; spellsNotEnded: boolean }> {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const out: Array<{ line: number; spellsLive: boolean; spellsNotEnded: boolean }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    if (ts.isPropertyAssignment(node)) {
      const key =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;
      if (key === relation && ts.isObjectLiteralExpression(node.initializer)) {
        const where = memberOf(node.initializer, 'where');
        if (where !== undefined) {
          const spellsLive = spellsStatusLiteral(where, LIVE_VALUE);
          const spellsNotEnded = spellsStatusNot(where, ENDED_VALUE);
          if (spellsLive || spellsNotEnded) {
            out.push({
              line: (sf.getLineAndCharacterOfPosition(node.getStart(sf)).line as number) + 1,
              spellsLive,
              spellsNotEnded,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * R-B : recense chaque `_count: { select: { <relation>: true } }`.
 *
 * La valeur `true` est le point : `<relation>: { where: … }` porte une portée,
 * `<relation>: true` n'en porte aucune et compte donc les liens révoqués.
 */
function classifyUnfilteredCounts(path: string, source: string, relation: string): number[] {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const out: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    if (ts.isPropertyAssignment(node)) {
      const key =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;
      if (key === '_count') {
        const select = memberOf(node.initializer, 'select');
        const relationValue = memberOf(select, relation);
        if (relationValue && relationValue.kind === ts.SyntaxKind.TrueKeyword) {
          out.push((sf.getLineAndCharacterOfPosition(node.getStart(sf)).line as number) + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Le fichier DÉCLARE-t-il le prédicat ? Reconnaissance par construction. */
function declaresPredicate(path: string, source: string, functionName: string): boolean {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name && n.name.text === functionName) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/* ================================================================== *
 * L'EXÉCUTION SUR L'ARBRE RÉEL
 * ================================================================== */

type FileFacts = {
  source: string;
  calls: ModelCall[];
  relationWheres: Array<{ line: number; spellsLive: boolean; spellsNotEnded: boolean }>;
  unfilteredCounts: number[];
  isPredicateHome: boolean;
};

const { entries, skipped } = walkRead.mapWalkedFiles<FileFacts>(ALL_FILES, (path, source) => [
  rel(path),
  {
    source,
    calls: classifyCalls(path, source, MODEL_NAME),
    relationWheres: classifyRelationWheres(path, source, RELATION_NAME),
    unfilteredCounts: classifyUnfilteredCounts(path, source, RELATION_NAME),
    isPredicateHome: declaresPredicate(path, source, PREDICATE_FUNCTION),
  },
]);
const CLASSIFIED = new Map(entries);
walkRead.warnSkipped('guardianship-liveness-derivation-gate', skipped);

const PREDICATE_HOMES = [...CLASSIFIED.entries()]
  .filter(([, facts]) => facts.isPredicateHome)
  .map(([file]) => file);

type Site = ModelCall & { file: string };

const MODEL_CALL_SITES: Site[] = [...CLASSIFIED.entries()].flatMap(([file, facts]) =>
  facts.calls.map((call) => ({ ...call, file })),
);

/**
 * L'allowlist manuelle. Elle existe, elle est nommée, et elle EXPÉDIE VIDE —
 * une assertion le vérifie plus bas. Le foyer légitime est DÉRIVÉ (le fichier
 * qui déclare le prédicat), jamais énuméré.
 */
const MANUAL_ALLOWLIST: ReadonlyArray<{ file: string; line: number }> = [];

const OFFENDERS_A: Site[] = MODEL_CALL_SITES.filter(
  (site) =>
    site.isRead &&
    (site.spellsLive || site.spellsNotEnded) &&
    !PREDICATE_HOMES.includes(site.file) &&
    !MANUAL_ALLOWLIST.some((a) => a.file === site.file && a.line === site.line),
);

const OFFENDERS_B: ReadonlyArray<{ file: string; line: number }> = [
  ...CLASSIFIED.entries(),
].flatMap(([file, facts]) => facts.unfilteredCounts.map((line) => ({ file, line })));

const OFFENDERS_C: ReadonlyArray<{
  file: string;
  line: number;
  spellsLive: boolean;
  spellsNotEnded: boolean;
}> = [...CLASSIFIED.entries()]
  .filter(([file]) => !PREDICATE_HOMES.includes(file))
  .flatMap(([file, facts]) => facts.relationWheres.map((w) => ({ file, ...w })))
  .filter((w) => !MANUAL_ALLOWLIST.some((a) => a.file === w.file && a.line === w.line));

const describeA = (s: Site) =>
  `${s.file}:${s.line} — ${MODEL_NAME}.${s.operation}() épelle le statut en littéral ` +
  `(${s.spellsLive ? "status:'active'" : "status:{not:'revoked'}"}) au lieu d'importer ` +
  `${PREDICATE_FUNCTION}() / guardianshipOnTheBooksWhere()`;

const describeB = (s: { file: string; line: number }) =>
  `${s.file}:${s.line} — _count.select.${RELATION_NAME} est NON FILTRÉ : il compte les liens RÉVOQUÉS`;

const describeC = (s: { file: string; line: number; spellsLive: boolean }) =>
  `${s.file}:${s.line} — la relation ${RELATION_NAME} porte un \`where\` qui épelle le statut ` +
  `en littéral (${s.spellsLive ? "status:'active'" : "status:{not:'revoked'}"}) au lieu ` +
  `d'importer ${PREDICATE_FUNCTION}() / guardianshipOnTheBooksWhere()`;

/* ================================================================== *
 * LE CORPUS EST BIEN LE CORPUS — les garde-fous de vacuité
 * ================================================================== */

describe('la dérivation de vivacité n’est pas vacante', () => {
  it('a marché `apps/api/src` — plancher PAR RACINE', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(MIN_API_FILES);
  });

  it('a marché `apps/worker/src` — deux des sites convertis y vivent', () => {
    expect(WORKER_FILES.length).toBeGreaterThanOrEqual(MIN_WORKER_FILES);
  });

  it('a marché `packages/*/src` — la racine qui PORTE le prédicat', () => {
    expect(PACKAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
  });

  it('voit encore de vrais sites `guardianship.*` — zéro sur zéro ne prouve rien', () => {
    expect(MODEL_CALL_SITES.length).toBeGreaterThanOrEqual(MIN_MODEL_CALL_SITES);
  });

  it('a trouvé EXACTEMENT UN foyer déclarant le prédicat', () => {
    // Zéro ⇒ le prédicat a disparu et le cliquet est décoratif.
    // Deux ⇒ la canonicalisation a déjà re-divergé.
    expect(PREDICATE_HOMES).toHaveLength(1);
    expect(PREDICATE_HOMES[0]).toBe('packages/contracts/src/guardianship/link-liveness.ts');
  });

  it('n’a pas sauté de fichier', () => {
    expect(skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(ALL_FILES.length));
  });
});

/* ================================================================== *
 * LE CONTRÔLE NÉGATIF — sans lui, un comparateur toujours-rouge passe
 * ================================================================== */

describe('le classifieur discrimine (contrôle négatif — TOOL-13 / run 45)', () => {
  // Les fixtures emploient un modèle SYNTHÉTIQUE absent du produit (PF-295) :
  // un motif écrit en toutes lettres deviendrait un faux positif pour le grep
  // du relecteur suivant.
  const FIXTURE_MODEL = 'fixtureLink';
  const FIXTURE_RELATION = 'fixtureLinks';

  it('SIGNALE une lecture qui épelle la portée VIVANT en littéral', () => {
    const src = `const r = await db.${FIXTURE_MODEL}.findMany({ where: { tenantId, status: '${LIVE_VALUE}' } });`;
    const calls = classifyCalls('fixture.ts', src, FIXTURE_MODEL);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.isRead).toBe(true);
    expect(calls[0]!.spellsLive).toBe(true);
  });

  it('SIGNALE une lecture qui épelle la portée AU REGISTRE en littéral', () => {
    const src = `const r = await db.${FIXTURE_MODEL}.findMany({ where: { status: { not: '${ENDED_VALUE}' } } });`;
    const calls = classifyCalls('fixture.ts', src, FIXTURE_MODEL);
    expect(calls[0]!.spellsNotEnded).toBe(true);
  });

  it('LAISSE PASSER une lecture qui importe le prédicat', () => {
    const src = `const r = await db.${FIXTURE_MODEL}.findMany({ where: { tenantId, ...${PREDICATE_FUNCTION}() } });`;
    const calls = classifyCalls('fixture.ts', src, FIXTURE_MODEL);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.spellsLive).toBe(false);
    expect(calls[0]!.spellsNotEnded).toBe(false);
  });

  it('LAISSE PASSER une ÉCRITURE qui pose le statut — transition d’état, pas lecture', () => {
    const src = `await db.${FIXTURE_MODEL}.updateMany({ where: { id, status: 'pending' }, data: { status: '${LIVE_VALUE}' } });`;
    const calls = classifyCalls('fixture.ts', src, FIXTURE_MODEL);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.isRead).toBe(false);
  });

  it('SIGNALE un `_count` de relation NON FILTRÉ', () => {
    const src = `const r = await db.owner.findMany({ include: { _count: { select: { ${FIXTURE_RELATION}: true } } } });`;
    expect(classifyUnfilteredCounts('fixture.ts', src, FIXTURE_RELATION)).toHaveLength(1);
  });

  it('LAISSE PASSER un `_count` de relation PORTANT une portée', () => {
    const src = `const r = await db.owner.findMany({ include: { _count: { select: { ${FIXTURE_RELATION}: { where: ${PREDICATE_FUNCTION}() } } } } });`;
    expect(classifyUnfilteredCounts('fixture.ts', src, FIXTURE_RELATION)).toHaveLength(0);
  });

  it('SIGNALE une relation dont le `where` épelle le statut en littéral (R-C)', () => {
    const src = `const r = await db.owner.findMany({ include: { ${FIXTURE_RELATION}: { where: { status: '${LIVE_VALUE}' } } } });`;
    const found = classifyRelationWheres('fixture.ts', src, FIXTURE_RELATION);
    expect(found).toHaveLength(1);
    expect(found[0]!.spellsLive).toBe(true);
  });

  it('LAISSE PASSER une relation dont le `where` importe le prédicat (R-C)', () => {
    const src = `const r = await db.owner.findMany({ include: { ${FIXTURE_RELATION}: { where: ${PREDICATE_FUNCTION}() } } });`;
    expect(classifyRelationWheres('fixture.ts', src, FIXTURE_RELATION)).toHaveLength(0);
  });

  it('LAISSE PASSER une relation SANS `where` — R-C ne juge pas l’absence (ADR-074 §2.6)', () => {
    // Rendre des LIGNES tous états est une vue de gestion licite ; c'est un
    // NOMBRE sans portée que R-B interdit. La différence est délibérée.
    const src = `const r = await db.owner.findMany({ include: { ${FIXTURE_RELATION}: { include: { child: true } } } });`;
    expect(classifyRelationWheres('fixture.ts', src, FIXTURE_RELATION)).toHaveLength(0);
  });

  it('l’allowlist manuelle expédie VIDE', () => {
    expect(MANUAL_ALLOWLIST).toHaveLength(0);
  });
});

/* ================================================================== *
 * LES DEUX RÈGLES, SUR L'ARBRE RÉEL
 * ================================================================== */

describe('R-A — aucune LECTURE n’épelle le statut de lien en littéral', () => {
  it('zéro contrevenant hors du foyer du prédicat', () => {
    expect(OFFENDERS_A.map(describeA)).toEqual([]);
  });
});

describe('R-B — aucun `_count` de rattachements ne compte les liens révoqués', () => {
  it('zéro compte non filtré', () => {
    expect(OFFENDERS_B.map(describeB)).toEqual([]);
  });
});

describe('R-C — aucune relation `guardianships` n’épelle le statut en littéral', () => {
  it('zéro contrevenant ancré sur la relation', () => {
    // C'est la règle qui couvre la MAJORITÉ des sites de cette tranche : les
    // relations lues depuis `student` / `guardian`, que R-A ne peut pas voir.
    expect(OFFENDERS_C.map(describeC)).toEqual([]);
  });
});

/* ================================================================== *
 * LES RÉSIDUS SONT ASSIS — pour qu'on ne les déclare pas fermés
 * ================================================================== */

describe('ce que ce cliquet NE ferme PAS, assis explicitement', () => {
  it('la famille `pending` de l’analytique existe toujours (PF-373, hors portée)', () => {
    // Elle compte « ce qui attend une décision », pas « ce qui est vivant ».
    // La rabattre ici changerait un KPI sans rien fermer. Ce test échouera le
    // jour où elle disparaîtra — ce qui est le signal de mettre `PF-373` à jour,
    // et non de supprimer ce test.
    const analytics = CLASSIFIED.get('apps/api/src/modules/analytics/analytics.service.ts');
    expect(analytics).toBeDefined();
    expect(analytics!.source).toContain("status: 'pending'");
  });

  it('le foyer du prédicat n’importe PAS Prisma (GUARDRAILS §2)', () => {
    const home = readFileSync(
      join(REPO_ROOT, 'packages', 'contracts', 'src', 'guardianship', 'link-liveness.ts'),
      'utf8',
    );
    // Une IMPORTATION, pas une occurrence de la chaîne : le docblock CITE
    // `@prisma/client` pour expliquer pourquoi il n'en dépendra jamais, et un
    // `toContain` nu échoue donc sur sa propre justification. Premier jet rouge
    // pour cette raison exacte — l'assertion était fausse, pas le module.
    expect(home).not.toMatch(/^\s*import\s[^\n]*'@prisma\/client'/m);
    expect(home).not.toMatch(/require\(\s*'@prisma\/client'\s*\)/);
  });

  it('la portée AU REGISTRE est DÉRIVÉE de l’énum, jamais écrite en littéral', () => {
    // C'est ce qui garde `{ in: [...] }` équivalent au `{ not: 'revoked' }`
    // qu'il remplace sans tenir une seconde liste à la main (leçon run 59).
    const home = readFileSync(
      join(REPO_ROOT, 'packages', 'contracts', 'src', 'guardianship', 'link-liveness.ts'),
      'utf8',
    );
    expect(home).toContain('GUARDIANSHIP_LINK_STATUSES.filter(');
    expect(home).not.toMatch(/ON_THE_BOOKS_STATUSES[^=]*=\s*\[/);
  });
});

/* ================================================================== *
 * LE VOCABULAIRE EST CELUI DE PRISMA — la paire est MESURÉE, pas crue
 * ================================================================== */

describe('le vocabulaire du contrat égale l’énum Prisma', () => {
  it('`GUARDIANSHIP_LINK_STATUSES` == `enum GuardianshipStatus` de `schema.prisma`', () => {
    const schema = readFileSync(
      join(REPO_ROOT, 'apps', 'api', 'prisma', 'schema.prisma'),
      'utf8',
    );
    const block = schema.match(/enum GuardianshipStatus \{([^}]*)\}/);
    expect(block).not.toBeNull();
    const fromPrisma = block![1]!
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//'));

    const home = readFileSync(
      join(REPO_ROOT, 'packages', 'contracts', 'src', 'guardianship', 'link-liveness.ts'),
      'utf8',
    );
    const declared = home.match(/GUARDIANSHIP_LINK_STATUSES = \[([^\]]*)\]/);
    expect(declared).not.toBeNull();
    const fromContract = declared![1]!
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter((s) => s.length > 0);

    // Égalité d'ENSEMBLE et de TAILLE : c'est la paire de listes que ce dépôt a
    // déjà payée une fois (`academic_year.SELECT`, run 59). Elle est MESURÉE des
    // deux côtés, jamais relue.
    expect([...fromContract].sort()).toEqual([...fromPrisma].sort());
  });
});
