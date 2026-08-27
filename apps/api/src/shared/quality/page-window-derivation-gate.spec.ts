import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-9 / PF-50 / ADR-080 §D5 — LE CLIQUET : plus aucun site ne RÉ-ÉCRIT
 * « combien de lignes cette requête a-t-elle le droit de porter ? ».
 *
 * LES CINQ RÈGLES, EN UNE LIGNE CHACUNE
 * -------------------------------------
 * Hors du fichier qui DÉCLARE `pageWindow`, est un contrevenant :
 *
 *   R1 — un `parseInt(` dans une INSTRUCTION qui nomme une fenêtre de page
 *        (`limit`, `offset`, `take`, `skip`, `pageSize`, `perPage`, et leurs
 *        variantes `…Raw` / `…Str`). PLAFOND DÉCROISSANT.
 *        Mesuré sur HEAD : **11**. Mesuré après la tranche : **2**.
 *
 *   R2 — un `Math.min(` / `Math.max(` dans une telle instruction : l'écrêtage
 *        écrit à la main. PLAFOND DÉCROISSANT.
 *        Mesuré sur HEAD : **28**. Mesuré après la tranche : **3**.
 *
 *   R3 — un `DefaultValuePipe` / `ParseIntPipe` dans un décorateur
 *        `@Query('limit'|'offset'|'page'|'pageSize')` : le défaut posé DANS la
 *        signature, loin du plafond posé dans le corps. TOLÉRANCE ZÉRO.
 *        Mesuré sur HEAD : **10**. Après : **0**.
 *
 *   R4 — un `z.coerce.number()` lié à une clé `limit` / `offset` DANS
 *        `packages/`, hors du module canonique : une seconde déclaration des
 *        bornes. TOLÉRANCE ZÉRO. Mesuré sur HEAD : **5**. Après : **0**.
 *
 *   R5 — LE RECENSEMENT : les `findMany` d'`apps/api/src` qui ne portent aucun
 *        `take`. PLAFOND DÉCROISSANT, gelé au nombre MESURÉ SUR L'ARBRE
 *        POST-DIFF par le code ci-dessous. La classe ne peut que rétrécir.
 *
 * POURQUOI R1 ET R2 SONT DES PLAFONDS ET NON DES TOLÉRANCES ZÉRO
 * --------------------------------------------------------------
 * Il reste UN site, et c'est une RAISON, pas un chemin en attente de travail
 * (AC-2) : `guardians.controller.ts:406-408` est un NUMÉRO DE PAGE 1-basé
 * (`?page=2&pageSize=10`, `skip: (page - 1) * pageSize`), la onzième forme et
 * la seule qui ne soit pas une fenêtre `limit`/`offset`. L'exprimer par la
 * fabrique canonique exigerait soit de RENOMMER deux paramètres de requête
 * visibles par l'appelant — un changement d'API, pas un changement d'analyseur
 * —, soit d'ajouter une SECONDE expression d'analyse au module canonique, ce
 * que AC-1 interdit précisément parce que c'est ainsi que la divergence
 * recommence. Il clampe correctement par le bas et ne porte donc PAS le défaut
 * d'inversion que la tranche ferme.
 *
 * Il est COMPTÉ, jamais ALLOWLISTÉ. C'est la convention maison
 * (`class-roster-size-derivation-gate.spec.ts:33-44`, `lint-ratchet.spec.ts`,
 * `test-ratchet.spec.ts`) : « un plafond n'exempte personne, il interdit la
 * récidive ». Une tolérance zéro ici aurait exigé soit une allowlist, soit une
 * conversion hors périmètre, soit un relâchement — les trois sorties que
 * `academic-year-resolution-gate.spec.ts:20-32` nomme et INTERDIT.
 *
 * LES QUATRE DÉCISIONS D'INCLUSION DU RECENSEMENT, UNE LIGNE CHACUNE (ADR-080 §6.3)
 * ---------------------------------------------------------------------------------
 * Le brief annonçait « 158 de 216 », l'architecte « 156 de 301/244 ». Les deux
 * dénominateurs diffèrent, ce qui PROUVE que le recensement est sensible à sa
 * définition — et qu'une définition en prose est infalsifiable. La définition
 * est donc CE CODE, et les quatre choix sont énoncés ici :
 *
 *   1. RACINE — `apps/api/src` SEUL. `apps/worker` a ses propres files et son
 *      propre budget mémoire ; l'y mêler ferait bouger le plafond sur du travail
 *      sans rapport.
 *   2. SPECS — `*.spec.ts` / `*.test.ts` / `.d.ts` / `__fixtures__` EXCLUS. 88
 *      `findMany` vivent dans des specs ; les inclure ferait rougir le cliquet à
 *      chaque nouveau test, et un cliquet qui rougit sur du travail sans rapport
 *      est relâché sous deux runs.
 *   3. UNITÉ — une EXPRESSION D'APPEL `x.findMany(...)`. Un `findMany` imbriqué
 *      dans un `include`/`select` n'est PAS un appel et n'est donc pas compté ;
 *      `_count` non plus.
 *   4. « SANS `take` » — le premier argument est un littéral d'objet sans
 *      propriété `take` au premier niveau (raccourci `take,` COMPRIS), OU n'est
 *      pas un littéral d'objet du tout. Un argument opaque est compté comme
 *      non borné : le doute charge le plafond, il ne l'allège pas.
 *
 * Mesuré avec CETTE définition : **210** appels sur **174** fichiers, **58**
 * avec `take` avant la tranche, **59** après ; donc **152 → 151** sans `take`.
 * Une seule conversion, celle de `/teaching-assignments`, et aucun appel
 * `findMany` ajouté ni supprimé.
 *
 * PLANCHERS D'ANTI-VACUITÉ (AC-6c), ET POURQUOI PLUSIEURS
 * -------------------------------------------------------
 * Un marcheur qui ne trouve rien doit ROUGIR, pas passer. Plancher par racine
 * (un plancher global resterait satisfait par une seule racine pendant qu'une
 * autre disparaîtrait), plancher de sites `findMany`, plancher de sites AVEC
 * `take` (sinon « 0 sans take » serait satisfait par « 0 findMany »), plancher
 * de DÉLÉGATION (combien de fichiers importent réellement la fabrique — c'est
 * ce qui prouve que la marche voit le code CONVERTI), et EXACTEMENT UN foyer
 * déclarant.
 *
 * ⚠ CHAQUE RÈGLE EST DÉMONTRÉE CAPABLE DE ROUGIR (AC-6d / `PF-407`). R3 et R4
 * ont un résiduel réel de ZÉRO : sans les fixtures, « zéro contravention » ne se
 * distinguerait pas de « le détecteur est cassé ». Les quatre fixtures de
 * `__fixtures__/page-window/` sont donc passées au MÊME classifieur que l'arbre,
 * et l'on assied qu'il rougit sur les trois `pre-fix-*` et reste vert sur
 * `clean-surface`.
 *
 * `MANUAL_ALLOWLIST` existe, est nommée, et EXPÉDIE VIDE — une assertion le
 * vérifie. Aucune variable d'environnement, aucun `NODE_ENV`, aucun `SKIP_*` /
 * `ALLOW_*` (DNC-10). Les helpers requis le sont SANS garde : s'ils
 * s'évaporent, cette suite doit mourir au CHARGEMENT plutôt que dégénérer en
 * « rien à vérifier » (DNC-08).
 *
 * CE QUE CE CLIQUET NE PROUVE PAS
 * -------------------------------
 * Il prouve une FORME. Que la fenêtre REJETTE au lieu de coercer est porté, et
 * de façon EXÉCUTÉE, par `apps/api/src/shared/pagination/page-window.spec.ts`.
 * Deux affirmations, deux mécanismes ; les confondre serait `DNC-06`. Et aucune
 * sonde vivante n'a été lancée (Docker à l'arrêt, 5ᵉ run) : rien ici ne dit ce
 * que fait l'API en vol.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const FIXTURES_DIR = join(__dirname, '__fixtures__', 'page-window');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/** Le foyer légitime, par ÉGALITÉ DE CHEMIN sur UN fichier — pas un glob. */
const CANONICAL_HOME = 'packages/contracts/src/pagination/page-window.ts';

/** La fonction qui DÉFINIT ce foyer. Exactement un fichier doit la déclarer. */
const HOME_FUNCTION = 'pageWindow';

/** Les jetons par lesquels un site DÉLÈGUE à la fabrique. Dérivés, pas devinés. */
const CANONICAL_TOKENS = ['pageWindow(', 'pageWindowOf(', 'pageSizeOf('] as const;

/**
 * Les identifiants qui font d'une instruction une FENÊTRE DE PAGE. Le détecteur
 * est dérivé des IDIOMES, jamais des neuf (ni des quatorze) chemins : un
 * quinzième site écrit demain sera vu sans que personne n'ait à l'inscrire.
 */
const WINDOW_IDENTIFIER =
  /\b(limit|offset|take|skip|pageSize|perPage|limitRaw|offsetRaw|limitStr|pageSizeRaw|pageRaw)\b/i;

/** Les clés de requête que R3 gouverne. */
const WINDOW_QUERY_KEY = /@Query\(\s*'(limit|offset|page|pageSize)'\s*,/;

/** Nommée, et VIDE. Une assertion le vérifie (DNC-10). */
const MANUAL_ALLOWLIST: readonly string[] = [];

/* ================================================================== *
 * LES PLAFONDS — mesurés sur CET arbre, après la tranche
 * ================================================================== */

/** R1 : 11 sur HEAD → 2 ici (le numéro de page 1-basé de `guardians`). */
const R1_CEILING = 2;
/** R2 : 28 sur HEAD → 3 ici (les `Math.*` des deux mêmes instructions). */
const R2_CEILING = 3;
/** R3 : 10 sur HEAD → 0. TOLÉRANCE ZÉRO. */
const R3_CEILING = 0;
/** R4 : 5 sur HEAD → 0. TOLÉRANCE ZÉRO. */
const R4_CEILING = 0;
/** R5 : 152 sur HEAD → 151 ici, sur 210 appels et 174 fichiers. */
const CENSUS_CEILING = 151;

/* Planchers d'anti-vacuité. Tout plancher est `>=`, jamais une égalité. */
const MIN_API_FILES = 150;
const MIN_WORKER_FILES = 50;
const MIN_PACKAGE_FILES = 100;
const MIN_FINDMANY_SITES = 200;
const MIN_FINDMANY_WITH_TAKE = 40;
/** Combien de fichiers DÉLÈGUENT réellement à la fabrique. Mesuré : 14. */
const MIN_DELEGATING_FILES = 12;

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardés, exprès (DNC-08) : s'ils s'évaporent, cette suite meurt au
// chargement plutôt que de dégénérer en « rien à vérifier ».
const walkRead = require(WALK_READ_PATH) as {
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
 * LA MARCHE
 * ================================================================== */

function walkSources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== 'node_modules' &&
        entry.name !== 'dist' &&
        entry.name !== '.next' &&
        entry.name !== '__fixtures__'
      ) {
        walkSources(path, out);
      }
      continue;
    }
    const name = entry.name;
    const isSource = name.endsWith('.ts') || name.endsWith('.tsx');
    const isExcluded =
      name.endsWith('.d.ts') ||
      name.endsWith('.spec.ts') ||
      name.endsWith('.spec.tsx') ||
      name.endsWith('.test.ts') ||
      name.endsWith('.test.tsx');
    if (isSource && !isExcluded) out.push(path);
  }
  return out;
}

function walkPackages(): string[] {
  const out: string[] = [];
  if (!existsSync(PACKAGES_DIR)) return out;
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    walkSources(join(PACKAGES_DIR, entry.name, 'src'), out);
  }
  return out;
}

const API_FILES = walkSources(API_SRC).sort();
const WORKER_FILES = walkSources(WORKER_SRC).sort();
const PACKAGE_FILES = walkPackages().sort();

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/* ================================================================== *
 * LE CLASSIFIEUR — il reçoit une SOURCE, jamais un chemin à reconnaître
 * ================================================================== */

type RuleId =
  | 'R1-handrolled-parse'
  | 'R2-handrolled-clamp'
  | 'R3-default-value-pipe'
  | 'R4-second-bounds-declaration';

type Finding = { rule: RuleId; line: number; detail: string };

type FileFacts = {
  findings: Finding[];
  /** Appels `x.findMany(...)`. */
  findManySites: number;
  /** Ceux qui portent un `take` de premier niveau. */
  findManyWithTake: number;
  /** Le fichier DÉLÈGUE-t-il à la fabrique ? */
  delegates: boolean;
  /** Le fichier DÉCLARE-t-il la fabrique ? */
  declaresHome: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nearestStatementText(node: any, sourceFile: any): string {
  let current = node;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isStatement(current)) return current.getText(sourceFile);
    current = current.parent;
  }
  return node.getText(sourceFile);
}

/** Un littéral d'objet porte-t-il la clé `take` au PREMIER niveau ? */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasTopLevelTake(argument: any): boolean {
  if (!argument || !ts.isObjectLiteralExpression(argument)) return false;
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
    const name = property.name;
    if (!name) continue;
    const text =
      ts.isIdentifier(name) || ts.isStringLiteral(name) ? (name.text as string) : undefined;
    if (text === 'take') return true;
  }
  return false;
}

/**
 * LE classifieur. Il est appliqué À L'IDENTIQUE à l'arbre réel et aux fixtures —
 * c'est ce qui rend le contrôle de falsifiabilité probant plutôt que décoratif.
 *
 * `isPackage` sépare R4 (une SECONDE déclaration de bornes, question propre à
 * `packages/`) de R1/R2 (une chaîne de requête devenant un `take` Prisma,
 * question propre au serveur). Ce n'est pas une exemption de chemin : c'est la
 * portée de chaque règle, énoncée. `packages/ui` porte de l'arithmétique de
 * pagination de PRÉSENTATION (`Pagination.tsx`, `DataTable.tsx`) qui ne parle à
 * aucune base et que R1/R2 n'ont aucun titre à juger.
 */
function classify(
  source: string,
  options: { isPackage: boolean; isCanonicalHome: boolean; countFindMany: boolean },
): FileFacts {
  const facts: FileFacts = {
    findings: [],
    findManySites: 0,
    findManyWithTake: 0,
    delegates: CANONICAL_TOKENS.some((token) => source.includes(token)),
    declaresHome: source.includes(`export function ${HOME_FUNCTION}(`),
  };

  const sourceFile = ts.createSourceFile(
    'fixture.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineOf = (node: any) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile) as string;

      if (!options.isCanonicalHome && !options.isPackage) {
        if (callee === 'parseInt' || callee === 'Number.parseInt') {
          const statement = nearestStatementText(node, sourceFile);
          if (WINDOW_IDENTIFIER.test(statement)) {
            facts.findings.push({
              rule: 'R1-handrolled-parse',
              line: lineOf(node),
              detail: `parseInt dans une instruction de fenêtre de page : ${callee}`,
            });
          }
        }
        if (callee === 'Math.min' || callee === 'Math.max') {
          const statement = nearestStatementText(node, sourceFile);
          if (WINDOW_IDENTIFIER.test(statement)) {
            facts.findings.push({
              rule: 'R2-handrolled-clamp',
              line: lineOf(node),
              detail: `${callee} écrête une fenêtre de page à la main`,
            });
          }
        }
      }

      if (
        options.countFindMany &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'findMany'
      ) {
        facts.findManySites += 1;
        if (hasTopLevelTake(node.arguments[0])) facts.findManyWithTake += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  source.split(/\r?\n/).forEach((line, index) => {
    if (!options.isCanonicalHome && WINDOW_QUERY_KEY.test(line) && /DefaultValuePipe|ParseIntPipe/.test(line)) {
      facts.findings.push({
        rule: 'R3-default-value-pipe',
        line: index + 1,
        detail: line.trim(),
      });
    }
    if (
      options.isPackage &&
      !options.isCanonicalHome &&
      /z\.coerce\.number\(\)/.test(line) &&
      /^\s*(limit|offset)\s*:/.test(line)
    ) {
      facts.findings.push({
        rule: 'R4-second-bounds-declaration',
        line: index + 1,
        detail: line.trim(),
      });
    }
  });

  return facts;
}

/* ================================================================== *
 * LA MESURE SUR L'ARBRE RÉEL
 * ================================================================== */

function measure(paths: string[], options: { isPackage: boolean; countFindMany: boolean }) {
  const walked = walkRead.mapWalkedFiles<FileFacts>(paths, (path, source) => [
    rel(path),
    classify(source, {
      isPackage: options.isPackage,
      isCanonicalHome: rel(path) === CANONICAL_HOME,
      countFindMany: options.countFindMany,
    }),
  ]);
  walkRead.warnSkipped('page-window-derivation-gate', walked.skipped);
  return new Map(walked.entries);
}

const API_FACTS = measure(API_FILES, { isPackage: false, countFindMany: true });
const WORKER_FACTS = measure(WORKER_FILES, { isPackage: false, countFindMany: false });
const PACKAGE_FACTS = measure(PACKAGE_FILES, { isPackage: true, countFindMany: false });

const ALL_FACTS = new Map<string, FileFacts>([
  ...API_FACTS,
  ...WORKER_FACTS,
  ...PACKAGE_FACTS,
]);

function findingsFor(rule: RuleId): string[] {
  const out: string[] = [];
  for (const [path, facts] of ALL_FACTS) {
    for (const finding of facts.findings) {
      if (finding.rule === rule) out.push(`${path}:${finding.line} — ${finding.detail}`);
    }
  }
  return out.sort();
}

let CENSUS_SITES = 0;
let CENSUS_WITH_TAKE = 0;
for (const facts of API_FACTS.values()) {
  CENSUS_SITES += facts.findManySites;
  CENSUS_WITH_TAKE += facts.findManyWithTake;
}
const CENSUS_WITHOUT_TAKE = CENSUS_SITES - CENSUS_WITH_TAKE;

/* ================================================================== *
 * LES FIXTURES — le MÊME classifieur, pour prouver qu'il peut rougir
 * ================================================================== */

const fixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), 'utf8');

/* ================================================================== *
 * LES TESTS
 * ================================================================== */

describe('page-window derivation gate — anti-vacuité (AC-6c)', () => {
  it('la marche a réellement vu les trois racines', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(MIN_API_FILES);
    expect(WORKER_FILES.length).toBeGreaterThanOrEqual(MIN_WORKER_FILES);
    expect(PACKAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
  });

  it('le recensement a réellement vu des `findMany`, ET des `findMany` BORNÉS', () => {
    expect(CENSUS_SITES).toBeGreaterThanOrEqual(MIN_FINDMANY_SITES);
    // Sans ce second plancher, « 0 sans take » serait satisfait par « 0 findMany ».
    expect(CENSUS_WITH_TAKE).toBeGreaterThanOrEqual(MIN_FINDMANY_WITH_TAKE);
  });

  it('la marche voit le code CONVERTI : au moins douze fichiers délèguent à la fabrique', () => {
    const delegating = [...ALL_FACTS.entries()].filter(([, f]) => f.delegates).map(([p]) => p);
    expect(delegating.length).toBeGreaterThanOrEqual(MIN_DELEGATING_FILES);
  });

  it('EXACTEMENT UN fichier déclare la fabrique, et c’est le foyer d’ADR-080 §D1', () => {
    const homes = [...ALL_FACTS.entries()].filter(([, f]) => f.declaresHome).map(([p]) => p);
    expect(homes).toEqual([CANONICAL_HOME]);
  });

  it('l’allowlist manuelle expédie VIDE (DNC-10)', () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
  });
});

describe('page-window derivation gate — R1/R2 : plafonds décroissants', () => {
  it(`R1 — au plus ${R1_CEILING} \`parseInt\` de fenêtre de page (11 sur HEAD)`, () => {
    const found = findingsFor('R1-handrolled-parse');
    expect(found.length).toBeLessThanOrEqual(R1_CEILING);
    // Le résiduel est NOMMÉ, jamais exempté : il doit rester le numéro de page
    // 1-basé de `guardians`, et rien d'autre. Un NOUVEAU site à la place de
    // celui-là ferait rougir ce test alors même que le compte serait identique.
    for (const site of found) {
      expect(site).toContain('guardians/guardians.controller.ts');
    }
  });

  it(`R2 — au plus ${R2_CEILING} écrêtages à la main (28 sur HEAD)`, () => {
    const found = findingsFor('R2-handrolled-clamp');
    expect(found.length).toBeLessThanOrEqual(R2_CEILING);
    for (const site of found) {
      expect(site).toContain('guardians/guardians.controller.ts');
    }
  });
});

describe('page-window derivation gate — R3/R4 : tolérance zéro', () => {
  it('R3 — aucun `DefaultValuePipe`/`ParseIntPipe` sur une clé de fenêtre (10 sur HEAD)', () => {
    expect(findingsFor('R3-default-value-pipe')).toHaveLength(R3_CEILING);
  });

  it('R4 — aucune SECONDE déclaration de bornes dans `packages/` (5 sur HEAD)', () => {
    expect(findingsFor('R4-second-bounds-declaration')).toHaveLength(R4_CEILING);
  });
});

describe('page-window derivation gate — R5 : le recensement gelé', () => {
  it(`au plus ${CENSUS_CEILING} \`findMany\` sans \`take\` dans apps/api/src`, () => {
    expect(CENSUS_WITHOUT_TAKE).toBeLessThanOrEqual(CENSUS_CEILING);
  });

  it('PF-50 est ADVANCED, NOT CLOSED — le résiduel est VISIBLE, donc personne ne peut croire la classe fermée', () => {
    // Un recensement tombé à zéro voudrait dire que la classe est close ; ce
    // n'est pas le cas et ce test l'écrit, pour qu'une future lecture du plafond
    // ne se laisse pas prendre pour une fermeture.
    expect(CENSUS_WITHOUT_TAKE).toBeGreaterThan(100);
  });
});

describe('page-window derivation gate — falsifiabilité (AC-6d / PF-407)', () => {
  it('R1 + R2 : le classifieur ROUGIT sur l’idiome d’avant la tranche', () => {
    const facts = classify(fixture('pre-fix-handrolled-parse.ts.txt'), {
      isPackage: false,
      isCanonicalHome: false,
      countFindMany: false,
    });
    const r1 = facts.findings.filter((f) => f.rule === 'R1-handrolled-parse');
    const r2 = facts.findings.filter((f) => f.rule === 'R2-handrolled-clamp');
    expect(r1.length).toBeGreaterThanOrEqual(3);
    expect(r2.length).toBeGreaterThanOrEqual(3);
  });

  it('R3 : le classifieur ROUGIT sur `DefaultValuePipe` — sa seule preuve, son résiduel réel étant 0', () => {
    const facts = classify(fixture('pre-fix-default-value-pipe.ts.txt'), {
      isPackage: false,
      isCanonicalHome: false,
      countFindMany: false,
    });
    expect(facts.findings.filter((f) => f.rule === 'R3-default-value-pipe')).toHaveLength(2);
  });

  it('R4 : le classifieur ROUGIT sur une seconde déclaration de bornes dans `packages/`', () => {
    const facts = classify(fixture('pre-fix-contracts-coerce.ts.txt'), {
      isPackage: true,
      isCanonicalHome: false,
      countFindMany: false,
    });
    expect(facts.findings.filter((f) => f.rule === 'R4-second-bounds-declaration')).toHaveLength(2);
  });

  it('CONTRÔLE NÉGATIF : la forme CONVERTIE reste VERTE sur les quatre règles', () => {
    const asServer = classify(fixture('clean-surface.ts.txt'), {
      isPackage: false,
      isCanonicalHome: false,
      countFindMany: false,
    });
    const asPackage = classify(fixture('clean-surface.ts.txt'), {
      isPackage: true,
      isCanonicalHome: false,
      countFindMany: false,
    });
    expect(asServer.findings).toEqual([]);
    expect(asPackage.findings).toEqual([]);
    expect(asServer.delegates).toBe(true);
  });

  it('CONTRÔLE DE FOYER : le module canonique lui-même n’est JAMAIS un contrevenant', () => {
    const home = ALL_FACTS.get(CANONICAL_HOME);
    expect(home).toBeDefined();
    expect(home?.findings).toEqual([]);
    expect(home?.declaresHome).toBe(true);
  });

  it('CONTRÔLE D’EXCLUSION : l’exclusion du foyer est une ÉGALITÉ DE CHEMIN, pas un glob', () => {
    // Le même contenu, jugé SANS le drapeau de foyer, DOIT rougir. Sinon
    // l'exclusion masquerait bien plus que le seul fichier qu'elle nomme.
    const homeSource = readFileSync(join(REPO_ROOT, ...CANONICAL_HOME.split('/')), 'utf8');
    const asOrdinaryPackageFile = classify(homeSource, {
      isPackage: true,
      isCanonicalHome: false,
      countFindMany: false,
    });
    expect(asOrdinaryPackageFile.findings.length).toBeGreaterThan(0);
  });
});
