import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-3b / PF-357 / PF-12 / ADR-073 — LE CLIQUET : le panneau parent ne peut plus
 * affirmer « aucun enfant » à partir d'une lecture qui a échoué, ni à partir d'une
 * table qui n'est pas celle qui porte le fait.
 *
 * LES TROIS RÈGLES, EN UNE LIGNE CHACUNE
 * --------------------------------------
 *   R1 — L'AFFIRMATION D'ABSENCE A UN SEUL FOYER. La chaîne
 *        « Vous n'avez pas encore rattaché d'enfant » apparaît dans EXACTEMENT UN
 *        fichier sous `apps/web/src`, elle y est DOMINÉE par un test de vacuité sur la
 *        longueur d'une collection, et aucun identifiant nommé exactement `claim` ou
 *        `claims` ne subsiste dans ce fichier — parce que la question qu'il pose n'est
 *        plus « combien de demandes ? » mais « combien de rattachements ? ».
 *
 *   R2 — UNE LECTURE ÉCHOUÉE N'EST JAMAIS UNE COLLECTION VIDE. Sous
 *        `apps/web/src/app/parent/**` et `apps/web/src/components/parent/**`, aucune
 *        clause `catch` ne peut rendre un tableau vide, ni un objet qui en contient un.
 *        C'est la classe `ADR-071 §D5`, assise STRUCTURELLEMENT.
 *
 *   R3 — LA PROJECTION LIT LE FAIT. Dans `child-claims.service.ts`, la méthode qui sert
 *        `GET /parent/child-claims` doit porter au moins une lecture Prisma sur le
 *        modèle `guardianship`. Un corps dont le seul récepteur Prisma est
 *        `guardianshipClaim` échoue, en nommant fichier, ligne et règle.
 *
 *   R4 — « Validé » A QUITTÉ LE VOCABULAIRE PARENT (AC-3). Le mot est interdit sous les
 *        deux racines parent et sous `packages/ui/src` ; ailleurs il est COMPTÉ et
 *        PLAFONNÉ, pas interdit (le domaine des imports admin l'emploie légitimement).
 *
 * CE QUE CE CLIQUET NE COUVRE PAS — LIMITES DÉCLARÉES, PAS IMPLICITES
 * -------------------------------------------------------------------
 * `PF-366` : le cliquet de la tranche précédente était vert à 37/37 CONTRE une violation
 * injectée, parce qu'il s'appuyait sur un IDENTIFIANT. Les limites ci-dessous sont donc
 * ÉCRITES, et chacune a un contrôle négatif exécuté plus bas.
 *
 *  1. **R1, portée des noms : ÉGALITÉ EXACTE, SENSIBLE À LA CASSE**, contre les deux
 *     noms `claim` et `claims`. La règle ne touche donc PAS `claimId`,
 *     `claimedBirthDate`, `ChildClaimDrawer`, `withdrawChildClaimAction` ni
 *     `ChildLinksPanel` — tous légitimement conservés dans ce fichier (`claimId` porte
 *     le flux de retrait que `§5` exige de garder). Un lecteur qui supposerait une
 *     correspondance par SOUS-CHAÎNE rendrait la règle insatisfiable et la « corrigerait »
 *     en la relâchant : c'est `R-30`.
 *  2. **R1, forme du garde :** la règle assied la FORME du garde (un test de vacuité sur
 *     `.length` qui DOMINE le littéral), pas l'IDENTITÉ de la collection testée. Elle ne
 *     peut donc pas distinguer « vide parce que zéro rattachement » de « vide parce
 *     qu'on a mis un tableau vide dans la variable » — c'est précisément le travail de
 *     R2, et de la clé `links` REQUISE par `ParentChildLinksResponseSchema` (un `200`
 *     sans cette clé est une lecture ÉCHOUÉE, jamais vide : `FM-8`).
 *  3. **R2 ne voit PAS l'idiome plus doux `catch { return null }` suivi de `?? []`.**
 *     `safe()` (`children/page.tsx:74`) en est le représentant vivant et il SURVIT à
 *     cette tranche : le convertir serait un élargissement, et le résidu appartient
 *     déjà à `PF-363` (« une lecture échouée rend encore *Aucun enfant rattaché* sur six
 *     pages parent »). Le trou est donc DÉCLARÉ et COMPTÉ — `SOFT_NULL_CATCH_CEILING`
 *     ci-dessous — parce qu'un trou déclaré et chiffré est une preuve, tandis qu'un trou
 *     silencieux est `PF-366`.
 *  4. **R3 attrape trois formes de récepteur** — `this.prisma.guardianship.*`,
 *     `tx.guardianship.*` (le paramètre d'une fonction imbriquée) et l'alias
 *     `const g = this.prisma.guardianship; g.findMany(…)`. Elle n'attrape PAS un alias
 *     construit dynamiquement (`db[modelName]`), et ne le prétend pas.
 *  5. Le corpus EXCLUT les specs : elles portent des fixtures délibérément
 *     contrevenantes — dont celles de ce fichier. Les juger produirait un auto-rouge
 *     qu'on « corrigerait » par une exclusion, c'est-à-dire par une allowlist déguisée.
 *  6. Il ne s'élargit PAS au portail admin : les trois sites de `PF-358` y vivent et
 *     sont explicitement hors périmètre (`§10`).
 *
 * `.tsx` EST PARSÉ EN `ScriptKind.TSX` — sinon la moitié du corpus parent (des
 * composants) se parse en TS et la moitié du défaut devient invisible.
 *
 * `MANUAL_ALLOWLIST` existe, est nommée, et EXPÉDIE VIDE — une assertion le prouve.
 * L'inventaire est DÉRIVÉ par une marche, jamais par une liste de chemins tapée à la
 * main : une liste à la main devient verte par disparition.
 *
 * AUCUN INTERRUPTEUR (DNC-10) : aucun `SKIP_*`, aucun `ALLOW_*`, aucun `NODE_ENV` ne
 * peut désarmer ce fichier — un test plus bas le vérifie sur son propre texte.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const UI_SRC = join(REPO_ROOT, 'packages', 'ui', 'src');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardés, exprès (DNC-08) : un module manquant est une autre couture qu'un
// fichier marché qui s'évapore.
const walkRead = require(WALK_READ_PATH) as {
  maxVanishedFor: (n: number) => number;
  mapWalkedFiles: <V>(
    paths: string[],
    build: (path: string, source: string) => [string, V],
  ) => { entries: [string, V][]; skipped: string[] };
  warnSkipped: (label: string, skipped: string[]) => boolean;
};
 
const ts = require('typescript') as any;
/* eslint-enable @typescript-eslint/no-require-imports */

/* ================================================================== *
 * LES NOMS JUGÉS — injectés dans le classifieur, jamais codés en dur
 * dans ses fonctions (la leçon PF-295).
 * ================================================================== */

/**
 * ⚠ APOSTROPHES TYPOGRAPHIQUES U+2019, PAS ASCII. Vérifié octet à octet sur le foyer
 * (`E2 80 99` dans `n’avez` et `d’enfant`, `C3 A9` dans `rattaché`). Une règle écrite
 * avec `'` ASCII correspondrait à ZÉRO fichier et serait VACUEUSEMENT verte — le mode de
 * défaillance `PF-366`, une tranche plus tard. Le littéral est donc construit avec des
 * échappements unicode EXPLICITES plutôt que collé, et le nombre de foyers est assis à
 * EXACTEMENT un pour qu'un zéro échoue bruyamment au lieu de passer.
 */
const EMPTINESS_CLAIM = 'Vous n’avez pas encore rattaché d’enfant';

/** R1 : égalité EXACTE, sensible à la casse. Voir la limite 1 du docblock. */
const BANNED_IDENTIFIER_NAMES: ReadonlySet<string> = new Set(['claim', 'claims']);

/** R4 : le mot que `AC-3` chasse du vocabulaire parent. */
const FORBIDDEN_BADGE_WORD = 'Validé';

/** Le modèle Prisma qui porte LE FAIT. */
const FACT_MODEL = 'guardianship';

/** La méthode qui sert `GET /parent/child-claims`. */
const PROJECTION_METHOD = 'listChildLinksForGuardian';
const PROJECTION_FILE = 'apps/api/src/modules/child-claims/child-claims.service.ts';

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

/** Les deux racines à TOLÉRANCE ZÉRO. */
const PARENT_ROOTS = ['apps/web/src/app/parent/', 'apps/web/src/components/parent/'];

/* ================================================================== *
 * LA MARCHE — inventaire DÉRIVÉ, jamais énuméré
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

const WEB_FILES = walkSources(WEB_SRC).sort();
const API_FILES = walkSources(API_SRC).sort();
const UI_FILES = walkSources(UI_SRC).sort();
const ALL_FILES = [...WEB_FILES, ...API_FILES, ...UI_FILES];

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/** Planchers PAR RACINE, jamais des égalités. Mesurés sur cet arbre : 378 / 170 / 60. */
const MIN_WEB_FILES = 300;
const MIN_API_FILES = 150;
const MIN_UI_FILES = 40;

/* ================================================================== *
 * LE CLASSIFIEUR
 * ================================================================== */

interface Finding {
  rule: 'R1-emptiness-claim' | 'R2-catch-empty-collection' | 'R3-fact-not-read' | 'R4-validated-word';
  file: string;
  line: number;
  detail: string;
}

interface FileFacts {
  file: string;
  /** Occurrences du littéral d'absence (recherche textuelle, insensible à l'AST). */
  emptinessHits: number;
  /** Le littéral est-il DOMINÉ par un test de vacuité sur `.length` ? */
  emptinessGuarded: boolean;
  /** Identifiants exactement nommés `claim` / `claims`, avec leur ligne. */
  bannedIdentifiers: Array<{ name: string; line: number }>;
  /** `catch` rendant un tableau vide (ou un objet qui en contient un). */
  catchEmptyCollections: number[];
  /** `catch { return null }` — l'idiome plus doux, COMPTÉ, jamais interdit. */
  softNullCatches: number[];
  /** Occurrences du mot « Validé ». */
  validatedWordLines: number[];
  /** Lectures Prisma sur le modèle du FAIT, dans la méthode de projection. */
  factReadsInProjection: number[];
  /** La méthode de projection a-t-elle été VUE dans ce fichier ? */
  sawProjectionMethod: boolean;
  findings: Finding[];
}

 
function lineOf(sf: any, node: any): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** `x.length === 0` · `x.length == 0` · `x.length < 1` · `x.length <= 0` · `!x.length`. */
 
function isEmptinessTest(node: any): boolean {
  let found = false;
   
  const isLengthAccess = (n: any) =>
    n && ts.isPropertyAccessExpression(n) && n.name.text === 'length';
   
  const visit = (n: any): void => {
    if (found || !n) return;
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      const right = n.right;
      const num = ts.isNumericLiteral(right) ? Number(right.text) : null;
      if (isLengthAccess(n.left) && num !== null) {
        if (
          ((op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
            op === ts.SyntaxKind.EqualsEqualsToken ||
            op === ts.SyntaxKind.LessThanEqualsToken) &&
            num === 0) ||
          (op === ts.SyntaxKind.LessThanToken && num === 1)
        ) {
          found = true;
          return;
        }
      }
    }
    if (
      ts.isPrefixUnaryExpression(n) &&
      n.operator === ts.SyntaxKind.ExclamationToken &&
      isLengthAccess(n.operand)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Un tableau vide, ou un objet / un `??` / un `as` qui en contient un. */
 
function containsEmptyArray(node: any): boolean {
  if (!node) return false;
  if (ts.isArrayLiteralExpression(node) && node.elements.length === 0) return true;
  if (ts.isObjectLiteralExpression(node)) {
     
    return node.properties.some(
       
      (p: any) => ts.isPropertyAssignment(p) && containsEmptyArray(p.initializer),
    );
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return containsEmptyArray(node.expression);
  }
  if (ts.isBinaryExpression(node)) {
    return containsEmptyArray(node.left) || containsEmptyArray(node.right);
  }
  if (ts.isConditionalExpression(node)) {
    return containsEmptyArray(node.whenTrue) || containsEmptyArray(node.whenFalse);
  }
  return false;
}

/**
 * R3, énoncé STRUCTURELLEMENT : un appel dont la chaîne d'accès se termine par
 * `.<FACT_MODEL>.<opération de lecture>(` sur un récepteur qui EST le client Prisma du
 * service, un paramètre d'une fonction imbriquée (la forme `tx`), ou un alias local de
 * `….<FACT_MODEL>`. Une règle nouée sur l'IDENTIFIANT `prisma` raterait la forme `tx` ;
 * une règle nouée sur l'identifiant `guardianship` serait `PF-366` répété.
 */
 
function collectFactReads(sf: any, methodBody: any, factModel: string): number[] {
  const localParams = new Set<string>();
  const factAliases = new Set<string>();

   
  const isPrismaReceiver = (expr: any): boolean => {
    if (!expr) return false;
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text === 'prisma';
    if (ts.isIdentifier(expr)) return expr.text === 'prisma' || localParams.has(expr.text);
    return false;
  };

   
  const collectNames = (n: any): void => {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) {
       
      for (const p of n.parameters) if (ts.isIdentifier(p.name)) localParams.add(p.name.text);
    }
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isPropertyAccessExpression(n.initializer) &&
      n.initializer.name.text === factModel &&
      isPrismaReceiver(n.initializer.expression)
    ) {
      factAliases.add(n.name.text);
    }
    ts.forEachChild(n, collectNames);
  };
  collectNames(methodBody);

  const lines: number[] = [];
   
  const visit = (n: any): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const op = n.expression.name.text;
      const receiver = n.expression.expression;
      if (READ_OPERATIONS.has(op)) {
        const viaChain =
          ts.isPropertyAccessExpression(receiver) &&
          receiver.name.text === factModel &&
          isPrismaReceiver(receiver.expression);
        const viaAlias = ts.isIdentifier(receiver) && factAliases.has(receiver.text);
        if (viaChain || viaAlias) lines.push(lineOf(sf, n));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(methodBody);
  return lines;
}

function classify(path: string, source: string): FileFacts {
  const file = path.startsWith(REPO_ROOT) ? rel(path) : path.split(sep).join('/');
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);

  const facts: FileFacts = {
    file,
    emptinessHits: source.split(EMPTINESS_CLAIM).length - 1,
    emptinessGuarded: false,
    bannedIdentifiers: [],
    catchEmptyCollections: [],
    softNullCatches: [],
    validatedWordLines: [],
    factReadsInProjection: [],
    sawProjectionMethod: false,
    findings: [],
  };

  const isParent = PARENT_ROOTS.some((r) => file.startsWith(r));
  const isUi = file.startsWith('packages/ui/src/');

   
  const guardStack: any[] = [];

   
  const visit = (node: any): void => {
    // --- R1 : le littéral d'absence est-il DOMINÉ par un test de vacuité ? ---
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text.includes(EMPTINESS_CLAIM)
    ) {
      if (guardStack.some((g) => isEmptinessTest(g))) facts.emptinessGuarded = true;
    }
    if (ts.isJsxText(node) && node.text.includes(EMPTINESS_CLAIM)) {
      if (guardStack.some((g) => isEmptinessTest(g))) facts.emptinessGuarded = true;
    }

    // --- R1 (deuxième moitié) : identifiants exactement `claim` / `claims` ---
    if (ts.isIdentifier(node) && BANNED_IDENTIFIER_NAMES.has(node.text)) {
      facts.bannedIdentifiers.push({ name: node.text, line: lineOf(sf, node) });
    }

    // --- R4 : le mot « Validé » ---
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isJsxText(node)) &&
      node.text.includes(FORBIDDEN_BADGE_WORD)
    ) {
      facts.validatedWordLines.push(lineOf(sf, node));
    }

    // --- R2 : une clause `catch` qui rend une collection vide ---
    if (ts.isCatchClause(node)) {
       
      const inCatch = (n: any): void => {
        if (ts.isReturnStatement(n) && n.expression) {
          if (containsEmptyArray(n.expression)) facts.catchEmptyCollections.push(lineOf(sf, n));
          if (n.expression.kind === ts.SyntaxKind.NullKeyword) {
            facts.softNullCatches.push(lineOf(sf, n));
          }
        }
        ts.forEachChild(n, inCatch);
      };
      ts.forEachChild(node.block, inCatch);
    }

    // --- R3 : la méthode de projection lit-elle le FAIT ? ---
    if (
      (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === PROJECTION_METHOD
    ) {
      facts.sawProjectionMethod = true;
      if (node.body) {
        facts.factReadsInProjection = collectFactReads(sf, node.body, FACT_MODEL);
      }
    }

    // --- pile des gardes : `if (…) { … }` et `… ? … : …` ---
    if (ts.isIfStatement(node)) {
      guardStack.push(node.expression);
      visit(node.thenStatement);
      guardStack.pop();
      if (node.elseStatement) visit(node.elseStatement);
      // la condition elle-même n'est pas dominée par elle-même
      visit(node.expression);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      guardStack.push(node.condition);
      visit(node.whenTrue);
      guardStack.pop();
      visit(node.whenFalse);
      visit(node.condition);
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      guardStack.push(node.left);
      visit(node.right);
      guardStack.pop();
      visit(node.left);
      return;
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  /* ---- les contraventions, dérivées des faits ---- */

  if (isParent || isUi) {
    for (const line of facts.validatedWordLines) {
      facts.findings.push({
        rule: 'R4-validated-word',
        file,
        line,
        detail:
          '« Validé » a quitté le vocabulaire parent (AC-3) : aucun état ne tire son ' +
          'libellé du statut `approved` d’une demande.',
      });
    }
  }

  if (isParent) {
    for (const line of facts.catchEmptyCollections) {
      facts.findings.push({
        rule: 'R2-catch-empty-collection',
        file,
        line,
        detail:
          'une lecture ÉCHOUÉE rendue comme une collection VIDE — le portail affirmerait ' +
          '« aucun enfant » alors qu’il ne sait rien (ADR-071 §D5).',
      });
    }
  }

  if (facts.emptinessHits > 0 && !facts.emptinessGuarded) {
    facts.findings.push({
      rule: 'R1-emptiness-claim',
      file,
      line: 1,
      detail:
        'l’affirmation d’absence n’est pas DOMINÉE par un test de vacuité sur la ' +
        'longueur de la liste de lignes.',
    });
  }
  if (facts.emptinessHits > 0) {
    for (const banned of facts.bannedIdentifiers) {
      facts.findings.push({
        rule: 'R1-emptiness-claim',
        file,
        line: banned.line,
        detail: `identifiant \`${banned.name}\` dans le foyer de l’affirmation d’absence — la question posée est « combien de rattachements ? », pas « combien de demandes ? ».`,
      });
    }
  }

  if (facts.sawProjectionMethod && facts.factReadsInProjection.length === 0) {
    facts.findings.push({
      rule: 'R3-fact-not-read',
      file,
      line: 1,
      detail: `\`${PROJECTION_METHOD}\` ne lit pas \`${FACT_MODEL}\` — la projection parlerait de la DEMANDE seule, ce qui EST le défaut PF-357.`,
    });
  }

  return facts;
}

/* ================================================================== *
 * LE CORPUS
 * ================================================================== */

const { entries, skipped } = walkRead.mapWalkedFiles<FileFacts>(ALL_FILES, (path, source) => [
  rel(path),
  classify(path, source),
]);
walkRead.warnSkipped('parent-child-link-projection-gate', skipped);

const CORPUS = new Map<string, FileFacts>(entries);
const FACTS = [...CORPUS.values()];

/**
 * L'allowlist manuelle. Elle existe, elle est nommée, et elle EXPÉDIE VIDE — une
 * assertion plus bas le prouve. Le foyer de R1 est DÉRIVÉ par la marche, jamais énuméré.
 */
const MANUAL_ALLOWLIST: ReadonlyArray<{ file: string; line: number }> = [];

const OFFENDERS: Finding[] = FACTS.flatMap((f) => f.findings).filter(
  (finding) =>
    !MANUAL_ALLOWLIST.some((a) => a.file === finding.file && a.line === finding.line),
);

const EMPTINESS_HOMES = FACTS.filter((f) => f.emptinessHits > 0).map((f) => f.file);

/* ================================================================== *
 * LES PLAFONDS MESURÉS AILLEURS, PUIS GELÉS
 * ================================================================== */

/**
 * Le trou DÉCLARÉ de R2 (limite 3) : `catch { return null }` sous les deux racines
 * parent. Mesuré à **18** le 2026-08-26, `children/page.tsx:74` (`safe()`) compris. Un
 * plafond, donc `<=` : la valeur ne peut que BAISSER. Propriétaire : `PF-363`.
 */
const SOFT_NULL_CATCH_CEILING = 18;

/**
 * R2 hors des deux racines parent, sur tout `apps/web/src`. Mesuré à **0** — les DEUX
 * seules occurrences de la forme dans l'application web vivaient sous
 * `apps/web/src/app/parent/children/page.tsx` (`:96` et `:98`), c'est-à-dire dans le
 * fichier que cette tranche convertit. Le plafond gèle donc un zéro RÉEL, pas une
 * absence de mesure.
 */
const R2_ELSEWHERE_CEILING = 0;

/** La mesure AVANT conversion, pour que « le plafond a baissé » soit vérifiable. */
const R2_PARENT_ROOTS_BEFORE_CONVERSION = 2;

/**
 * R4 hors du périmètre parent + `packages/ui`. Mesuré à **3**, tous dans le domaine des
 * IMPORTS admin (`admin/imports/page.tsx:79,:293` et `admin/imports/[id]/page.tsx:77`),
 * où « Validé · à confirmer » qualifie un LOT d'import et n'a rien à voir avec un
 * rattachement. Interdire le mot partout serait une règle fausse ; le compter et le
 * plafonner est la règle vraie.
 */
const VALIDATED_WORD_ELSEWHERE_CEILING = 3;

/* ================================================================== *
 * NON-VACUITÉ — un vert sur un corpus vide n'est pas un vert
 * ================================================================== */

describe('le cliquet n’est pas vacant', () => {
  it('a marché `apps/web/src` — la racine qui héberge le panneau et ses branches', () => {
    expect(WEB_FILES.length).toBeGreaterThanOrEqual(MIN_WEB_FILES);
  });

  it('a marché `apps/api/src` — la racine qui héberge la projection jugée par R3', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(MIN_API_FILES);
  });

  it('a marché `packages/ui/src` — la racine qui héberge le badge jugé par R4', () => {
    expect(UI_FILES.length).toBeGreaterThanOrEqual(MIN_UI_FILES);
  });

  it('a bien parsé du TSX — sinon la moitié du corpus parent serait invisible', () => {
    const tsx = FACTS.filter((f) => f.file.endsWith('.tsx'));
    expect(tsx.length).toBeGreaterThan(50);
  });

  it('porte l’identité comptable — un plancher sur la LISTE ne se transporte pas sur la CARTE', () => {
    expect(CORPUS.size).toBe(ALL_FILES.length - skipped.length);
  });

  it('n’a pas perdu plus que le budget calibré sur la taille du corpus', () => {
    expect(skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(ALL_FILES.length));
  });

  it('les deux racines parent SONT dans le corpus — sinon R2 et R4 sont vacantes', () => {
    for (const root of PARENT_ROOTS) {
      expect(FACTS.some((f) => f.file.startsWith(root))).toBe(true);
    }
  });

  it('la méthode de projection A ÉTÉ VUE — sinon R3 est verte par absence', () => {
    const service = CORPUS.get(PROJECTION_FILE);
    expect(service).toBeDefined();
    expect(service!.sawProjectionMethod).toBe(true);
  });

  it('le littéral d’absence EST TROUVÉ par le matcher — le piège U+2019, assis', () => {
    // Si ce test tombe à zéro, la règle R1 est vacueusement verte : c'est PF-366.
    expect(EMPTINESS_HOMES.length).toBeGreaterThan(0);
  });
});

/* ================================================================== *
 * LES RÈGLES
 * ================================================================== */

describe('R1 — l’affirmation d’absence a UN SEUL foyer, gardé, et qui ne parle plus de demandes', () => {
  it('EXACTEMENT un fichier sous `apps/web/src` porte la chaîne (égalité, jamais `<= 1`)', () => {
    expect(EMPTINESS_HOMES).toHaveLength(1);
  });

  it('elle y est DOMINÉE par un test de vacuité sur la longueur de la liste', () => {
    const home = FACTS.find((f) => f.emptinessHits > 0)!;
    expect(home.emptinessGuarded).toBe(true);
  });

  it('aucun identifiant exactement nommé `claim` / `claims` ne subsiste dans ce foyer', () => {
    const home = FACTS.find((f) => f.emptinessHits > 0)!;
    if (home.bannedIdentifiers.length > 0) {
      console.error(
        `R1 — ${home.file} : ` +
          home.bannedIdentifiers.map((b) => `${b.name}@${b.line}`).join(', '),
      );
    }
    expect(home.bannedIdentifiers).toEqual([]);
  });
});

describe('R2 — une lecture échouée n’est JAMAIS une collection vide', () => {
  it('zéro contrevenant sous les deux racines parent (tolérance zéro)', () => {
    const violations = OFFENDERS.filter((o) => o.rule === 'R2-catch-empty-collection');
    if (violations.length > 0) {
      console.error(violations.map((v) => `${v.file}:${v.line} — ${v.detail}`).join('\n'));
    }
    expect(violations).toEqual([]);
  });

  it('le plafond AILLEURS dans `apps/web/src` reste tenu', () => {
    const elsewhere = FACTS.filter(
      (f) => f.file.startsWith('apps/web/src/') && !PARENT_ROOTS.some((r) => f.file.startsWith(r)),
    ).flatMap((f) => f.catchEmptyCollections);
    expect(elsewhere.length).toBeLessThanOrEqual(R2_ELSEWHERE_CEILING);
  });

  it('le plafond a bien BAISSÉ — la tranche a retiré la forme, pas seulement épinglé', () => {
    expect(R2_PARENT_ROOTS_BEFORE_CONVERSION).toBeGreaterThan(0);
  });

  it('le TROU DÉCLARÉ (`catch { return null }` + `?? []`) est compté et plafonné', () => {
    // Limite 3 du docblock. Ce n'est PAS une exemption : c'est un résidu nommé,
    // propriétaire `PF-363`, et son plafond ne peut que baisser.
    const soft = FACTS.filter((f) => PARENT_ROOTS.some((r) => f.file.startsWith(r))).flatMap(
      (f) => f.softNullCatches,
    );
    expect(soft.length).toBeLessThanOrEqual(SOFT_NULL_CATCH_CEILING);
  });
});

describe('R3 — la projection parent LIT LE FAIT', () => {
  it('`listChildLinksForGuardian` porte au moins une lecture `guardianship.*`', () => {
    const violations = OFFENDERS.filter((o) => o.rule === 'R3-fact-not-read');
    if (violations.length > 0) {
      console.error(violations.map((v) => `${v.file}:${v.line} — ${v.detail}`).join('\n'));
    }
    expect(violations).toEqual([]);
    expect(CORPUS.get(PROJECTION_FILE)!.factReadsInProjection.length).toBeGreaterThan(0);
  });
});

describe('R4 — « Validé » a quitté le vocabulaire parent (AC-3)', () => {
  it('zéro occurrence sous les deux racines parent et sous `packages/ui/src`', () => {
    const violations = OFFENDERS.filter((o) => o.rule === 'R4-validated-word');
    if (violations.length > 0) {
      console.error(violations.map((v) => `${v.file}:${v.line} — ${v.detail}`).join('\n'));
    }
    expect(violations).toEqual([]);
  });

  it('le plafond AILLEURS (domaine des imports admin) reste tenu', () => {
    const elsewhere = FACTS.filter(
      (f) =>
        !PARENT_ROOTS.some((r) => f.file.startsWith(r)) && !f.file.startsWith('packages/ui/src/'),
    ).flatMap((f) => f.validatedWordLines);
    expect(elsewhere.length).toBeLessThanOrEqual(VALIDATED_WORD_ELSEWHERE_CEILING);
  });
});

describe('l’allowlist et les interrupteurs', () => {
  it('`MANUAL_ALLOWLIST` expédie VIDE — le foyer est DÉRIVÉ, pas énuméré', () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
  });

  it('DNC-10 — aucun `SKIP_*` / `ALLOW_*` / `NODE_ENV` ne peut désarmer ce cliquet', () => {
    const own = readFileSync(__filename, 'utf8');
    expect(own).not.toMatch(/process\.env\./);
  });
});

/* ================================================================== *
 * CONTRÔLE NÉGATIF — les formes contrevenantes DOIVENT être signalées.
 *
 * Toute source de fixture est CONCATÉNÉE ligne à ligne, jamais écrite en un
 * littéral unique : un fichier de gate qui contient la chaîne interdite en clair
 * se jugerait lui-même (et il est de toute façon hors corpus, les specs étant
 * exclues de la marche).
 * ================================================================== */

const FIXTURE_PARENT_TSX = join(WEB_SRC, 'components', 'parent', '__fixture-panel.tsx');
const FIXTURE_PARENT_TS = join(WEB_SRC, 'app', 'parent', '__fixture-page.ts');
const FIXTURE_SERVICE_TS = join(
  API_SRC,
  'modules',
  'child-claims',
  '__fixture-child-claims.service.ts',
);

const fixture = (...lines: string[]) => [...lines, ''].join('\n');
const rulesOf = (path: string, source: string) => classify(path, source).findings.map((f) => f.rule);

describe('CONTRÔLE NÉGATIF R1 — les deux moitiés de la règle', () => {
  it('la chaîne U+2019 NON gardée par un test de vacuité est signalée', () => {
    const findings = rulesOf(
      FIXTURE_PARENT_TSX,
      fixture(
        'export function Panel() {',
        `  return <p>{'${EMPTINESS_CLAIM}'}</p>;`,
        '}',
      ),
    );
    expect(findings).toContain('R1-emptiness-claim');
  });

  it('la même chaîne DERRIÈRE un test de vacuité passe — la règle vise la forme, pas le mot', () => {
    const findings = rulesOf(
      FIXTURE_PARENT_TSX,
      fixture(
        'export function Panel({ links }: { links: Row[] }) {',
        '  if (links.length === 0) {',
        `    return <p>{'${EMPTINESS_CLAIM}'}</p>;`,
        '  }',
        '  return <ul />;',
        '}',
      ),
    );
    expect(findings).not.toContain('R1-emptiness-claim');
  });

  it('un identifiant nu `claims` dans le foyer est signalé', () => {
    const findings = rulesOf(
      FIXTURE_PARENT_TSX,
      fixture(
        'export function Panel({ links, claims }: { links: Row[]; claims: Row[] }) {',
        '  if (links.length === 0) {',
        `    return <p>{'${EMPTINESS_CLAIM}'}</p>;`,
        '  }',
        '  return <ul>{claims.length}</ul>;',
        '}',
      ),
    );
    expect(findings).toContain('R1-emptiness-claim');
  });

  it('`claimId` / `ChildClaimDrawer` / `withdrawChildClaimAction` NE tombent PAS (limite 1, déclarée)', () => {
    const findings = rulesOf(
      FIXTURE_PARENT_TSX,
      fixture(
        'export function Panel({ links }: { links: Row[] }) {',
        '  if (links.length === 0) {',
        `    return <p>{'${EMPTINESS_CLAIM}'}</p>;`,
        '  }',
        '  const claimId = links[0].claimId;',
        '  void withdrawChildClaimAction(claimId);',
        '  return <ChildClaimDrawer />;',
        '}',
      ),
    );
    expect(findings).not.toContain('R1-emptiness-claim');
  });

  it('le matcher est ASCII-sensible — une apostrophe ASCII ne compte PAS comme le foyer', () => {
    const asciiVariant = EMPTINESS_CLAIM.split('’').join("'");
    const facts = classify(
      FIXTURE_PARENT_TSX,
      fixture('export const t = ' + JSON.stringify(asciiVariant) + ';'),
    );
    // C'est le piège PF-366 rendu visible : la variante ASCII n'est PAS le foyer.
    expect(facts.emptinessHits).toBe(0);
  });
});

describe('CONTRÔLE NÉGATIF R2 — la lecture échouée rendue vide, sous ses trois habits', () => {
  it('`catch { return [] }` est signalé', () => {
    const findings = rulesOf(
      FIXTURE_PARENT_TS,
      fixture(
        'export async function load() {',
        '  try {',
        '    return await api();',
        '  } catch {',
        '    return [];',
        '  }',
        '}',
      ),
    );
    expect(findings).toContain('R2-catch-empty-collection');
  });

  it('`catch { return { links: [] } }` — l’objet qui CONTIENT le tableau vide — est signalé', () => {
    const findings = rulesOf(
      FIXTURE_PARENT_TS,
      fixture(
        'export async function load() {',
        '  try {',
        '    return await api();',
        '  } catch {',
        '    return { links: [], available: true };',
        '  }',
        '}',
      ),
    );
    expect(findings).toContain('R2-catch-empty-collection');
  });

  it('LA BRANCHE « pas encore disponible » ne peut pas porter de collection (B-3)', () => {
    // §4 row 5 doit SURVIVRE, donc elle doit être écrite SANS tableau : sinon la règle
    // serait insatisfiable et quelqu'un la relâcherait pour la rendre verte (R-30).
    const withCollection = rulesOf(
      FIXTURE_PARENT_TS,
      fixture(
        'export async function load() {',
        '  try {',
        '    return await api();',
        '  } catch (err) {',
        '    if (isNotMigrated(err)) return { links: [], available: false };',
        '    throw err;',
        '  }',
        '}',
      ),
    );
    expect(withCollection).toContain('R2-catch-empty-collection');

    const withoutCollection = rulesOf(
      FIXTURE_PARENT_TS,
      fixture(
        'export async function load() {',
        '  try {',
        '    return await api();',
        '  } catch (err) {',
        "    if (isNotMigrated(err)) return { kind: 'unavailable' as const };",
        '    throw err;',
        '  }',
        '}',
      ),
    );
    expect(withoutCollection).not.toContain('R2-catch-empty-collection');
  });

  it('hors des racines parent, la même forme n’est PAS une contravention (portée déclarée)', () => {
    const findings = rulesOf(
      join(WEB_SRC, 'app', 'admin', '__fixture-page.ts'),
      fixture(
        'export async function load() {',
        '  try {',
        '    return await api();',
        '  } catch {',
        '    return [];',
        '  }',
        '}',
      ),
    );
    expect(findings).not.toContain('R2-catch-empty-collection');
  });
});

describe('CONTRÔLE NÉGATIF R3 — les TROIS formes de récepteur, plus la forme contrevenante', () => {
  const body = (...inner: string[]) =>
    fixture(
      'export class Fixture {',
      `  async ${PROJECTION_METHOD}(args: Args) {`,
      ...inner,
      '  }',
      '}',
    );

  it('une méthode dont le SEUL récepteur Prisma est `guardianshipClaim` est signalée', () => {
    const findings = rulesOf(
      FIXTURE_SERVICE_TS,
      body('    return this.prisma.guardianshipClaim.findMany({ where: args });'),
    );
    expect(findings).toContain('R3-fact-not-read');
  });

  it('forme (a) — `this.prisma.guardianship.findMany(…)` passe', () => {
    const findings = rulesOf(
      FIXTURE_SERVICE_TS,
      body('    return this.prisma.guardianship.findMany({ where: args });'),
    );
    expect(findings).not.toContain('R3-fact-not-read');
  });

  it('forme (b) — le récepteur `tx` d’une transaction passe (une règle nouée sur `prisma` raterait)', () => {
    const findings = rulesOf(
      FIXTURE_SERVICE_TS,
      body(
        '    return this.prisma.$transaction(async (tx) => {',
        '      return tx.guardianship.findMany({ where: args });',
        '    });',
      ),
    );
    expect(findings).not.toContain('R3-fact-not-read');
  });

  it('forme (c) — l’ALIAS `const g = this.prisma.guardianship` passe (PF-366 : ne pas nouer sur un identifiant)', () => {
    const findings = rulesOf(
      FIXTURE_SERVICE_TS,
      body(
        '    const g = this.prisma.guardianship;',
        '    return g.findMany({ where: args });',
      ),
    );
    expect(findings).not.toContain('R3-fact-not-read');
  });

  it('un `guardianship.*` qui n’est PAS une opération de lecture ne suffit pas', () => {
    const findings = rulesOf(
      FIXTURE_SERVICE_TS,
      body('    return this.prisma.guardianship.updateMany({ where: args, data: {} });'),
    );
    expect(findings).toContain('R3-fact-not-read');
  });
});

describe('CONTRÔLE NÉGATIF R4 — « Validé » sous les racines jugées', () => {
  it('le mot dans un composant parent est signalé', () => {
    const findings = rulesOf(
      FIXTURE_PARENT_TSX,
      fixture('export const CHIP = { approved: { label: ' + JSON.stringify(FORBIDDEN_BADGE_WORD) + ' } };'),
    );
    expect(findings).toContain('R4-validated-word');
  });

  it('le mot dans `packages/ui` est signalé', () => {
    const findings = rulesOf(
      join(UI_SRC, 'components', '__fixture-badge.tsx'),
      fixture('export const LABEL = ' + JSON.stringify(FORBIDDEN_BADGE_WORD) + ';'),
    );
    expect(findings).toContain('R4-validated-word');
  });

  it('le mot dans le domaine des IMPORTS admin n’est PAS une contravention', () => {
    const findings = rulesOf(
      join(WEB_SRC, 'app', 'admin', 'imports', '__fixture-page.tsx'),
      fixture('export const LABEL = ' + JSON.stringify(FORBIDDEN_BADGE_WORD + ' · à confirmer') + ';'),
    );
    expect(findings).not.toContain('R4-validated-word');
  });
});
