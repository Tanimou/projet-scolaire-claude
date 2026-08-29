import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E05-8 / PF-25 / ADR-082 §D1–§D2 — LE CLIQUET : plus aucun site ne RÉ-ÉCRIT
 * « qu'est-ce que Keycloak vient de refuser ? », et plus aucun site n'AFFIRME un
 * fait MFA que personne n'a mesuré.
 *
 * LES SIX RÈGLES, EN UNE LIGNE CHACUNE
 * ------------------------------------
 *   R1 — sous `apps/web/src`, aucun fichier ne classe un échec d'authentification
 *        par correspondance de SOUS-CHAÎNE sur une description d'erreur.
 *        TOLÉRANCE ZÉRO. Mesuré sur HEAD : **4** (les quatre aiguilles de
 *        `auth.ts:196-209`). Après : **0**.
 *
 *   R2 — sous `apps/web/src`, la BRANCHE D'ÉCHEC d'un grant direct (le bloc
 *        gardé par une condition qui nomme `access_token`) ne contient aucun
 *        `.includes(` / `.indexOf(` / `.match(` / `.search(`, et `auth.ts`
 *        DÉLÈGUE au classifieur canonique. TOLÉRANCE ZÉRO. HEAD : **4**.
 *
 *   R3 — sous `apps/api/src`, aucun littéral booléen n'est assigné à
 *        `mfaEnabled` / `mfaRequired`. TOLÉRANCE ZÉRO. HEAD : **1**
 *        (`me.controller.ts:85`). Après : **0**.
 *
 *   R4 — l'ensemble de rôles realm enrôlés MFA est DÉCLARÉ exactement une fois,
 *        dans `mfa-enrolment-policy.ts`, et `invite.controller.ts` le CONSOMME.
 *        PLAFOND À RÉSIDUEL NOMMÉ — voir « la découverte » ci-dessous.
 *
 *   R5 — sous `apps/web/src`, `mfaEnabled` n'apparaît jamais en POSITION
 *        BOOLÉENNE NUE. TOLÉRANCE ZÉRO. HEAD : **3**. Après : **0**.
 *
 *   R6 — l'union est FERMÉE et à source UNIQUE : ses membres sont PARSÉS du
 *        module canonique, puis exigés dans les deux consommateurs web ; les deux
 *        codes morts (`otp_required`, `invalid_credentials`) n'y subsistent nulle
 *        part en code exécutable. TOLÉRANCE ZÉRO.
 *
 * POURQUOI R1 EST FONDÉE SUR LA FORME, ET NON SUR LE NOM
 * ------------------------------------------------------
 * Grepper le NOM (`error_description`) est ce qui a fait `PF-168` se
 * sous-compter lui-même : le fichier CORRIGÉ contient encore ce nom — il LIT le
 * champ pour le passer au classifieur. Un détecteur qui le flaguerait rougirait
 * sur le correctif, serait « réparé » en relâchant la règle, et la règle serait
 * perdue. R1 suit donc la CHAÎNE DE CLASSIFICATION : une liaison locale
 * initialisée depuis une description d'erreur, puis passée à un test de
 * sous-chaîne. `clean-surface.ts.txt` est le contrôle d'ACCEPTATION POSITIVE de
 * cette distinction : il lit `error_description` et doit rester VERT.
 *
 * LA DÉCOUVERTE — R4 AVAIT UN RÉSIDUEL, ET IL N'ÉTAIT DANS AUCUN RECENSEMENT
 * --------------------------------------------------------------------------
 * Le brief, l'architecte et le critic recensaient UN site portant la règle MFA
 * (`invite.controller.ts:230-232`). Ce cliquet, écrit sur la FORME, en a trouvé
 * un SECOND que trois relectures avaient manqué :
 * `apps/web/src/app/admin/users/invite/InviteForm.tsx` re-dérivait
 * `form.realmRole === 'school_admin' || form.realmRole === 'teacher'` — et l'un
 * des sites nommait même sa variable `mfaRequired`. La même vérité, écrite une
 * troisième fois, dans un portail que la tranche ne devait pas toucher.
 *
 * CE PARAGRAPHE A ÉTÉ CORRIGÉ À LA PASSE DE LAND (run 96), ET LA CORRECTION EST
 * LA LEÇON. La version expédiée par le sprint disait « le convertir est hors de
 * la tranche » — alors que le diff du sprint en avait DÉJÀ converti deux sites
 * sur quatre, et que `InviteForm.tsx` figurait dans `R4_NAMED_RESIDUAL_FILES`.
 * Le cliquet passait donc au VERT au-dessus de la dérive même qu'il existe pour
 * interdire, sur la foi d'un recensement périmé d'un run sur lui-même. Les
 * quatre sites sont convertis (le quatrième portait la NÉGATION de la règle,
 * `=== 'parent'`, pour renuméroter l'étape suivante — d'où un recensement qui
 * n'en voyait que trois), et `R4_NAMED_RESIDUAL_FILES` EXPÉDIE VIDE.
 *
 * La convention de la maison tient toujours (`page-window-derivation-gate.spec.ts:36-53`) :
 * « un plafond n'exempte personne, il interdit la récidive ». Un résiduel est
 * COMPTÉ et NOMMÉ, jamais allowlisté, et borné par CHEMIN — un NOUVEAU site
 * ailleurs rougit même à compte total constant. Ici l'ensemble nommé est vide,
 * donc TOUT site rougit : c'est l'état cible, et aucun plancher ne le retient
 * (un plancher sur cette classe serait `PF-436`).
 *
 * CE QUE CE CLIQUET NE PROUVE PAS
 * -------------------------------
 * Il prouve une FORME. Que le classifieur rende le BON verdict est porté, et de
 * façon EXÉCUTÉE, par `direct-grant-failure.spec.ts`. Ce que Keycloak répond
 * réellement n'est prouvé par NI L'UN NI L'AUTRE : une seule des deux chaînes de
 * fixture a été mesurée (run 63), la prémisse P-1 ne l'a pas été, et
 * `scripts/keycloak-live-probe.js` STEP 6 est expédié **NOT EXECUTED** (Docker
 * Desktop refuse de démarrer, 7ᵉ run consécutif). Et il ne prouve RIEN sur le
 * TRANSPORT NextAuth : que le code classé atteigne le navigateur est une couture
 * distincte, non gelée ici.
 *
 * `MANUAL_ALLOWLIST` existe, est nommée, et EXPÉDIE VIDE — une assertion le
 * vérifie. Aucune variable d'environnement, aucun `SKIP_*` / `ALLOW_*` (DNC-10).
 * Les helpers requis le sont SANS garde : s'ils s'évaporent, cette suite doit
 * mourir au CHARGEMENT plutôt que dégénérer en « rien à vérifier » (DNC-08).
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const FIXTURES_DIR = join(__dirname, '__fixtures__', 'direct-grant-failure');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/** Les deux foyers canoniques, par ÉGALITÉ DE CHEMIN — pas un glob. */
const CLASSIFIER_HOME = 'packages/contracts/src/security/direct-grant-failure.ts';
const POLICY_HOME = 'packages/contracts/src/security/mfa-enrolment-policy.ts';

/** Les quatre fichiers que le CONTRÔLE POSITIF exige de voir (AC-10). */
const AUTH_TS = 'apps/web/src/auth.ts';
const LOGIN_FORM = 'apps/web/src/components/PortalLoginForm.tsx';
const ME_CONTROLLER = 'apps/api/src/modules/identity/me.controller.ts';
const INVITE_CONTROLLER = 'apps/api/src/modules/identity/invite.controller.ts';

/**
 * LES résiduels de R4, bornés par CHEMIN. Voir « la découverte » ci-dessus.
 * Ce n'est PAS une allowlist : ces sites seraient COMPTÉS comme contrevenants et
 * le plafond leur interdirait d'avoir de la compagnie.
 *
 * **EXPÉDIÉ VIDE (run 96, passe de land).** L'ensemble vide est l'état cible, et
 * il est ATTEIGNABLE ici : `InviteForm.tsx` — le seul membre qu'ait jamais eu
 * cette liste — a été converti sur ses quatre sites. Une liste vide fait rougir
 * R4 sur le PREMIER site qui réapparaît, où qu'il soit, ce qui est exactement ce
 * que le cliquet doit faire. Ne remettre un chemin ici que pour un résiduel
 * qu'une tranche a mesuré et refusé de convertir, en le nommant dans son ADR.
 */
const R4_NAMED_RESIDUAL_FILES: readonly string[] = [];

/** Nommée, et VIDE. Une assertion le vérifie (DNC-10). */
const MANUAL_ALLOWLIST: readonly string[] = [];

/* Plafonds. */
const R1_CEILING = 0;
const R2_CEILING = 0;
const R3_CEILING = 0;
const R5_CEILING = 0;
const R6_CEILING = 0;

/* Planchers d'anti-vacuité — toujours `>=`, jamais une égalité. */
// Mesurés sur CET arbre, cette marche-ci (les `*.spec.ts` sont EXCLUS, d'où des
// chiffres inférieurs aux planchers des gates qui les incluent) : web 3xx,
// api 174, packages 1xx. Les planchers gardent de la marge sous la mesure — ils
// attrapent une marche EFFONDRÉE, ils ne suivent pas la taille du produit.
const MIN_WEB_FILES = 300;
const MIN_API_FILES = 150;
const MIN_PACKAGE_FILES = 100;
/** AC-9 : le plancher compte les contrevenants de FIXTURE, jamais ceux de l'arbre. */
const MIN_FIXTURE_OFFENDERS = 4;
/** Un fichier nommé dont le code exécutable serait vide rendrait tout vacueux. */
const MIN_NAMED_FILE_CODE = 200;

/** Les codes morts que la tranche SUPPRIME (et ne rend pas seulement inatteignables). */
const DELETED_CODES = ['otp_required', 'invalid_credentials'] as const;

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardés, exprès (DNC-08).
const walkRead = require(WALK_READ_PATH) as {
  mapWalkedFiles: <V>(
    paths: string[],
    build: (path: string, source: string) => [string, V],
  ) => { entries: [string, V][]; skipped: string[] };
  warnSkipped: (label: string, skipped: string[]) => boolean;
  namedReader: (label: string, map: Map<string, string>) => (key: string) => string;
  maxVanishedFor: (n: number) => number;
};
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
      // `.next` et `dist` portent des COPIES MINIFIÉES du code même que ce
      // cliquet gèle : les y inclure le rendrait rouge à perpétuité, et il
      // serait « réparé » en relâchant la règle — la mauvaise réparation.
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

const WEB_FILES = walkSources(WEB_SRC).sort();
const API_FILES = walkSources(API_SRC).sort();
const PACKAGE_FILES = walkPackages().sort();

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/* ================================================================== *
 * LE STRIPPER DE COMMENTAIRES — les chaînes sont CONSERVÉES
 * ================================================================== */

/**
 * Retire les commentaires, garde les littéraux de chaîne.
 *
 * R6 doit pouvoir dire « le code `otp_required` n'existe plus » SANS interdire
 * qu'un commentaire explique sa suppression — sinon la règle punirait la trace
 * écrite du correctif. `/` n'ouvre un commentaire QUE suivi de `/` ou `*`, de
 * sorte qu'un littéral d'expression régulière n'est pas pris pour un
 * commentaire. PF-220 : le résultat est CONTRÔLÉ par une assertion, jamais
 * supposé.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source.charAt(i);
    const next = source.charAt(i + 1);
    if (c === '/' && next === '/') {
      while (i < n && source.charAt(i) !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source.charAt(i) === '*' && source.charAt(i + 1) === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n && source.charAt(i) !== quote) {
        if (source.charAt(i) === '\\') {
          out += source.charAt(i);
          i += 1;
        }
        out += source.charAt(i);
        i += 1;
      }
      out += quote;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/* ================================================================== *
 * L'ENSEMBLE CANONIQUE DES RÔLES — PARSÉ, JAMAIS RECOPIÉ
 * ================================================================== */

const POLICY_SOURCE = readFileSync(join(REPO_ROOT, ...POLICY_HOME.split('/')), 'utf8');
const CLASSIFIER_SOURCE = readFileSync(join(REPO_ROOT, ...CLASSIFIER_HOME.split('/')), 'utf8');

function parseSource(source: string, tsx: boolean): any {
  return ts.createSourceFile(
    tsx ? 'fixture.tsx' : 'fixture.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Les littéraux de chaîne d'un littéral de tableau, ou `null` si mixte. */
function stringArrayMembers(node: any): string[] | null {
  let target = node;
  // `[...] as const` — on descend dans l'assertion.
  while (target && (ts.isAsExpression(target) || ts.isParenthesizedExpression(target))) {
    target = target.expression;
  }
  if (!target || !ts.isArrayLiteralExpression(target)) return null;
  const members: string[] = [];
  for (const element of target.elements) {
    if (!ts.isStringLiteral(element)) return null;
    members.push(element.text as string);
  }
  return members;
}

/**
 * Extrait le tableau de chaînes initialisant `name` dans `source`, par l'AST.
 *
 * JETTE plutôt que de rendre `[]` : un ensemble canonique vide rendrait R4 et R6
 * vacuement vertes — le mode d'échec précis que `PF-407`/`PF-438` ont produit
 * deux fois. L'accumulateur est un tableau plutôt qu'un `let` capturé, parce
 * qu'une affectation faite dans une fermeture n'affine pas le type du `let`.
 */
function parseStringArray(source: string, name: string, home: string): string[] {
  const file = parseSource(source, false);
  const found: string[][] = [];
  const visit = (node: any): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      (node.name.text as string) === name &&
      node.initializer
    ) {
      const members = stringArrayMembers(node.initializer);
      if (members) found.push(members);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const first = found[0];
  if (found.length !== 1 || !first || first.length === 0) {
    throw new Error(
      `DNC-08 — auth-failure-classification-gate: ${name} n'est pas déclaré exactement une fois ` +
        `comme tableau de chaînes non vide dans ${home} (trouvé ${found.length}). ` +
        'Refus de dériver un ensemble vide : il rendrait les règles vacuement vertes.',
    );
  }
  return first;
}

const CANONICAL_ROLES = parseStringArray(POLICY_SOURCE, 'MFA_ENROLLED_REALM_ROLES', POLICY_HOME);
const CANONICAL_CODES = parseStringArray(
  CLASSIFIER_SOURCE,
  'DIRECT_GRANT_FAILURE_CODES',
  CLASSIFIER_HOME,
);

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/* ================================================================== *
 * LE CLASSIFIEUR — il reçoit une SOURCE, jamais un chemin à reconnaître
 * ================================================================== */

type RuleId =
  | 'R1-substring-classification'
  | 'R2-failure-branch-substring'
  | 'R3-mfa-boolean-literal'
  | 'R4-second-role-declaration'
  | 'R5-bare-truthy-mfa';

type Finding = { rule: RuleId; line: number; detail: string };

type FileFacts = {
  findings: Finding[];
  /** Le fichier DÉLÈGUE-t-il au classifieur canonique ? */
  delegatesClassifier: boolean;
  /** Le fichier DÉLÈGUE-t-il à la politique canonique ? */
  delegatesPolicy: boolean;
  /** Le fichier DÉCLARE-t-il l'un des deux foyers ? */
  declaresClassifierHome: boolean;
  declaresPolicyHome: boolean;
};

/** Un nom d'expression qui DÉSIGNE une description d'erreur d'authentification. */
const DESCRIPTION_TOKEN = /\b(error_description|errorDescription|errorDesc)\b/;

/** Les tests de sous-chaîne que R1 et R2 gouvernent. */
const SUBSTRING_TESTS = new Set(['includes', 'indexOf', 'match', 'search', 'startsWith', 'endsWith']);

/** L'identifiant racine d'une chaîne d'accès (`a.b.c()` → `a`). */
function rootIdentifier(node: any): string | null {
  let current = node;
  while (current) {
    if (ts.isIdentifier(current)) return current.text as string;
    if (
      ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current) ||
      ts.isCallExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isParenthesizedExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return null;
  }
  return null;
}

/** Le nœud est-il le littéral `true` ou `false` ? */
function isBooleanLiteral(node: any): boolean {
  if (!node) return false;
  return node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword;
}

/**
 * LE classifieur, appliqué À L'IDENTIQUE à l'arbre réel et aux fixtures — c'est
 * ce qui rend le contrôle de falsifiabilité probant plutôt que décoratif.
 */
function classify(
  source: string,
  options: { root: 'web' | 'api' | 'package'; tsx: boolean; isCanonicalHome: boolean },
): FileFacts {
  const code = stripComments(source);
  const facts: FileFacts = {
    findings: [],
    delegatesClassifier: code.includes('classifyDirectGrantFailure'),
    delegatesPolicy:
      code.includes('mfaRequiredByInvitePolicy') || code.includes('isMfaEnrolledRealmRole'),
    declaresClassifierHome: code.includes('export function classifyDirectGrantFailure'),
    declaresPolicyHome: code.includes('export function isMfaEnrolledRealmRole'),
  };

  const sourceFile = parseSource(source, options.tsx);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineOf = (node: any) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  /**
   * R1, étape 1 — les LIAISONS LOCALES qui portent une description d'erreur.
   * C'est la moitié « forme » de la règle : `const desc = (body?.error_description
   * ?? '').toLowerCase()` fait de `desc` une description, et c'est `desc` — jamais
   * le nom du champ — que la cascade testait.
   */
  const descriptionBindings = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collectBindings = (node: any): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      DESCRIPTION_TOKEN.test(node.initializer.getText(sourceFile) as string)
    ) {
      descriptionBindings.add(node.name.text as string);
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(sourceFile);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDescriptionExpression = (node: any): boolean => {
    if (!node) return false;
    const text = node.getText(sourceFile) as string;
    if (DESCRIPTION_TOKEN.test(text)) return true;
    const root = rootIdentifier(node);
    return root !== null && descriptionBindings.has(root);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any): void => {
    /* ---------------- R1 : classification par sous-chaîne ---------------- */
    if (options.root === 'web' && !options.isCanonicalHome && ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text as string;
        // Forme directe : `<description>.includes(…)`.
        if (SUBSTRING_TESTS.has(method) && isDescriptionExpression(callee.expression)) {
          facts.findings.push({
            rule: 'R1-substring-classification',
            line: lineOf(node),
            detail: `.${method}( sur une description d'erreur d'authentification`,
          });
        }
        // Forme inversée : `/re/.test(<description>)` ou `RE.exec(<description>)`.
        if (
          (method === 'test' || method === 'exec') &&
          node.arguments.some((argument: unknown) => isDescriptionExpression(argument))
        ) {
          facts.findings.push({
            rule: 'R1-substring-classification',
            line: lineOf(node),
            detail: `.${method}( d'une expression régulière contre une description d'erreur`,
          });
        }
      }
    }

    /* -------- R2 : la BRANCHE D'ÉCHEC d'un grant direct, quelle qu'elle soit -------- */
    // La portée est le BLOC gardé par une condition qui nomme `access_token`, et
    // NON la fonction entière : le contrôle de rôle realm du chemin de SUCCÈS
    // (`roles.some((r) => required.includes(r))`) est légitime, inchangé par la
    // tranche (AC-12), et une règle qui exigerait sa suppression demanderait une
    // modification du chemin d'autorisation pour satisfaire un gate.
    if (options.root === 'web' && !options.isCanonicalHome && ts.isIfStatement(node)) {
      const condition = node.expression.getText(sourceFile) as string;
      if (condition.includes('access_token')) {
        // Commentaires RETIRÉS avant l'examen : un commentaire qui RACONTE la
        // cascade supprimée est souhaitable et ne doit pas faire rougir R2.
        const branch = node.thenStatement
          ? stripComments(node.thenStatement.getText(sourceFile) as string)
          : '';
        for (const method of ['.includes(', '.indexOf(', '.match(', '.search(']) {
          let from = 0;
          for (;;) {
            const at = branch.indexOf(method, from);
            if (at === -1) break;
            facts.findings.push({
              rule: 'R2-failure-branch-substring',
              line: lineOf(node),
              detail: `${method} dans la branche d'échec d'un grant direct`,
            });
            from = at + method.length;
          }
        }
      }
    }

    /* ---------------- R3 : littéral booléen sur mfaEnabled/mfaRequired ---------------- */
    if (options.root === 'api') {
      if (ts.isPropertyAssignment(node)) {
        const name = node.name;
        const key =
          ts.isIdentifier(name) || ts.isStringLiteral(name) ? (name.text as string) : undefined;
        if ((key === 'mfaEnabled' || key === 'mfaRequired') && isBooleanLiteral(node.initializer)) {
          facts.findings.push({
            rule: 'R3-mfa-boolean-literal',
            line: lineOf(node),
            detail: `littéral booléen assigné à \`${key}\``,
          });
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        isBooleanLiteral(node.right)
      ) {
        const left = node.left.getText(sourceFile) as string;
        if (/\bmfa(Enabled|Required)\s*$/.test(left)) {
          facts.findings.push({
            rule: 'R3-mfa-boolean-literal',
            line: lineOf(node),
            detail: `littéral booléen ré-assigné à \`${left}\``,
          });
        }
      }
    }

    /* ---------------- R4 : seconde déclaration de l'ensemble de rôles ---------------- */
    if (!options.isCanonicalHome) {
      // Forme A — un littéral de tableau dont l'ensemble ÉGALE l'ensemble canonique.
      if (ts.isArrayLiteralExpression(node)) {
        const members = stringArrayMembers(node);
        if (members && sameSet(members, CANONICAL_ROLES)) {
          facts.findings.push({
            rule: 'R4-second-role-declaration',
            line: lineOf(node),
            detail: `littéral de tableau égal à l'ensemble canonique [${members.join(', ')}]`,
          });
        }
      }
      // Forme B — une chaîne `||` de comparaisons couvrant exactement l'ensemble.
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        const parent = node.parent;
        const isChainTop = !(
          parent &&
          ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.BarBarToken
        );
        if (isChainTop) {
          const compared: string[] = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const collect = (n: any): void => {
            if (
              ts.isBinaryExpression(n) &&
              (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
                n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
            ) {
              if (ts.isStringLiteral(n.right)) compared.push(n.right.text as string);
              if (ts.isStringLiteral(n.left)) compared.push(n.left.text as string);
            }
            ts.forEachChild(n, collect);
          };
          collect(node);
          if (sameSet([...new Set(compared)], CANONICAL_ROLES)) {
            facts.findings.push({
              rule: 'R4-second-role-declaration',
              line: lineOf(node),
              detail: `chaîne \`||\` re-dérivant l'ensemble canonique [${CANONICAL_ROLES.join(', ')}]`,
            });
          }
        }
      }
    }

    /* ---------------- R5 : `mfaEnabled` en position booléenne nue ---------------- */
    if (options.root === 'web') {
      const isMfaEnabledRead =
        (ts.isPropertyAccessExpression(node) && (node.name.text as string) === 'mfaEnabled') ||
        (ts.isIdentifier(node) &&
          (node.text as string) === 'mfaEnabled' &&
          node.parent &&
          !ts.isPropertyAccessExpression(node.parent) &&
          !ts.isPropertyAssignment(node.parent) &&
          !ts.isPropertySignature(node.parent) &&
          !ts.isBindingElement(node.parent));
      if (isMfaEnabledRead) {
        const parent = node.parent;
        let bare = false;
        if (parent && ts.isPrefixUnaryExpression(parent)) {
          bare = parent.operator === ts.SyntaxKind.ExclamationToken;
        } else if (parent && ts.isBinaryExpression(parent)) {
          bare =
            parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
            parent.operatorToken.kind === ts.SyntaxKind.BarBarToken;
        } else if (parent && ts.isConditionalExpression(parent)) {
          bare = parent.condition === node;
        } else if (parent && ts.isIfStatement(parent)) {
          bare = parent.expression === node;
        }
        if (bare) {
          facts.findings.push({
            rule: 'R5-bare-truthy-mfa',
            line: lineOf(node),
            detail: '`mfaEnabled` lu par sa véracité — `null` est faux-y, pas « désactivé »',
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return facts;
}

/* ================================================================== *
 * LA MESURE
 * ================================================================== */

function measure(
  files: string[],
  root: 'web' | 'api' | 'package',
): { facts: Map<string, FileFacts>; sources: Map<string, string> } {
  const walked = walkRead.mapWalkedFiles<{ facts: FileFacts; source: string }>(
    files,
    (path, source) => {
      const key = rel(path);
      return [
        key,
        {
          source,
          facts: classify(source, {
            root,
            tsx: path.endsWith('.tsx'),
            isCanonicalHome: key === CLASSIFIER_HOME || key === POLICY_HOME,
          }),
        },
      ];
    },
  );
  walkRead.warnSkipped('auth-failure-classification-gate', walked.skipped);
  const facts = new Map<string, FileFacts>();
  const sources = new Map<string, string>();
  for (const [key, value] of walked.entries) {
    facts.set(key, value.facts);
    sources.set(key, value.source);
  }
  return { facts, sources };
}

const WEB = measure(WEB_FILES, 'web');
const API = measure(API_FILES, 'api');
const PKG = measure(PACKAGE_FILES, 'package');

const ALL_FACTS = new Map<string, FileFacts>([...WEB.facts, ...API.facts, ...PKG.facts]);
const ALL_SOURCES = new Map<string, string>([...WEB.sources, ...API.sources, ...PKG.sources]);

/**
 * Lecture NOMMÉE : elle JETTE si le fichier est absent du corpus, au lieu de
 * servir `''` — un `''` satisfait toute assertion négative en aval (TOOL-17b).
 */
const named = walkRead.namedReader('auth-failure-classification-gate', ALL_SOURCES);

function findingsFor(rule: RuleId): string[] {
  const out: string[] = [];
  for (const [path, facts] of ALL_FACTS) {
    for (const finding of facts.findings) {
      if (finding.rule === rule) out.push(`${path}:${finding.line} — ${finding.detail}`);
    }
  }
  return out.sort();
}

function filesWithRule(rule: RuleId): string[] {
  const out = new Set<string>();
  for (const [path, facts] of ALL_FACTS) {
    if (facts.findings.some((f) => f.rule === rule)) out.add(path);
  }
  return [...out].sort();
}

/* ================================================================== *
 * LES FIXTURES — le MÊME classifieur, pour prouver qu'il peut rougir
 * ================================================================== */

const fixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), 'utf8');

const PRE_FIX_AUTH = classify(fixture('pre-fix-auth.ts.txt'), {
  root: 'web',
  tsx: false,
  isCanonicalHome: false,
});
const PRE_FIX_ME = classify(fixture('pre-fix-me-controller.ts.txt'), {
  root: 'api',
  tsx: false,
  isCanonicalHome: false,
});
const PRE_FIX_ROLES = classify(fixture('pre-fix-invite-roles.ts.txt'), {
  root: 'api',
  tsx: false,
  isCanonicalHome: false,
});
const PRE_FIX_TRUTHY = classify(fixture('pre-fix-truthy-read.tsx.txt'), {
  root: 'web',
  tsx: true,
  isCanonicalHome: false,
});
const CLEAN_AS_WEB = classify(fixture('clean-surface.ts.txt'), {
  root: 'web',
  tsx: false,
  isCanonicalHome: false,
});
const CLEAN_AS_API = classify(fixture('clean-surface.ts.txt'), {
  root: 'api',
  tsx: false,
  isCanonicalHome: false,
});

const FIXTURE_OFFENDERS =
  PRE_FIX_AUTH.findings.length +
  PRE_FIX_ME.findings.length +
  PRE_FIX_ROLES.findings.length +
  PRE_FIX_TRUTHY.findings.length;

/* ================================================================== *
 * LES TESTS — 1. CONTRÔLE POSITIF (AC-10), AVANT TOUTE ASSERTION `=== 0`
 * ================================================================== */

describe('auth-failure-classification gate — contrôle positif (AC-10, PF-407/PF-438)', () => {
  it('les trois marches ont réellement vu leurs racines', () => {
    expect(WEB_FILES.length).toBeGreaterThanOrEqual(MIN_WEB_FILES);
    expect(API_FILES.length).toBeGreaterThanOrEqual(MIN_API_FILES);
    expect(PACKAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
  });

  it('la tolérance walk/read n’a pas vidé le corpus (TOOL-17)', () => {
    expect(WEB.sources.size).toBeGreaterThanOrEqual(
      WEB_FILES.length - walkRead.maxVanishedFor(WEB_FILES.length),
    );
    expect(API.sources.size).toBeGreaterThanOrEqual(
      API_FILES.length - walkRead.maxVanishedFor(API_FILES.length),
    );
  });

  it('LES QUATRE FICHIERS NOMMÉS sont dans les marches, avec du code NON VIDE', () => {
    // Sans ceci, « zéro contravention » se confondrait avec « le marcheur n'a
    // jamais ouvert le fichier ». `named()` JETTE si la clé est absente.
    for (const path of [AUTH_TS, LOGIN_FORM, ME_CONTROLLER, INVITE_CONTROLLER]) {
      const code = stripComments(named(path)).trim();
      expect(`${path}: ${code.length >= MIN_NAMED_FILE_CODE}`).toBe(`${path}: true`);
      expect(ALL_FACTS.has(path)).toBe(true);
    }
  });

  it('CONTRÔLE DU STRIPPER (PF-220) : il n’a blanchi aucun des quatre', () => {
    expect(stripComments(named(AUTH_TS))).toContain('directGrantLogin');
    expect(stripComments(named(LOGIN_FORM))).toContain('export');
    expect(stripComments(named(ME_CONTROLLER))).toContain('mfaEnabled');
    expect(stripComments(named(INVITE_CONTROLLER))).toContain('CONFIGURE_TOTP');
  });

  it('l’ensemble canonique et l’union canonique sont NON VIDES et PARSÉS', () => {
    expect(CANONICAL_ROLES.length).toBeGreaterThanOrEqual(2);
    expect(CANONICAL_CODES.length).toBeGreaterThanOrEqual(3);
  });

  it('l’allowlist manuelle expédie VIDE (DNC-10)', () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
  });
});

/* ================================================================== *
 * 2. FALSIFIABILITÉ (AC-9) — chaque règle rougit sur SA fixture
 * ================================================================== */

describe('auth-failure-classification gate — falsifiabilité (AC-9)', () => {
  it('PLANCHER D’ANTI-VACUITÉ : il porte sur les FIXTURES, jamais sur l’arbre', () => {
    // PF-436 (run 95) : un plancher posé sur un recensement vivant punit le
    // travail qu'il séquence. Le recensement vivant est exactement ce que cette
    // tranche réduit à zéro ; la fixture, elle, ne bouge jamais.
    expect(FIXTURE_OFFENDERS).toBeGreaterThanOrEqual(MIN_FIXTURE_OFFENDERS);
  });

  it('R1 ROUGIT sur la cascade d’avant la tranche (les quatre aiguilles)', () => {
    const r1 = PRE_FIX_AUTH.findings.filter((f) => f.rule === 'R1-substring-classification');
    expect(r1.length).toBeGreaterThanOrEqual(4);
  });

  it('R2 ROUGIT sur la branche d’échec d’avant la tranche', () => {
    const r2 = PRE_FIX_AUTH.findings.filter((f) => f.rule === 'R2-failure-branch-substring');
    expect(r2.length).toBeGreaterThanOrEqual(4);
  });

  it('R3 ROUGIT sur le littéral `mfaEnabled` — sa SEULE preuve, son résiduel réel étant 0', () => {
    const r3 = PRE_FIX_ME.findings.filter((f) => f.rule === 'R3-mfa-boolean-literal');
    expect(r3.length).toBeGreaterThanOrEqual(2);
  });

  it('R4 ROUGIT sur les DEUX formes d’une seconde déclaration (tableau et chaîne `||`)', () => {
    const r4 = PRE_FIX_ROLES.findings.filter((f) => f.rule === 'R4-second-role-declaration');
    expect(r4.length).toBeGreaterThanOrEqual(2);
  });

  it('R5 ROUGIT sur les trois lectures par véracité d’avant la tranche', () => {
    const r5 = PRE_FIX_TRUTHY.findings.filter((f) => f.rule === 'R5-bare-truthy-mfa');
    expect(r5.length).toBeGreaterThanOrEqual(3);
  });

  it('CONTRÔLE D’ACCEPTATION POSITIVE : la forme CONVERTIE reste VERTE (critic C-06)', () => {
    // Elle LIT `error_description` et branche sur un échec. Un détecteur fondé
    // sur le NOM la flaguerait ; celui-ci ne doit pas.
    expect(CLEAN_AS_WEB.findings).toEqual([]);
    expect(CLEAN_AS_API.findings).toEqual([]);
    expect(CLEAN_AS_WEB.delegatesClassifier).toBe(true);
    expect(CLEAN_AS_WEB.delegatesPolicy).toBe(true);
    // …et elle contient bien la chaîne qui piégerait un détecteur naïf.
    expect(fixture('clean-surface.ts.txt')).toContain('error_description');
  });

  it('CONTRÔLE DE FOYER : les deux modules canoniques ne sont JAMAIS contrevenants', () => {
    for (const home of [CLASSIFIER_HOME, POLICY_HOME]) {
      const facts = ALL_FACTS.get(home);
      expect(facts).toBeDefined();
      expect(facts?.findings).toEqual([]);
    }
  });

  it('CONTRÔLE D’EXCLUSION : l’exemption du foyer est une ÉGALITÉ DE CHEMIN, pas un glob', () => {
    // Le MÊME contenu, jugé SANS le drapeau de foyer, DOIT rougir sur R4 —
    // sinon l'exemption masquerait bien plus que le fichier qu'elle nomme.
    const asOrdinary = classify(POLICY_SOURCE, {
      root: 'package',
      tsx: false,
      isCanonicalHome: false,
    });
    expect(
      asOrdinary.findings.filter((f) => f.rule === 'R4-second-role-declaration').length,
    ).toBeGreaterThan(0);
  });
});

/* ================================================================== *
 * 3. LES SIX RÈGLES SUR L'ARBRE VIVANT
 * ================================================================== */

describe('auth-failure-classification gate — R1/R2 : la classification par sous-chaîne', () => {
  it(`R1 — aucune classification par sous-chaîne sous apps/web/src (4 sur HEAD)`, () => {
    expect(findingsFor('R1-substring-classification')).toHaveLength(R1_CEILING);
  });

  it(`R2 — aucune sous-chaîne dans une branche d’échec de grant direct (4 sur HEAD)`, () => {
    expect(findingsFor('R2-failure-branch-substring')).toHaveLength(R2_CEILING);
  });

  it('R2 (seconde moitié) — `auth.ts` DÉLÈGUE au classifieur canonique', () => {
    const facts = ALL_FACTS.get(AUTH_TS);
    expect(facts?.delegatesClassifier).toBe(true);
    expect(stripComments(named(AUTH_TS))).toContain('@pilotage/contracts');
  });
});

describe('auth-failure-classification gate — R3 : plus de fait MFA inventé', () => {
  it('R3 — aucun littéral booléen sur `mfaEnabled`/`mfaRequired` sous apps/api/src (1 sur HEAD)', () => {
    expect(findingsFor('R3-mfa-boolean-literal')).toHaveLength(R3_CEILING);
  });

  it('`me.controller.ts` DÉRIVE `mfaRequired` de la politique unique, sans E/S ajoutée', () => {
    const code = stripComments(named(ME_CONTROLLER));
    expect(code).toContain('mfaRequiredByInvitePolicy(realmRoles)');
    expect(code).toContain('mfaEnabled');
    // Zéro E/S ajoutée : la dérivation ne consulte ni Prisma ni Keycloak.
    const derivation = code.split('mfaRequiredByInvitePolicy')[1] ?? '';
    expect(derivation.slice(0, 40)).not.toContain('await');
  });
});

describe('auth-failure-classification gate — R4 : UNE seule déclaration de l’ensemble', () => {
  it('EXACTEMENT UN fichier déclare la politique, et c’est le foyer d’ADR-082 §D2', () => {
    const homes = [...ALL_FACTS.entries()].filter(([, f]) => f.declaresPolicyHome).map(([p]) => p);
    expect(homes).toEqual([POLICY_HOME]);
  });

  it('`invite.controller.ts` CONSOMME la règle au lieu de la porter', () => {
    const facts = ALL_FACTS.get(INVITE_CONTROLLER);
    expect(facts?.delegatesPolicy).toBe(true);
    expect(facts?.findings.filter((f) => f.rule === 'R4-second-role-declaration')).toEqual([]);
    // Comportement IDENTIQUE : les mêmes deux rôles reçoivent `CONFIGURE_TOTP`.
    expect(stripComments(named(INVITE_CONTROLLER))).toContain(
      "requiredActions.push('CONFIGURE_TOTP')",
    );
  });

  it('R4 — AUCUN second site ne déclare la règle, et la liste des résiduels nommés est VIDE', () => {
    // Découvert PAR ce cliquet, absent des trois recensements du brief :
    // `InviteForm.tsx` re-dérivait la même règle. Le sprint en a converti deux
    // sites, la passe de land les deux derniers (dont un portait la NÉGATION,
    // `=== 'parent'`, ce qui explique qu'un recensement en ait manqué un).
    // COMPTÉ, jamais exempté ; un NOUVEAU site où que ce soit rougit ce test.
    //
    // L'ENSEMBLE VIDE EST L'ÉTAT CIBLE, IL EST AUTORISÉ, ET IL EST ATTEINT.
    // Aucun plancher n'est posé sur ce compte : ce serait un plancher sur une
    // classe que la roadmap fait BAISSER, c'est-à-dire PF-436 (run 95) — le
    // cliquet punirait le travail qu'il séquence. L'anti-vacuité de R4 vit dans
    // sa fixture (`pre-fix-invite-roles.ts.txt`), qui ne bouge pas quand le
    // produit avance.
    const offenders = filesWithRule('R4-second-role-declaration');
    expect(offenders).toEqual([]);
    expect(R4_NAMED_RESIDUAL_FILES).toEqual([]);
  });
});

describe('auth-failure-classification gate — R5 : `mfaEnabled` n’est plus lu par sa véracité', () => {
  it('R5 — aucune lecture booléenne nue sous apps/web/src (3 sur HEAD)', () => {
    expect(findingsFor('R5-bare-truthy-mfa')).toHaveLength(R5_CEILING);
  });
});

describe('auth-failure-classification gate — R6 : l’union fermée, à source unique', () => {
  it('l’union est déclarée dans EXACTEMENT UN fichier', () => {
    const homes = [...ALL_FACTS.entries()]
      .filter(([, f]) => f.declaresClassifierHome)
      .map(([p]) => p);
    expect(homes).toEqual([CLASSIFIER_HOME]);

    const declaring = [...ALL_SOURCES.entries()]
      .filter(([, source]) => stripComments(source).includes('export type DirectGrantFailureCode'))
      .map(([path]) => path);
    expect(declaring).toEqual([CLASSIFIER_HOME]);
  });

  it('le RENDU porte TOUS les membres — PARSÉS du foyer, jamais listés à la main ici', () => {
    // `PortalLoginForm` est le seul site qui doit ÉNUMÉRER : il fait
    // correspondre un code à un message, donc chaque membre doit y apparaître,
    // sinon un membre serait rendu par le repli sans que personne le sache.
    const formCode = stripComments(named(LOGIN_FORM));
    for (const code of CANONICAL_CODES) {
      expect(`${LOGIN_FORM} ⊃ ${code}: ${formCode.includes(code)}`).toBe(
        `${LOGIN_FORM} ⊃ ${code}: true`,
      );
    }
  });

  it('`auth.ts` DÉRIVE l’union au lieu de la RÉ-ÉNUMÉRER — c’est la source unique', () => {
    // Exiger ici les trois littéraux serait exiger une COPIE À LA MAIN de plus,
    // c'est-à-dire la dérive que la tranche ferme. Ce que la règle exige est
    // l'inverse : que le type vienne du foyer, et que le seuil délègue.
    const authCode = stripComments(named(AUTH_TS));
    expect(authCode).toContain('DirectGrantFailureCode');
    expect(authCode).toContain('classifyDirectGrantFailure(');
    // Et il n'a pas le droit de ré-écrire l'union : au plus UN membre en clair
    // (le repli « aucune réponse exploitable », qu'il lève lui-même sur les
    // chemins qui n'ont pas de réponse du tout).
    const enumerated = CANONICAL_CODES.filter((code) => authCode.includes(`'${code}'`));
    expect(enumerated.length).toBeLessThanOrEqual(1);
  });

  it('les codes morts sont SUPPRIMÉS, pas rendus inatteignables (AC-4)', () => {
    // Sur du code STRIPPÉ de ses commentaires : un commentaire qui EXPLIQUE la
    // suppression est souhaitable et ne doit pas faire rougir la règle.
    const offenders: string[] = [];
    for (const path of [AUTH_TS, LOGIN_FORM]) {
      const code = stripComments(named(path));
      for (const dead of DELETED_CODES) {
        if (code.includes(dead)) offenders.push(`${path} → ${dead}`);
      }
    }
    expect(offenders).toHaveLength(R6_CEILING);
  });

  it('la valeur runtime et l’alias de type de l’union déclarent le MÊME ensemble', () => {
    const alias = CLASSIFIER_SOURCE.split('export type DirectGrantFailureCode')[1] ?? '';
    const members = [...(alias.split(';')[0] ?? '').matchAll(/'([a-z-]+)'/g)].map(
      (m) => m[1] ?? '',
    );
    expect(sameSet(members, CANONICAL_CODES)).toBe(true);
  });
});

/* ================================================================== *
 * 4. LA SURFACE D'EXPORT (AC-11) — jamais un nom de fichier
 * ================================================================== */

describe('auth-failure-classification gate — surface d’export (AC-11)', () => {
  const CONTRACTS = join(REPO_ROOT, 'packages', 'contracts');
  const SECURITY_BARREL = join(CONTRACTS, 'src', 'security', 'index.ts');
  const ROOT_BARREL = join(CONTRACTS, 'src', 'index.ts');
  const BUILD_TSCONFIG = join(CONTRACTS, 'tsconfig.build.json');
  const DIST_INDEX = join(CONTRACTS, 'dist', 'index.js');

  it('la CHAÎNE D’ENTRÉE du build est complète — assertée INCONDITIONNELLEMENT', () => {
    const barrel = readFileSync(SECURITY_BARREL, 'utf8');
    expect(barrel).toContain("export * from './direct-grant-failure'");
    expect(barrel).toContain("export * from './mfa-enrolment-policy'");
    expect(readFileSync(ROOT_BARREL, 'utf8')).toContain("export * from './security'");
    const buildConfig = JSON.parse(readFileSync(BUILD_TSCONFIG, 'utf8')) as {
      include?: string[];
      exclude?: string[];
    };
    expect(buildConfig.include).toContain('src/**/*');
    // Les deux modules ne sont ni des specs ni des tests : rien ne les exclut.
    expect(buildConfig.exclude ?? []).not.toContain('src/security');
  });

  it('MÉCANISME PROUVÉ VIVANT : `security/` atteint bien `dist`, avec son contrôle NÉGATIF', () => {
    if (!existsSync(DIST_INDEX)) {
      // État CLASSIFIABLE et nommé (DNC-08) : `dist/` est git-ignoré et n'existe
      // pas sur un checkout neuf. La chaîne d'ENTRÉE, elle, est assertée
      // inconditionnellement ci-dessus.
      console.warn(
        'auth-failure-classification-gate — packages/contracts/dist/index.js absent : ' +
          'surface d’export non vérifiable sur ce checkout. Pré-requis de LAND : ' +
          'pnpm --filter @pilotage/contracts build.',
      );
      expect(existsSync(join(CONTRACTS, 'src', 'security', 'direct-grant-failure.ts'))).toBe(true);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const dist = require(DIST_INDEX) as Record<string, unknown>;
    // Trois symboles de `security/` DÉJÀ expédiés : c'est la preuve LIVE que ce
    // répertoire précis traverse le barrel jusqu'à `dist`, pas un argument.
    expect(typeof dist.neutraliseCsvCell).toBe('function');
    expect(typeof dist.buildWebCsp).toBe('function');
    expect(typeof dist.buildBrandingCss).toBe('function');
    // CONTRÔLE NÉGATIF sur le MÊME objet module : un symbole délibérément non
    // exporté lit `undefined`. Sans lui, « c'est une fonction » ne distinguerait
    // pas un vrai export d'un objet permissif.
    expect(dist.__deliberatelyNotExportedFromContracts).toBeUndefined();
    expect(typeof dist.normalise).toBe('undefined');
  });

  it('les DEUX nouveaux symboles atteignent `dist` — dès que `dist` est postérieur à `src`', () => {
    if (!existsSync(DIST_INDEX)) return;
    const distAge = statSync(DIST_INDEX).mtimeMs;
    const newestSource = Math.max(
      statSync(join(CONTRACTS, 'src', 'security', 'direct-grant-failure.ts')).mtimeMs,
      statSync(join(CONTRACTS, 'src', 'security', 'mfa-enrolment-policy.ts')).mtimeMs,
      statSync(SECURITY_BARREL).mtimeMs,
    );
    if (distAge < newestSource) {
      // ÉTAT NOMMÉ, PAS UNE TOLÉRANCE MUETTE : `dist` est ANTÉRIEUR aux sources
      // de cette tranche, donc il ne PEUT pas les porter, et aucun agent n'a le
      // droit de construire (GUARDRAILS §4). Ce que l'on affirme dans cet état
      // est autre chose, et c'est VRAI : la chaîne d'entrée est complète.
      // Dès que l'orchestrateur construit, `dist` devient postérieur et cette
      // assertion MORD, définitivement.
      console.warn(
        'auth-failure-classification-gate — dist/index.js ANTÉRIEUR aux sources de S-E05-8 ' +
          `(dist=${new Date(distAge).toISOString()}, src=${new Date(newestSource).toISOString()}). ` +
          'Pré-requis de LAND, non exécuté par un agent : pnpm --filter @pilotage/contracts build. ' +
          'apps/web résout `main` → dist/index.js : sans ce build, la page de connexion ne charge pas.',
      );
      expect(distAge).toBeLessThan(newestSource);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dist = require(DIST_INDEX) as Record<string, unknown>;
    expect(typeof dist.classifyDirectGrantFailure).toBe('function');
    expect(typeof dist.mfaRequiredByInvitePolicy).toBe('function');
    expect(typeof dist.isMfaEnrolledRealmRole).toBe('function');
    expect(Array.isArray(dist.DIRECT_GRANT_FAILURE_CODES)).toBe(true);
    expect(dist.__deliberatelyNotExportedFromContracts).toBeUndefined();
  });
});

/* ================================================================== *
 * 5. G-AUTHZ (AC-12) — aucun chemin ne devient PLUS permissif
 * ================================================================== */

describe('auth-failure-classification gate — G-AUTHZ (AC-12)', () => {
  it('le contrôle de rôle realm du chemin de SUCCÈS est INTACT dans `auth.ts`', () => {
    const code = stripComments(named(AUTH_TS));
    // La couture qui décide `wrong_portal` APRÈS un jeton émis. Elle n'entre pas
    // dans l'union (son entrée n'est pas une réponse d'échec) et n'est pas
    // touchée : c'est ce qui rend la tranche monotone dans le sens sûr.
    expect(code).toContain('REALM_ROLES_FOR_PORTAL');
    expect(code).toContain("'wrong_portal'");
  });

  it('la taxonomie n’a AUCUN membre « autoriser » — un échec ne devient jamais un succès', () => {
    for (const code of CANONICAL_CODES) {
      expect(code).not.toMatch(/allow|grant|success|bypass/i);
    }
    // …et le classifieur ne rend RIEN d'autre que ces membres (prouvé par la
    // totalité exécutée dans `direct-grant-failure.spec.ts`, groupe 8).
    expect(CANONICAL_CODES).toHaveLength(3);
  });

  it('aucun interrupteur d’environnement dans les deux foyers (DNC-10)', () => {
    for (const source of [CLASSIFIER_SOURCE, POLICY_SOURCE]) {
      const code = stripComments(source);
      for (const token of ['process.env', 'NODE_ENV', 'SKIP_', 'ALLOW_', 'BYPASS']) {
        expect(`${token}: ${code.includes(token)}`).toBe(`${token}: false`);
      }
    }
  });
});
