import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-3 / PF-12 / ADR-072 — LE CLIQUET : plus aucune surface ne RE-DÉRIVE
 * « cet enfant est-il activement inscrit ? ».
 *
 * LES TROIS RÈGLES, EN UNE LIGNE CHACUNE
 * --------------------------------------
 * Hors du module qui DÉCLARE `selectActiveEnrollment`, est un contrevenant :
 *
 *   R1 — un tableau d'inscriptions INDEXÉ `[0]` : `<expr>.enrollments[0]`.
 *        L'index affirme une activité que rien dans la requête ne garantit —
 *        c'est la forme qui rendait une inscription `graduated` derrière un
 *        badge « Inscription active » en vert (`children/[id]/page.tsx:343`).
 *
 *   R2 — un `.find()` / `.filter()` / `.some()` sur des inscriptions dont le
 *        prédicat teste `… .status === 'active'`. Deux variantes existaient et
 *        les DEUX tombent : `e.status === 'active'` (la colonne `Enrollment`) et
 *        `e.academicYear.status === 'active'` (une colonne INDÉPENDANTE — c'est
 *        l'axe 1 de PF-12).
 *
 *   R3 — une lecture Prisma d'inscriptions ANCRÉE SUR L'ÉLÈVE dont le `where`
 *        épelle `status: 'active'` en littéral au lieu d'importer le prédicat
 *        canonique.
 *
 * POURQUOI R3 DIT « ANCRÉE SUR L'ÉLÈVE », ET POURQUOI C'EST LOAD-BEARING
 * ----------------------------------------------------------------------
 * La relation `enrollments` existe sur `Student`, sur `ClassSection` et sur
 * `AcademicYear`. Une règle énoncée sur « toute lecture d'inscriptions »
 * attraperait ~19 filtres d'APPARTENANCE ancrés sur la SECTION
 * (`_count` / `some` / `none` sur `ClassSection.enrollments`) qui ne posent PAS
 * la question de cette tranche : ils comptent un effectif, ils n'affirment pas
 * l'activité d'UN enfant. Les rabattre ici ne laisserait que les trois sorties
 * que `academic-year-resolution-gate.spec.ts:20-32` nomme et interdit — une
 * allowlist, une conversion hors périmètre, ou relâcher la règle jusqu'à ce
 * qu'elle passe (R-30).
 *
 * L'ANCRAGE est donc STRUCTUREL, jamais nominatif : le modèle Prisma sur lequel
 * l'appel est écrit décide. `prisma.student.findMany({ include: { enrollments:
 * { where: … } } })` est ancré sur l'élève ; `prisma.classSection.findMany({
 * include: { _count: { select: { enrollments: true } } } })` ne l'est pas. Une
 * lecture DIRECTE `prisma.enrollment.findFirst` est ancrée sur l'élève si et
 * seulement si son `where` porte `studentId`.
 *
 * ⚠ CE QUE CETTE FORMULATION PROTÈGE, ET CE N'EST PAS UN EFFET DE BORD
 * --------------------------------------------------------------------
 * `students/student-access.service.ts` lit les inscriptions par
 * `classSectionId: { in: … }`, SANS `studentId` : il est donc EXCLU PAR
 * L'ÉNONCÉ MÊME de la règle, pas par une exception. C'est délibéré et c'est
 * une condition d'arrêt de la story : son docblock DÉCIDE « NO academic-year
 * clause » (ADR-063 §D1) et « `status:'active'` ONLY, deliberately and at a
 * stated cost » (ADR-066 §D1). Y importer le prédicat canonique ajouterait la
 * clause d'année, donc RÉTRÉCIRAIT le périmètre enseignant : ce serait une
 * modification d'AUTORISATION. Un test plus bas assied que ce fichier PASSE, et
 * un autre qu'il n'importe pas le prédicat.
 *
 * DEUX RÈGLES DE PORTÉE, ET POURQUOI DEUX (ADR-072 §A5)
 * -----------------------------------------------------
 * Mesuré sur HEAD avant conversion : 34 contraventions. La tranche en supprime
 * 20 ; 14 subsistent, toutes hors du périmètre déclaré (admin et lectures API
 * de routage). Une règle unique à tolérance zéro sur les quatre racines aurait
 * exigé de convertir ces 14 sites — donc soit une allowlist, soit une conversion
 * hors périmètre, soit un relâchement : les trois sorties interdites. La portée
 * est donc DÉCLARÉE, jamais relâchée :
 *
 *   RÈGLE A — TOLÉRANCE ZÉRO sur le portail PARENT et sur les projections
 *             serveur que la tranche convertit. C'est la CLASSE que ce cliquet
 *             ferme : « aucune surface parent ne re-dérive l'activité
 *             d'inscription ». Pas la classe globale, et ADR-072 / OPEN.md /
 *             PROGRESS.md disent exactement cela.
 *
 *   RÈGLE B — PLAFOND DÉCROISSANT sur les QUATRE racines. Le nombre de
 *             re-dérivations hors du module déclarant est épinglé et ne peut que
 *             baisser. C'est la convention maison (`lint-ratchet.spec.ts`,
 *             `test-ratchet.spec.ts`), donc AUCUNE décision d'architecture
 *             nouvelle. Les 14 sites restants sont enregistrés comme résiduels,
 *             pas allowlistés : un plafond n'exempte personne, il interdit la
 *             récidive.
 *
 * L'INVENTAIRE EST DÉRIVÉ PAR MARCHE, JAMAIS ÉNUMÉRÉ (ADR-064 §D1a)
 * -----------------------------------------------------------------
 * Quatre racines : `apps/api/src`, `apps/worker/src`, `apps/web/src` et
 * `packages/<paquet>/src`. `apps/web/src` EST une racine parce que la moitié des
 * sites mesurés y vivaient — le cliquet LIT ces fichiers comme du texte/AST
 * depuis l'arbre de test de l'API, il ne les IMPORTE pas, donc aucun problème de
 * `rootDir`/TS6059 (et `apps/web` n'a de toute façon aucun runner unitaire).
 *
 * `.tsx` EST PARSÉ EN `ScriptKind.TSX` — LE PIÈGE À COÛT NUL SI CONNU D'AVANCE
 * ----------------------------------------------------------------------------
 * Les sites web sont du JSX. Parsés en `.ts`, les chevrons deviennent des
 * assertions de type : le parse casse ou, pire, réussit SILENCIEUSEMENT en
 * produisant un arbre vide — un cliquet vacueux au-dessus de la moitié du
 * défaut. Le contrôle négatif porte donc une fixture `.tsx`, sinon il ne prouve
 * RIEN pour la racine web.
 *
 * PLANCHER DE VACUITÉ PAR RACINE + PLANCHER DE RECONNAISSANCE
 * -----------------------------------------------------------
 * `apps/web/src` compte des centaines de fichiers, la racine des paquets beaucoup
 * moins : un plancher GLOBAL resterait satisfait par la racine web seule pendant
 * qu'une autre disparaîtrait de la marche. Et zéro contravention sur zéro
 * RECONNAISSANCE ne prouve rien : le cliquet exige aussi de VOIR encore un
 * nombre plancher de constructions d'inscription.
 *
 * LE FOYER EST RECONNU PAR CONSTRUCTION
 * -------------------------------------
 * Le seul site légitime n'est pas nommé dans une exception : c'est le fichier
 * qui DÉCLARE `selectActiveEnrollment`, trouvé par la même marche. Le cliquet
 * exige qu'il y en ait EXACTEMENT UN — zéro signifierait que le contrat a
 * disparu et que le cliquet est décoratif, deux que la canonicalisation a déjà
 * re-divergé.
 *
 * `MANUAL_ALLOWLIST` existe, est nommée, et EXPÉDIE VIDE — une assertion le
 * vérifie. Aucune variable d'environnement, aucun `NODE_ENV`, aucun `SKIP_*` /
 * `ALLOW_*` (DNC-10). Les helpers requis le sont SANS garde : s'ils
 * s'évaporent, cette suite doit mourir au CHARGEMENT plutôt que dégénérer en
 * « rien à vérifier » (DNC-08).
 *
 * LES FIXTURES N'EMBARQUENT AUCUN NOM RÉEL (PF-295)
 * --------------------------------------------------
 * Le classifieur reçoit les noms de modèle/relation EN PARAMÈTRE ; les fixtures
 * emploient `fixtureSignup` / `fixtureSignups`, absents du produit.
 *
 * CE QUE CE CLIQUET NE PROUVE PAS
 * -------------------------------
 * 1. Il prouve une FORME — plus aucune surface parent ne re-dérive. Il ne prouve
 *    PAS que les projections serveur S'ACCORDENT : cela est porté, et de façon
 *    EXÉCUTÉE, par `la section S-E03-3 de
 *    `apps/api/src/modules/analytics/parent-grade-projection-agreement.spec.ts``. Deux
 *    affirmations distinctes, deux mécanismes distincts ; les confondre serait
 *    exactement le `DNC-06` que les deux tranches précédentes se sont chacune
 *    surprises à commettre.
 * 2. Il ne couvre PAS la famille ancrée sur la SECTION, par l'énoncé même de la
 *    règle (voir plus haut). Un test plus bas assied que cette famille EXISTE
 *    TOUJOURS, pour qu'on ne puisse pas la déclarer fermée par inadvertance.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/** Les noms jugés. INJECTÉS dans le classifieur (PF-295). */
const NAMES = {
  /** La relation, telle qu'elle est écrite dans le schéma. */
  relation: 'enrollments',
  /** Le modèle Prisma, pour les lectures DIRECTES. */
  model: 'enrollment',
  /** Le modèle qui ANCRE la question sur un enfant. */
  anchorModel: 'student',
  /** La colonne qui ancre une lecture directe sur un enfant. */
  anchorColumn: 'studentId',
  /** La valeur de statut jugée. */
  active: 'active',
} as const;

/** La fonction qui DÉFINIT le foyer légitime. */
const SELECTOR_FUNCTION = 'selectActiveEnrollment';

/** Le foyer attendu — assis, jamais utilisé comme exemption. */
const EXPECTED_HOME = 'packages/contracts/src/enrollment/select-active-enrollment.ts';

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

/**
 * Les clés qui font d'une clause `enrollments` un filtre d'APPARTENANCE plutôt
 * qu'une réponse sur UN enfant. Exclues par l'énoncé de la règle.
 */
const MEMBERSHIP_KEYS: ReadonlySet<string> = new Set(['_count', 'some', 'none', 'every']);

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
 * LA MARCHE — quatre racines, plancher PAR RACINE
 * ================================================================== */

/**
 * Les specs sont HORS corpus : elles portent des fakes et des fixtures
 * délibérément contrevenantes — dont celles de ce fichier. Les juger produirait
 * un auto-rouge qu'on « corrigerait » par une exclusion, c'est-à-dire par une
 * allowlist déguisée.
 */
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

/** Les `src` de TOUS les paquets — découverts, pas listés. */
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
const WEB_FILES = walkSources(WEB_SRC).sort();
const PACKAGE_FILES = walkPackages().sort();
const ALL_FILES = [...API_FILES, ...WORKER_FILES, ...WEB_FILES, ...PACKAGE_FILES];

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/**
 * Planchers PAR RACINE, jamais des égalités (convention maison : tout plancher
 * est `>=`). Mesurés sur cet arbre : 170 / 61 / 378 / 115 fichiers hors specs.
 */
const MIN_API_FILES = 150;
const MIN_WORKER_FILES = 50;
const MIN_WEB_FILES = 300;
const MIN_PACKAGE_FILES = 90;

/**
 * Plancher de RECONNAISSANCE : combien de CONSTRUCTIONS d'inscription la marche
 * doit encore VOIR, contrevenantes ou non. Zéro contravention sur zéro
 * reconnaissance ne prouve rien. Mesuré après conversion : 79.
 */
const MIN_RECOGNISED_SITES = 55;

/* ================================================================== *
 * LE CLASSIFIEUR — tous les noms sont INJECTÉS (PF-295)
 * ================================================================== */

type Names = {
  relation: string;
  model: string;
  anchorModel: string;
  anchorColumn: string;
  active: string;
};

type RuleId = 'R1-index-zero' | 'R2-status-predicate' | 'R3-anchored-literal-read';

type Finding = { rule: RuleId; line: number; detail: string };

/** Tout ce que la marche RECONNAÎT comme construction d'inscription. */
type FileFacts = {
  source: string;
  findings: Finding[];
  recognised: number;
  declaresSelector: boolean;
  /** `true` ⇔ une clause `enrollments` ancrée sur la SECTION est présente. */
  hasMembershipFamily: boolean;
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

/** `status: 'active'`, `status: X.active` ou `status: 'active' as const`, à toute profondeur. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function constrainsStatusToActive(node: any, active: string): boolean {
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : undefined;
      if (key === 'status') {
        let value = n.initializer;
        // `'active' as const` / `'active' as EnrollmentStatus`.
        while (value && ts.isAsExpression(value)) value = value.expression;
        if (value && ts.isStringLiteral(value) && value.text === active) {
          found = true;
          return;
        }
        if (value && ts.isPropertyAccessExpression(value) && value.name.text === active) {
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

/** `<quelque chose>.status === 'active'` quelque part dans un prédicat. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function testsStatusEqualsActive(node: any, active: string): boolean {
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
    ) {
      const sides = [
        [n.left, n.right],
        [n.right, n.left],
      ];
      for (const pair of sides) {
        const accessor = pair[0];
        const literal = pair[1];
        if (
          ts.isPropertyAccessExpression(accessor) &&
          accessor.name.text === 'status' &&
          ts.isStringLiteral(literal) &&
          literal.text === active
        ) {
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

/**
 * Recense, pour UN fichier, chaque construction d'inscription et chaque
 * contravention. `names` est un PARAMÈTRE : c'est ce qui permet aux fixtures
 * d'employer des noms absents du produit (PF-295).
 */
function classify(path: string, source: string, names: Names): FileFacts {
  const scriptKind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const findings: Finding[] = [];
  let recognised = 0;
  let declaresSelector = false;
  let hasMembershipFamily = false;

  const lineOf = (n: { getStart: (s: unknown) => number }): number =>
    (sf.getLineAndCharacterOfPosition(n.getStart(sf)).line as number) + 1;

  /**
   * Le modèle Prisma de l'appel EN COURS, et si la position courante se trouve
   * sous une clé d'APPARTENANCE (`_count` / `some` / `none` / `every`). Ces deux
   * faits, et eux seuls, décident si une clause `enrollments` pose la question de
   * cette tranche. L'ancrage est STRUCTUREL, jamais nominatif.
   */
  let enclosingModel: string | null = null;
  let underMembership = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    // ── Les clauses `enrollments: …`, jugées selon leur ANCRAGE ───────────
    if (ts.isPropertyAssignment(node)) {
      const key =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;

      if (key === names.relation) {
        recognised += 1;
        const where = memberOf(node.initializer, 'where');
        const filtersActive =
          where !== undefined && constrainsStatusToActive(where, names.active);
        const anchoredOnPupil = enclosingModel === names.anchorModel && !underMembership;

        if (underMembership || enclosingModel !== names.anchorModel) {
          // Appartenance (`_count`/`some`/`none`) ou relation portée par un AUTRE
          // modèle (`ClassSection`, `AcademicYear`) : hors de l'énoncé de R3.
          if (filtersActive || underMembership) hasMembershipFamily = true;
        } else if (anchoredOnPupil && filtersActive) {
          findings.push({
            rule: 'R3-anchored-literal-read',
            line: lineOf(node),
            detail: `${names.anchorModel}.<read>({ … ${names.relation}: { where: { status: '${names.active}' } } })`,
          });
        }
      }

      if (key !== undefined && MEMBERSHIP_KEYS.has(key)) {
        const previous = underMembership;
        underMembership = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ts.forEachChild(node, (child: any) => visit(child));
        underMembership = previous;
        return;
      }
    }
    // ── Le foyer, reconnu PAR CONSTRUCTION ────────────────────────────────
    if (ts.isFunctionDeclaration(node) && node.name && node.name.text === SELECTOR_FUNCTION) {
      declaresSelector = true;
    }

    // ── R1 — `<expr>.enrollments[0]` ──────────────────────────────────────
    if (ts.isElementAccessExpression(node)) {
      const receiver = node.expression;
      const isEnrollmentsShaped =
        (ts.isPropertyAccessExpression(receiver) && receiver.name.text === names.relation) ||
        (ts.isIdentifier(receiver) && receiver.text === names.relation);
      if (isEnrollmentsShaped) {
        recognised += 1;
        const argument = node.argumentExpression;
        if (argument && ts.isNumericLiteral(argument) && argument.text === '0') {
          findings.push({
            rule: 'R1-index-zero',
            line: lineOf(node),
            detail: `${names.relation}[0] — un index qui AFFIRME une activité`,
          });
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text as string;
      const receiver = node.expression.expression;

      // ── R2 — `.find/.filter/.some` sur des inscriptions ─────────────────
      if (method === 'find' || method === 'filter' || method === 'some' || method === 'findLast') {
        const receiverText = receiver.getText(sf) as string;
        if (receiverText.includes(names.relation)) {
          recognised += 1;
          const predicate = node.arguments[0];
          if (predicate && testsStatusEqualsActive(predicate, names.active)) {
            findings.push({
              rule: 'R2-status-predicate',
              line: lineOf(node),
              detail: `.${method}(… .status === '${names.active}') sur des inscriptions`,
            });
          }
        }
      }

      // ── R3 — les lectures Prisma ────────────────────────────────────────
      if (ts.isPropertyAccessExpression(receiver) && READ_OPERATIONS.has(method)) {
        const model = receiver.name.text as string;
        const args = node.arguments[0];

        // Lecture DIRECTE : ancrée sur l'élève ⇔ le `where` porte `studentId`.
        if (model === names.model) {
          recognised += 1;
          const where = memberOf(args, 'where');
          const anchored = where !== undefined && memberOf(where, names.anchorColumn) !== undefined;
          if (anchored && constrainsStatusToActive(where, names.active)) {
            findings.push({
              rule: 'R3-anchored-literal-read',
              line: lineOf(node),
              detail: `${names.model}.${method}({ where: { ${names.anchorColumn}, status: '${names.active}' } })`,
            });
          } else if (where !== undefined && !anchored) {
            hasMembershipFamily = hasMembershipFamily || constrainsStatusToActive(where, names.active);
          }
        }

        // Lecture ANCRÉE : `student.<read>({ include/select: { enrollments … } })`.
        // Le modèle est POUSSÉ pour la durée de la descente : c'est lui qui
        // décide de l'ancrage des clauses `enrollments` rencontrées dessous.
        const previousModel = enclosingModel;
        enclosingModel = model;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ts.forEachChild(node, (child: any) => visit(child));
        enclosingModel = previousModel;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { source, findings, recognised, declaresSelector, hasMembershipFamily };
}

/* ================================================================== *
 * L'EXÉCUTION SUR L'ARBRE RÉEL
 * ================================================================== */

const { entries, skipped } = walkRead.mapWalkedFiles<FileFacts>(ALL_FILES, (path, source) => [
  rel(path),
  classify(path, source, NAMES),
]);
const CLASSIFIED = new Map(entries);
walkRead.warnSkipped('enrollment-activity-derivation-gate', skipped);

const SELECTOR_HOMES = [...CLASSIFIED.entries()]
  .filter(([, facts]) => facts.declaresSelector)
  .map(([file]) => file);

type Site = Finding & { file: string };

const ALL_FINDINGS: Site[] = [...CLASSIFIED.entries()].flatMap(([file, facts]) =>
  facts.findings.map((finding) => ({ ...finding, file })),
);

const RECOGNISED_SITES = [...CLASSIFIED.values()].reduce((sum, f) => sum + f.recognised, 0);

/**
 * L'allowlist manuelle. Elle existe, elle est nommée, et elle EXPÉDIE VIDE —
 * une assertion le vérifie plus bas. Le foyer légitime est DÉRIVÉ (le fichier
 * qui déclare le sélecteur), jamais énuméré.
 */
const MANUAL_ALLOWLIST: ReadonlyArray<{ file: string; line: number }> = [];

const OFFENDERS: Site[] = ALL_FINDINGS.filter(
  (site) =>
    !SELECTOR_HOMES.includes(site.file) &&
    !MANUAL_ALLOWLIST.some((a) => a.file === site.file && a.line === site.line),
);

/**
 * RÈGLE A — les préfixes de chemin à TOLÉRANCE ZÉRO. Des PRÉFIXES, donc dérivés
 * de l'arborescence, jamais une liste de fichiers : le portail parent tout
 * entier, plus les modules dont cette tranche convertit les projections.
 *
 * `apps/api/src/modules/students/` inclut `student-access.service.ts` — et c'est
 * voulu : ce fichier PASSE parce que sa lecture est ancrée sur la SECTION, donc
 * exclue par l'ÉNONCÉ de R3, pas par une exception. Voir le docblock.
 */
const RULE_A_PREFIXES: readonly string[] = [
  'apps/web/src/app/parent/',
  'apps/api/src/modules/analytics/',
  'apps/api/src/modules/students/',
  'apps/api/src/modules/alerts/rules/',
  'apps/api/src/modules/alerts/meeting-requests.service.ts',
  'apps/worker/src/modules/alerts-rules/',
];

const RULE_A_OFFENDERS = OFFENDERS.filter((site) =>
  RULE_A_PREFIXES.some((prefix) => site.file.startsWith(prefix)),
);

/**
 * RÈGLE B — le PLAFOND DÉCROISSANT sur les quatre racines. Mesuré au land de
 * S-E03-3 : 14 re-dérivations subsistent hors du module déclarant (3 `[0]` et
 * 2 prédicats côté admin, 9 lectures ancrées côté API). Elles sont
 * ENREGISTRÉES comme résiduels, jamais allowlistées.
 *
 * ⚠ Ce nombre ne peut que BAISSER. Le faire remonter pour « faire passer » un
 * diff est exactement ce que `academic-year-resolution-gate.spec.ts:20-32`
 * interdit (R-30). Quand il baisse, on l'abaisse ICI, dans le même commit que la
 * conversion, avec la ligne de registre correspondante.
 */
const RULE_B_CEILING = 14;

const describeSite = (s: Site) => `${s.file}:${s.line} — [${s.rule}] ${s.detail}`;

/* ================================================================== *
 * LE CORPUS EST BIEN LE CORPUS — les garde-fous de vacuité
 * ================================================================== */

describe('la dérivation n’est pas vacante', () => {
  it('a marché `apps/api/src` — plancher PAR RACINE', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(MIN_API_FILES);
  });

  it('a marché `apps/worker/src` — la copie jumelle de la règle HIGH_ABSENCE y vit', () => {
    expect(WORKER_FILES.length).toBeGreaterThanOrEqual(MIN_WORKER_FILES);
  });

  it('a marché `apps/web/src` — NEUF des treize sites y vivaient', () => {
    expect(WEB_FILES.length).toBeGreaterThanOrEqual(MIN_WEB_FILES);
  });

  it('a marché `packages/*/src` — la racine qui héberge le module déclarant', () => {
    expect(PACKAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
  });

  it('a bien parsé du TSX — sinon la moitié du défaut serait invisible', () => {
    // Un `.tsx` parsé en `.ts` produit un arbre vide ou cassé. On exige donc que
    // la marche VOIE des `.tsx`, et le contrôle négatif plus bas en fait FEU sur
    // une fixture `.tsx` : les deux ensemble ferment le piège.
    expect(WEB_FILES.filter((f) => f.endsWith('.tsx')).length).toBeGreaterThanOrEqual(100);
  });

  it("porte l'identité comptable — un plancher sur la LISTE ne se transporte pas sur la CARTE", () => {
    expect(CLASSIFIED.size + skipped.length).toBe(ALL_FILES.length);
  });

  it("n'a pas perdu plus que le budget calibré sur la taille du corpus", () => {
    expect(skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(ALL_FILES.length));
  });

  it('a RECONNU des constructions d’inscription — zéro contravention sur zéro reconnaissance ne prouve rien', () => {
    expect(RECOGNISED_SITES).toBeGreaterThanOrEqual(MIN_RECOGNISED_SITES);
  });

  it('a trouvé EXACTEMENT UN foyer déclarant, reconnu par construction', () => {
    // Zéro ⇒ le contrat a disparu et le cliquet est décoratif.
    // Deux ⇒ la canonicalisation a déjà re-divergé.
    expect(SELECTOR_HOMES).toHaveLength(1);
    expect(SELECTOR_HOMES[0]).toBe(EXPECTED_HOME);
  });

  it('voit encore la famille ANCRÉE SUR LA SECTION — résidu mesuré, pas oublié', () => {
    // Exclue par l'ÉNONCÉ de la règle, jamais par une exception. Si ce compte
    // tombait à zéro, la famille aurait été convertie et ce test devrait être
    // retiré AVEC sa ligne de registre — pas « corrigé » en abaissant le plancher.
    const family = [...CLASSIFIED.entries()]
      .filter(([, facts]) => facts.hasMembershipFamily)
      .map(([file]) => file);
    expect(family.length).toBeGreaterThanOrEqual(5);
  });
});

/* ================================================================== *
 * RÈGLE A — TOLÉRANCE ZÉRO sur le parent et les projections converties
 * ================================================================== */

describe('AC-4 RÈGLE A — aucune surface parent (ni projection convertie) ne re-dérive l’activité', () => {
  it('zéro contrevenant sur les préfixes à tolérance zéro', () => {
    // Le message porte le SITE (`file:line`) et la RÈGLE, jamais un simple compte.
    expect(RULE_A_OFFENDERS.map(describeSite)).toEqual([]);
  });

  it("l'allowlist manuelle expédie VIDE — le foyer est DÉRIVÉ, pas énuméré", () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
  });

  it('les fichiers convertis sont TOUJOURS VUS par la marche — un vert par disparition n’en est pas un', () => {
    // Cette liste ne pilote AUCUNE exemption : elle refuse un vert obtenu parce
    // que la marche aurait cessé de voir ces fichiers.
    const converted = [
      'apps/api/src/modules/analytics/analytics.service.ts',
      'apps/api/src/modules/students/students.controller.ts',
      'apps/api/src/modules/alerts/meeting-requests.service.ts',
      'apps/api/src/modules/alerts/rules/high-absence.rule.ts',
      'apps/worker/src/modules/alerts-rules/high-absence.rule.ts',
    ];
    for (const file of converted) {
      expect(CLASSIFIED.has(file)).toBe(true);
      expect(ALL_FINDINGS.filter((s) => s.file === file)).toEqual([]);
    }
  });

  it('le portail PARENT est réellement dans le corpus — sinon la Règle A est vacante', () => {
    const parentFiles = [...CLASSIFIED.keys()].filter((f) =>
      f.startsWith('apps/web/src/app/parent/'),
    );
    expect(parentFiles.length).toBeGreaterThanOrEqual(15);
  });
});

/* ================================================================== *
 * RÈGLE B — le plafond décroissant sur les quatre racines
 * ================================================================== */

describe('AC-4 RÈGLE B — le nombre de re-dérivations hors du module déclarant ne peut que BAISSER', () => {
  it(`reste sous le plafond épinglé (${RULE_B_CEILING})`, () => {
    // En cas de DÉPASSEMENT, la sortie NOMME chaque site : un plafond qui ne
    // rend qu'un nombre n'est pas actionnable. L'assertion vide ci-dessous n'est
    // atteinte QUE sur dépassement, et échoue alors en imprimant la liste.
    if (OFFENDERS.length > RULE_B_CEILING) {
      expect(OFFENDERS.map(describeSite)).toEqual([]);
    }
    expect(OFFENDERS.length).toBeLessThanOrEqual(RULE_B_CEILING);
  });

  it('le plafond a bien BAISSÉ — la tranche a retiré des re-dérivations, pas seulement épinglé', () => {
    // 34 contraventions mesurées sur HEAD avant conversion. Un plafond posé au
    // niveau d'AVANT serait un commentaire, pas un cliquet.
    const MEASURED_BEFORE_CONVERSION = 34;
    expect(RULE_B_CEILING).toBeLessThan(MEASURED_BEFORE_CONVERSION);
  });
});

/* ================================================================== *
 * LA FRONTIÈRE D'AUTORISATION — elle n'est PAS franchie (STOP condition)
 * ================================================================== */

describe('le prédicat d’AFFICHAGE ne franchit pas la frontière d’AUTORISATION', () => {
  const ACCESS_SERVICE = 'apps/api/src/modules/students/student-access.service.ts';

  it('`student-access.service.ts` est dans le corpus et PASSE — exclu par l’ÉNONCÉ, pas par exception', () => {
    const facts = CLASSIFIED.get(ACCESS_SERVICE);
    expect(facts).toBeDefined();
    // Il LIT bien des inscriptions — sinon ce contrôle serait vide de sens…
    expect(facts!.recognised).toBeGreaterThanOrEqual(1);
    // …et il n'est pourtant pas un contrevenant : sa lecture est ancrée sur la
    // SECTION (`classSectionId: { in: … }`), sans `studentId`.
    expect(facts!.findings).toEqual([]);
  });

  it('`student-access.service.ts` n’importe PAS le prédicat canonique (ADR-063 §D1 / ADR-066 §D1)', () => {
    // Y importer le prédicat ajouterait la clause d'année et RÉTRÉCIRAIT le
    // périmètre enseignant : une modification d'autorisation, interdite par la
    // story (§8). Assertion de GRAPHE D'IMPORT, pas de forme.
    const facts = CLASSIFIED.get(ACCESS_SERVICE);
    expect(facts).toBeDefined();
    expect(facts!.source).not.toContain(SELECTOR_FUNCTION);
    expect(facts!.source).not.toContain('activeEnrollmentWhere');
    expect(facts!.source).not.toContain('candidateEnrollmentWhere');
  });

  it('aucun guard ni aucune stratégie n’importe le prédicat', () => {
    const guards = [...CLASSIFIED.entries()].filter(
      ([file]) => file.includes('.guard.') || file.includes('.strategy.'),
    );
    expect(guards.length).toBeGreaterThanOrEqual(3);
    for (const [file, facts] of guards) {
      expect({ file, uses: facts.source.includes(SELECTOR_FUNCTION) }).toEqual({
        file,
        uses: false,
      });
    }
  });
});

/* ================================================================== *
 * DNC-10 — rien ne peut désarmer ce cliquet
 * ================================================================== */

describe('DNC-10 — aucun interrupteur', () => {
  it('aucun `SKIP_*` / `ALLOW_*` / `NODE_ENV` ne peut désarmer ce cliquet', () => {
    const SELF = readFileSync(
      join(__dirname, 'enrollment-activity-derivation-gate.spec.ts'),
      'utf8',
    );
    // Un `SKIP_…` ne désarme quoi que ce soit qu'en étant LU dans
    // l'environnement : c'est donc la LECTURE qu'on interdit, pas les noms — qui
    // apparaissent en prose juste au-dessus. Les motifs sont CONCATÉNÉS : écrits
    // en toutes lettres ils s'apparieraient eux-mêmes (PF-295).
    for (const needle of ['pro' + 'cess.env', "require('node:pro" + "cess')"]) {
      expect(SELF).not.toContain(needle);
    }
  });
});

/* ================================================================== *
 * CONTRÔLE NÉGATIF — modèles SYNTHÉTIQUES (PF-295), .ts ET .tsx
 * ================================================================== */

const FIXTURE_NAMES: Names = {
  relation: 'fixtureSignups',
  model: 'fixtureSignup',
  anchorModel: 'fixturePupil',
  anchorColumn: 'fixturePupilId',
  active: 'active',
};

const FIXTURE_TS = join(API_SRC, 'modules', '__fixture', 'fixture.service.ts');
const FIXTURE_TSX = join(WEB_SRC, 'app', '__fixture', 'fixture-page.tsx');

/** Toute source de fixture est CONCATÉNÉE, jamais écrite en un littéral unique. */
const fixture = (...lines: string[]) => [...lines, ''].join('\n');

const runTs = (source: string) => classify(FIXTURE_TS, source, FIXTURE_NAMES).findings;
const runTsx = (source: string) => classify(FIXTURE_TSX, source, FIXTURE_NAMES).findings;

describe('CONTRÔLE NÉGATIF — les formes contrevenantes DOIVENT être signalées', () => {
  it('R1 — `<expr>.<relation>[0]` derrière un badge (la forme du dashboard parent)', () => {
    const findings = runTs(
      fixture(
        'export function classLabel(pupil: Pupil) {',
        `  return pupil.${FIXTURE_NAMES.relation}[0]?.classSection.name ?? null;`,
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R1-index-zero']);
  });

  it('R2 — `.find(e => e.status === "active")` sur des inscriptions', () => {
    const findings = runTs(
      fixture(
        'export function active(pupil: Pupil) {',
        `  return pupil.${FIXTURE_NAMES.relation}.find((e) => e.status === '${FIXTURE_NAMES.active}');`,
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R2-status-predicate']);
  });

  it('R2 — la variante sur la COLONNE INDÉPENDANTE `academicYear.status` tombe aussi', () => {
    // C'est l'axe 1 de PF-12 : le client re-filtrait sur une colonne que le
    // serveur n'avait jamais filtrée — et ne renvoyait même pas.
    const findings = runTs(
      fixture(
        'export function active(pupil: Pupil) {',
        `  return pupil.${FIXTURE_NAMES.relation}.find(`,
        `    (e) => e.academicYear.status === '${FIXTURE_NAMES.active}',`,
        '  );',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R2-status-predicate']);
  });

  it('R2/R1 — la forme COMPOSÉE `find(...) ?? rows[0]` signale les DEUX règles', () => {
    // C'est LE défaut mesuré (`children/[id]/page.tsx:185`) : un `find` qui
    // échoue puis un repli qui MENT. Les deux moitiés doivent tomber.
    const findings = runTs(
      fixture(
        'export function shown(pupil: Pupil) {',
        `  return pupil.${FIXTURE_NAMES.relation}.find((e) => e.status === '${FIXTURE_NAMES.active}')`,
        `    ?? pupil.${FIXTURE_NAMES.relation}[0];`,
        '}',
      ),
    );
    expect(new Set(findings.map((f) => f.rule))).toEqual(
      new Set(['R1-index-zero', 'R2-status-predicate']),
    );
  });

  it('R3 — la lecture ANCRÉE par relation : `pupil.<read>({ include: { <relation>: { where } } })`', () => {
    const findings = runTs(
      fixture(
        'export async function read(db: Db, id: string, tenantId: string) {',
        `  return db.${FIXTURE_NAMES.anchorModel}.findFirst({`,
        '    where: { id, tenantId },',
        '    include: {',
        `      ${FIXTURE_NAMES.relation}: { where: { status: '${FIXTURE_NAMES.active}' }, take: 1 },`,
        '    },',
        '  });',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R3-anchored-literal-read']);
  });

  it('R3 — la lecture DIRECTE ancrée sur l’élève tombe (`where` portant la colonne d’ancrage)', () => {
    const findings = runTs(
      fixture(
        'export async function read(db: Db, tenantId: string, pupilId: string) {',
        `  return db.${FIXTURE_NAMES.model}.findFirst({`,
        `    where: { tenantId, ${FIXTURE_NAMES.anchorColumn}: pupilId, status: '${FIXTURE_NAMES.active}' },`,
        '  });',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R3-anchored-literal-read']);
  });

  it('R3 — la forme ENUM `status: FixtureStatus.active` est aussi une contrainte', () => {
    const findings = runTs(
      fixture(
        'export async function read(db: Db, tenantId: string, pupilId: string) {',
        `  return db.${FIXTURE_NAMES.model}.findMany({`,
        `    where: { tenantId, ${FIXTURE_NAMES.anchorColumn}: pupilId, status: FixtureStatus.${FIXTURE_NAMES.active} },`,
        '  });',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R3-anchored-literal-read']);
  });

  it('R3 — la forme `as const` (celle qu’employait la file d’action) tombe', () => {
    const findings = runTs(
      fixture(
        'export async function read(db: Db, tenantId: string, pupilId: string) {',
        `  return db.${FIXTURE_NAMES.model}.findFirst({`,
        `    where: { tenantId, ${FIXTURE_NAMES.anchorColumn}: pupilId, status: '${FIXTURE_NAMES.active}' as const },`,
        '  });',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R3-anchored-literal-read']);
  });

  it('TSX — une fixture JSX contrevenante FAIT FEU (le piège du ScriptKind)', () => {
    // Sans ce cas, rien ne prouve que la racine `apps/web/src` est réellement
    // jugée : un `.tsx` parsé en `.ts` rend un arbre vide et un cliquet VERT.
    const findings = runTsx(
      fixture(
        'export function Badge({ pupil }: { pupil: Pupil }) {',
        `  const active = pupil.${FIXTURE_NAMES.relation}.find((e) => e.status === '${FIXTURE_NAMES.active}');`,
        '  return <span className="badge">{active ? "Inscription active" : "Inactif"}</span>;',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R2-status-predicate']);
  });
});

describe('CONTRÔLE POSITIF — sans lui, un comparateur toujours-rouge « prouverait » tout', () => {
  it('le filtre d’APPARTENANCE ancré sur la section passe — `_count` sur la relation', () => {
    const findings = runTs(
      fixture(
        'export async function roster(db: Db, tenantId: string) {',
        '  return db.fixtureSection.findMany({',
        '    where: { tenantId },',
        `    include: { _count: { select: { ${FIXTURE_NAMES.relation}: true } } },`,
        '  });',
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('le filtre `some` d’appartenance passe, MÊME sur un appel ancré sur l’élève', () => {
    // `students.controller.ts` filtre les élèves PAR section active : c'est une
    // question d'APPARTENANCE, pas d'activité individuelle. Si ce cas basculait
    // en contrevenant, la seule « réparation » serait une allowlist (R-30).
    const findings = runTs(
      fixture(
        'export async function inSection(db: Db, tenantId: string, sectionId: string) {',
        `  return db.${FIXTURE_NAMES.anchorModel}.findMany({`,
        '    where: {',
        '      tenantId,',
        `      ${FIXTURE_NAMES.relation}: { some: { classSectionId: sectionId, status: '${FIXTURE_NAMES.active}' } },`,
        '    },',
        '  });',
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('le filtre `none` (« non inscrits ») passe pour la même raison', () => {
    const findings = runTs(
      fixture(
        'export async function unenrolled(db: Db, tenantId: string, yearId: string) {',
        `  return db.${FIXTURE_NAMES.anchorModel}.findMany({`,
        '    where: {',
        '      tenantId,',
        `      ${FIXTURE_NAMES.relation}: { none: { academicYearId: yearId, status: '${FIXTURE_NAMES.active}' } },`,
        '    },',
        '  });',
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('la lecture ancrée sur la SECTION passe — le mur d’autorisation reste intact', () => {
    // La forme EXACTE de `student-access.service.ts` : pas de colonne d'ancrage
    // élève dans le `where`, donc hors de l'énoncé de R3.
    const findings = runTs(
      fixture(
        'export async function wall(db: Db, tenantId: string, sectionIds: string[]) {',
        `  return db.${FIXTURE_NAMES.model}.findMany({`,
        `    where: { tenantId, status: '${FIXTURE_NAMES.active}', classSectionId: { in: sectionIds } },`,
        `    select: { ${FIXTURE_NAMES.anchorColumn}: true },`,
        '  });',
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('LA FORME CONVERTIE passe — le `where` vient du contrat, l’ordre aussi', () => {
    const findings = runTs(
      fixture(
        'export async function read(db: Db, tenantId: string, id: string) {',
        `  return db.${FIXTURE_NAMES.anchorModel}.findFirst({`,
        '    where: { id, tenantId },',
        '    include: {',
        `      ${FIXTURE_NAMES.relation}: {`,
        '        where: candidateEnrollmentWhere({ tenantId }),',
        '        orderBy: enrollmentTotalOrder(),',
        '      },',
        '    },',
        '  });',
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('un index NON NUL (`[1]`, une pagination) n’est pas une affirmation d’activité', () => {
    const findings = runTs(
      fixture(
        'export function second(pupil: Pupil) {',
        `  return pupil.${FIXTURE_NAMES.relation}[1] ?? null;`,
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('un `.map()` sur des inscriptions (rendre l’HISTORIQUE) passe — c’est un consommateur légitime', () => {
    // `GET /students/:id` rend l'historique COMPLET et la fiche l'affiche : le
    // rendre n'est pas y répondre.
    const findings = runTs(
      fixture(
        'export function history(pupil: Pupil) {',
        `  return pupil.${FIXTURE_NAMES.relation}.map((e) => ({ id: e.id, status: e.status }));`,
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('LE MODULE RÉEL DU CONTRAT passe par le MÊME classifieur, sans exemption', () => {
    // Contrôle positif sur du code de PRODUCTION, pas sur une fixture : le module
    // canonique est lu depuis l'arbre et jugé par la règle elle-même. Il déclare
    // le sélecteur, donc il est reconnu PAR CONSTRUCTION, jamais nommé.
    const home = SELECTOR_HOMES[0] as string;
    const facts = CLASSIFIED.get(home);
    expect(facts).toBeDefined();
    expect(OFFENDERS.filter((s) => s.file === home)).toEqual([]);
  });
});
