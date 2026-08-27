import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-7 / PF-36 / ADR-079 — LE CLIQUET : plus aucun site ne RE-DÉRIVE
 * « combien d'élèves sont inscrits ici ? ».
 *
 * LES QUATRE RÈGLES, EN UNE LIGNE CHACUNE
 * ---------------------------------------
 * Hors du fichier qui DÉCLARE `rosterCountArg`, est un contrevenant :
 *
 *   R1 — un `_count … enrollments` NON FILTRÉ ancré sur la SECTION. C'est la
 *        VARIANTE A de l'audit : les SIX statuts comptés comme un effectif, donc
 *        un enfant `dropped` encore « dans la classe ». TOLÉRANCE ZÉRO — la
 *        tranche convertit les deux sites mesurés, il n'en reste aucun.
 *
 *   R2 — une SOMME CUMULATIVE d'effectifs (`+=`, `reduce(+)`). INTERDICTION
 *        TOTALE, sans plafond : c'est la forme qui produisait le « 46 » là où la
 *        vérité disait « 43 ». Un taux d'occupation qui veut légitimement sommer
 *        passe par `sumRosterSizes`, dont le TYPE dit que ce sont des PLACES.
 *
 *   R3 — un `where` de population écrit À LA MAIN (`status: 'active'`,
 *        `status: EnrollmentStatus.active`, `status: { in: [...] }` littéral)
 *        sur une lecture d'inscriptions ancrée sur la SECTION. PLAFOND
 *        DÉCROISSANT — c'est la convention maison (`lint-ratchet.spec.ts`,
 *        `test-ratchet.spec.ts`, `enrollment-activity-derivation-gate.spec.ts`),
 *        donc AUCUNE décision d'architecture nouvelle.
 *
 *   R4 — l'ÉNUM ne peut pas dériver : SEATED ∪ AWAITING ∪ {transferred_in} ∪
 *        EXIT doit valoir `enum EnrollmentStatus` lu dans `schema.prisma`, byte
 *        à byte. Un septième membre FAIT ROUGIR au lieu de se ranger en silence.
 *
 * POURQUOI R3 EST UN PLAFOND ET NON UNE TOLÉRANCE ZÉRO
 * ----------------------------------------------------
 * Mesuré sur HEAD avant conversion : 32 contraventions (2 × R1, 4 × R2,
 * 26 × R3). La tranche en supprime 18 ; 14 subsistent, et ce sont TOUTES des
 * GARDES ou des lectures hors périmètre déclaré. Une tolérance zéro globale
 * aurait exigé de les convertir — donc soit une allowlist, soit une conversion
 * hors périmètre, soit un relâchement : les trois sorties que
 * `academic-year-resolution-gate.spec.ts:20-32` nomme et INTERDIT (R-30).
 * Les 14 sites sont ENREGISTRÉS comme résiduels, jamais allowlistés : un plafond
 * n'exempte personne, il interdit la récidive.
 *
 * ⚠ LA FRONTIÈRE D'AUTORISATION N'EST PAS FRANCHIE — ET C'EST DIT ICI
 * -------------------------------------------------------------------
 * `students/student-access.service.ts:190` est l'un de ces 14. Il est COMPTÉ,
 * jamais exempté, et il ne sera PAS converti : son docblock DÉCIDE « NO
 * academic-year clause » (ADR-063 §D1) et « `status:'active'` ONLY, deliberately
 * and at a stated cost » (ADR-066 §D1). Y importer le module canonique
 * changerait la population OU la portée d'année du MUR D'AUTORISATION
 * enseignant — une modification d'AUTHZ déguisée en correction de comptage, que
 * GUARDRAILS §2 rend bloquante. Un test plus bas assied qu'il N'IMPORTE PAS le
 * module. Le compter sans le convertir est la seule posture honnête : il est
 * visible dans le plafond, donc personne ne peut croire la classe fermée.
 *
 * DE MÊME, LES GARDES D'ÉCRITURE SONT ÉPINGLÉES, PAS CONVERTIES (AC-9)
 * ---------------------------------------------------------------------
 * `enrollments.controller.ts` (deux gardes de capacité), `grades.controller.ts`
 * et `attendance.controller.ts` (deux gardes d'appartenance) décident QUI peut
 * être inscrit, noté, pointé. Leur delta de valeur n'est PAS mesurable ce run —
 * la base locale porte 0 inscription et Docker est à l'arrêt — donc l'AC-7
 * (« dire de quoi à quoi ») leur est INSATISFIABLE. Une garde qu'on ne peut pas
 * mesurer ne se change pas sur la foi d'un raisonnement.
 *
 * L'ANCRAGE EST STRUCTUREL, JAMAIS NOMINATIF — ET C'EST LE COMPLÉMENT EXACT
 * DE ADR-072
 * -------------------------------------------------------------------------
 * `enrollment-activity-derivation-gate.spec.ts:38-46` EXCLUT délibérément la
 * famille ancrée sur la SECTION : « ils comptent un effectif, ils n'affirment pas
 * l'activité d'UN enfant ». Cet ensemble exclu est EXACTEMENT celui que PF-36
 * occupe et que CE cliquet gouverne. Les deux PARTITIONNENT la surface de
 * lecture des inscriptions ; deux cliquets réclamant le même site voudraient
 * dire deux modules canoniques à importer, soit la dérive que l'épic ferme.
 *
 * L'ancrage se lit sur la PILE DE PROPRIÉTAIRES : le modèle Prisma de l'appel,
 * puis chaque clé de relation traversée (les clés STRUCTURELLES — `select`,
 * `include`, `where`, `_count`… — n'en sont pas). Le propriétaire le plus proche
 * d'une clause `enrollments` décide. `student.findMany({ include: { _count: {
 * select: { enrollments: true } } } })` est ancré sur l'ÉLÈVE ;
 * `assessment.findMany({ include: { teachingAssignment: { include: {
 * classSection: { select: { _count: { select: { enrollments } } } } } } } })`
 * est ancré sur la SECTION. Aucun nom de fichier n'intervient.
 *
 * ⚠ CONTRAINTE DE CONCEPTION VÉRIFIÉE EN SOURCE (AC-6)
 * -----------------------------------------------------
 * L'appel canonique DOIT être posé À la clause `enrollments:` —
 * `_count: { select: { enrollments: rosterCountArg(…) } }`. Le classifieur du
 * cliquet voisin (`enrollment-activity-derivation-gate.spec.ts`, `classify()`
 * lignes 384-405) reconnaît la famille d'appartenance par la PRÉSENCE de cette
 * clé sous `_count` ; la faire disparaître de l'AST (par un spread, par exemple)
 * ferait tomber son plancher `hasMembershipFamily >= 5` (test :638). Un test
 * plus bas assied que chaque fichier converti porte encore cette clé.
 *
 * PLANCHERS D'ANTI-VACUITÉ, ET POURQUOI PLUSIEURS
 * -----------------------------------------------
 * Plancher de fichiers PAR RACINE (un plancher global resterait satisfait par la
 * racine web seule pendant qu'une autre disparaîtrait), plancher de
 * RECONNAISSANCE (zéro contravention sur zéro reconnaissance ne prouve rien),
 * plancher de sites ancrés SECTION (la famille que ce cliquet gouverne doit
 * rester VISIBLE), TSX réellement parsé, et EXACTEMENT UN foyer déclarant.
 *
 * `MANUAL_ALLOWLIST` existe, est nommée, et EXPÉDIE VIDE — une assertion le
 * vérifie. Aucune variable d'environnement, aucun `NODE_ENV`, aucun `SKIP_*` /
 * `ALLOW_*` (DNC-10). Les helpers requis le sont SANS garde : s'ils
 * s'évaporent, cette suite doit mourir au CHARGEMENT plutôt que dégénérer en
 * « rien à vérifier » (DNC-08).
 *
 * LES FIXTURES N'EMBARQUENT AUCUN NOM RÉEL (PF-295) — le classifieur reçoit les
 * noms de modèle et de relation EN PARAMÈTRE.
 *
 * CE QUE CE CLIQUET NE PROUVE PAS
 * -------------------------------
 * Il prouve une FORME. Que les projections S'ACCORDENT sur un nombre est porté,
 * et de façon EXÉCUTÉE, par
 * `apps/api/src/modules/analytics/teacher-roster-agreement.spec.ts`. Deux
 * affirmations, deux mécanismes ; les confondre serait `DNC-06`.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');
const SCHEMA_PATH = join(REPO_ROOT, 'apps', 'api', 'prisma', 'schema.prisma');

/** Les noms jugés. INJECTÉS dans le classifieur (PF-295). */
const NAMES = {
  relation: 'enrollments',
  model: 'enrollment',
  sectionOwner: 'classSection',
  sectionColumn: 'classSectionId',
  pupilOwner: 'student',
} as const;

/** La fonction qui DÉFINIT le foyer légitime. */
const HOME_FUNCTION = 'rosterCountArg';

/** Le foyer attendu — assis, jamais employé comme exemption. */
const EXPECTED_HOME = 'packages/contracts/src/roster/class-roster-size.ts';

/** Les jetons par lesquels un site DÉLÈGUE au module. Dérivés, pas devinés. */
const CANONICAL_TOKENS = ['rosterCountArg', 'rosterStatusesFor', 'ROSTER_'] as const;

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

/** Les clés d'APPARTENANCE : sous elles, la clause compte, elle ne charge pas. */
const MEMBERSHIP_KEYS: ReadonlySet<string> = new Set(['_count', 'some', 'none', 'every']);

/**
 * Les clés qui structurent une requête Prisma sans NOMMER un propriétaire. Elles
 * ne sont pas empilées : `include` n'est pas un modèle.
 */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  'select',
  'include',
  'where',
  'data',
  'orderBy',
  'omit',
  '_count',
  'some',
  'none',
  'every',
  'AND',
  'OR',
  'NOT',
  'create',
  'update',
  'connect',
  'set',
  'in',
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
 * LA MARCHE — quatre racines, plancher PAR RACINE
 * ================================================================== */

/**
 * Les specs sont HORS corpus : elles portent des fakes et des fixtures
 * délibérément contrevenantes — dont celles de ce fichier. Les juger produirait
 * un auto-rouge qu'on « corrigerait » par une exclusion, donc une allowlist
 * déguisée.
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
 * est `>=`). Mesurés sur cet arbre : 174 / 61 / 381 / 125 fichiers hors specs.
 */
const MIN_API_FILES = 150;
const MIN_WORKER_FILES = 50;
const MIN_WEB_FILES = 300;
const MIN_PACKAGE_FILES = 100;

/**
 * Plancher de RECONNAISSANCE : combien de CONSTRUCTIONS d'inscription la marche
 * doit encore VOIR, contrevenantes ou non. Mesuré après conversion : 79.
 */
const MIN_RECOGNISED_SITES = 60;

/**
 * Plancher de la FAMILLE ANCRÉE SUR LA SECTION — celle que ce cliquet gouverne.
 * Si elle tombait à zéro, le cliquet serait décoratif. Mesuré après conversion :
 * 22 clauses `enrollments` ancrées sur la section.
 */
const MIN_SECTION_ANCHORED_SITES = 15;

/* ================================================================== *
 * LE CLASSIFIEUR — tous les noms sont INJECTÉS (PF-295)
 * ================================================================== */

type Names = {
  relation: string;
  model: string;
  sectionOwner: string;
  sectionColumn: string;
  pupilOwner: string;
};

type RuleId = 'R1-unfiltered-section-count' | 'R2-cumulative-sum' | 'R3-handwritten-population';

type Finding = { rule: RuleId; line: number; detail: string };

type FileFacts = {
  source: string;
  findings: Finding[];
  recognised: number;
  sectionAnchored: number;
  pupilAnchoredUnfiltered: number;
  declaresHome: boolean;
  /** Les clés `enrollments` VUES sous un `_count` — le plancher d'ADR-072. */
  membershipKeys: number;
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
 * Un initialiseur PORTE-T-IL une forme d'objet ? Un ternaire en porte une
 * (`activeYearId ? { where: … } : false` — la forme EXACTE de
 * `structure.controller.ts`), et l'ignorer casserait la pile de propriétaires en
 * silence : le site deviendrait invisible au cliquet sans qu'aucun test rougisse.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function carriesObjectShape(node: any): boolean {
  let n = node;
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n))) n = n.expression;
  if (!n) return false;
  if (ts.isObjectLiteralExpression(n)) return true;
  if (ts.isConditionalExpression(n)) {
    return carriesObjectShape(n.whenTrue) || carriesObjectShape(n.whenFalse);
  }
  return false;
}

const singular = (name: string): string => (name.endsWith('s') ? name.slice(0, -1) : name);

const delegatesToModule = (text: string): boolean =>
  CANONICAL_TOKENS.some((token) => text.includes(token));

/**
 * Un `status:` ÉCRIT À LA MAIN — littéral, membre d'énum, ou `{ in: [ … ] }`
 * dont le contenu ne vient pas du module. C'est la forme que R3 plafonne.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writesStatusByHand(node: any, sf: unknown): boolean {
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : undefined;
      if (key === 'status') {
        let value = n.initializer;
        while (value && ts.isAsExpression(value)) value = value.expression;
        if (value && (ts.isStringLiteral(value) || ts.isPropertyAccessExpression(value))) {
          found = true;
          return;
        }
        if (value && ts.isObjectLiteralExpression(value)) {
          if (!delegatesToModule(value.getText(sf) as string)) {
            found = true;
            return;
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * `<expr>._count?.<relation>` — la lecture d'un effectif, quelle que soit sa
 * forme. Le nom de la relation est INJECTÉ (PF-295) : écrit en dur, ce motif ne
 * s'apparierait jamais aux fixtures et les contrôles négatifs de R2 seraient
 * vides tout en paraissant verts.
 */
const readsARosterSize = (relation: string): RegExp =>
  new RegExp('_count[\\s?.]*\\.?\\s*' + relation);

function classify(path: string, source: string, names: Names): FileFacts {
  const READS_A_ROSTER_SIZE = readsARosterSize(names.relation);
  const scriptKind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const findings: Finding[] = [];
  let recognised = 0;
  let sectionAnchored = 0;
  let pupilAnchoredUnfiltered = 0;
  let declaresHome = false;
  let membershipKeys = 0;

  const lineOf = (n: { getStart: (s: unknown) => number }): number =>
    (sf.getLineAndCharacterOfPosition(n.getStart(sf)).line as number) + 1;

  /**
   * La PILE DE PROPRIÉTAIRES. Le modèle Prisma de l'appel y est poussé, puis
   * chaque clé de relation traversée. Le sommet décide de l'ancrage — c'est la
   * seule chose qui décide, et aucun nom de fichier n'y figure.
   */
  const ownerStack: string[] = [];
  let underMembership = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.name.text === HOME_FUNCTION) {
      declaresHome = true;
    }

    // ── R2 — `stat.x += <un effectif>` ────────────────────────────────────
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
      READS_A_ROSTER_SIZE.test(node.right.getText(sf) as string)
    ) {
      findings.push({
        rule: 'R2-cumulative-sum',
        line: lineOf(node),
        detail: '`+=` sur un effectif — une somme de PLACES rendue comme des ÉLÈVES',
      });
    }

    // ── R2 — `.reduce((s, c) => s + c._count.enrollments, 0)` ─────────────
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'reduce' &&
      node.arguments[0] !== undefined
    ) {
      const callback = node.arguments[0].getText(sf) as string;
      if (READS_A_ROSTER_SIZE.test(callback) && callback.includes('+')) {
        findings.push({
          rule: 'R2-cumulative-sum',
          line: lineOf(node),
          detail: '`reduce(+)` sur des effectifs — passer par `sumRosterSizes` (des PLACES)',
        });
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const key =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;

      if (key === names.relation) {
        recognised += 1;
        if (underMembership) membershipKeys += 1;
        const owner = ownerStack.length > 0 ? singular(ownerStack[ownerStack.length - 1]!) : null;
        const initializer = node.initializer;
        const initializerText = initializer.getText(sf) as string;
        const where = memberOf(initializer, 'where');

        if (owner === names.sectionOwner) {
          sectionAnchored += 1;
          if (!delegatesToModule(initializerText)) {
            if (
              underMembership &&
              (initializer.kind === ts.SyntaxKind.TrueKeyword || where === undefined)
            ) {
              findings.push({
                rule: 'R1-unfiltered-section-count',
                line: lineOf(node),
                detail: `${names.sectionOwner}.<read>({ _count: { select: { ${names.relation}: true } } }) — les SIX statuts comptés comme un effectif`,
              });
            } else if (where !== undefined && writesStatusByHand(where, sf)) {
              findings.push({
                rule: 'R3-handwritten-population',
                line: lineOf(node),
                detail: `${names.relation}: { where: { status: … } } écrit à la main sur une lecture ancrée SECTION`,
              });
            }
          }
        } else if (owner === names.pupilOwner && underMembership && where === undefined) {
          // DÉLIBÉRÉ, et compté pour que le contrôle POSITIF ne soit pas vide.
          pupilAnchoredUnfiltered += 1;
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

      if (
        key !== undefined &&
        !STRUCTURAL_KEYS.has(key) &&
        node.initializer &&
        carriesObjectShape(node.initializer)
      ) {
        ownerStack.push(key);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ts.forEachChild(node, (child: any) => visit(child));
        ownerStack.pop();
        return;
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text as string;
      const receiver = node.expression.expression;

      if (ts.isPropertyAccessExpression(receiver) && READ_OPERATIONS.has(method)) {
        const model = receiver.name.text as string;
        const args = node.arguments[0];

        // Lecture DIRECTE : ancrée sur la SECTION ⇔ le `where` porte la colonne.
        if (model === names.model) {
          recognised += 1;
          const where = memberOf(args, 'where');
          const anchored = where !== undefined && memberOf(where, names.sectionColumn) !== undefined;
          if (anchored) {
            sectionAnchored += 1;
            if (writesStatusByHand(where, sf)) {
              findings.push({
                rule: 'R3-handwritten-population',
                line: lineOf(node),
                detail: `${names.model}.${method}({ where: { ${names.sectionColumn}, status: … } }) — population écrite à la main`,
              });
            }
          }
        }

        ownerStack.push(model);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ts.forEachChild(node, (child: any) => visit(child));
        ownerStack.pop();
        return;
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  return {
    source,
    findings,
    recognised,
    sectionAnchored,
    pupilAnchoredUnfiltered,
    declaresHome,
    membershipKeys,
  };
}

/* ================================================================== *
 * L'EXÉCUTION SUR L'ARBRE RÉEL
 * ================================================================== */

const { entries, skipped } = walkRead.mapWalkedFiles<FileFacts>(ALL_FILES, (path, source) => [
  rel(path),
  classify(rel(path), source, NAMES),
]);
const CLASSIFIED = new Map(entries);
walkRead.warnSkipped('class-roster-size-derivation-gate', skipped);

const HOMES = [...CLASSIFIED.entries()]
  .filter(([, facts]) => facts.declaresHome)
  .map(([file]) => file);

type Site = Finding & { file: string };

const ALL_FINDINGS: Site[] = [...CLASSIFIED.entries()].flatMap(([file, facts]) =>
  facts.findings.map((finding) => ({ ...finding, file })),
);

const RECOGNISED_SITES = [...CLASSIFIED.values()].reduce((s, f) => s + f.recognised, 0);
const SECTION_ANCHORED_SITES = [...CLASSIFIED.values()].reduce((s, f) => s + f.sectionAnchored, 0);
const PUPIL_ANCHORED_UNFILTERED = [...CLASSIFIED.values()].reduce(
  (s, f) => s + f.pupilAnchoredUnfiltered,
  0,
);

/**
 * L'allowlist manuelle. Elle existe, elle est nommée, et elle EXPÉDIE VIDE —
 * une assertion le vérifie plus bas. Le foyer légitime est DÉRIVÉ (le fichier
 * qui déclare `rosterCountArg`), jamais énuméré.
 */
const MANUAL_ALLOWLIST: ReadonlyArray<{ file: string; line: number }> = [];

const OFFENDERS: Site[] = ALL_FINDINGS.filter(
  (site) =>
    !HOMES.includes(site.file) &&
    !MANUAL_ALLOWLIST.some((a) => a.file === site.file && a.line === site.line),
);

const R1_OFFENDERS = OFFENDERS.filter((s) => s.rule === 'R1-unfiltered-section-count');
const R2_OFFENDERS = OFFENDERS.filter((s) => s.rule === 'R2-cumulative-sum');
const R3_OFFENDERS = OFFENDERS.filter((s) => s.rule === 'R3-handwritten-population');

/**
 * R3 — LE PLAFOND DÉCROISSANT. Mesuré au land de S-E03-7 : 13 `where` de
 * population écrits à la main subsistent hors du module, et ils sont NOMMÉS
 * dans OPEN.md, jamais allowlistés :
 *
 *   • 5 GARDES d'écriture ou d'appartenance — `enrollments.controller.ts` ×2
 *     (capacité), `grades.controller.ts`, `attendance.controller.ts:533`
 *     (pointage), `announcements.service.ts` ;
 *   • le MUR D'AUTORISATION `student-access.service.ts:190` (ADR-063 §D1 /
 *     ADR-066 §D1) — compté, JAMAIS converti, voir plus bas ;
 *   • 7 lectures hors périmètre déclaré (feuilles d'appel, cahier de textes,
 *     export xlsx du worker, cache d'import).
 *
 * ⚠ Ce nombre ne peut que BAISSER. Le faire remonter pour « faire passer » un
 * diff est exactement ce que `academic-year-resolution-gate.spec.ts:20-32`
 * interdit (R-30). Quand il baisse, on l'abaisse ICI, dans le même commit que la
 * conversion, avec la ligne de registre correspondante.
 */
const R3_CEILING = 13;

/**
 * Mesuré sur HEAD AVANT conversion, par le MÊME classifieur : 26 contraventions
 * R3 (et 2 R1, 4 R2 — soit 32 en tout). Épingler sans convertir est un ÉCHEC :
 * l'assertion `R3_CEILING < MEASURED_BEFORE_CONVERSION` le rend inexprimable.
 */
const R3_MEASURED_BEFORE_CONVERSION = 26;

const describeSite = (s: Site) => `${s.file}:${s.line} — [${s.rule}] ${s.detail}`;

/* ================================================================== *
 * LE CORPUS EST BIEN LE CORPUS — les garde-fous de vacuité
 * ================================================================== */

describe('la dérivation n’est pas vacante', () => {
  it('a marché `apps/api/src` — plancher PAR RACINE', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(MIN_API_FILES);
  });

  it('a marché `apps/worker/src` — il porte une lecture ancrée SECTION (export xlsx)', () => {
    expect(WORKER_FILES.length).toBeGreaterThanOrEqual(MIN_WORKER_FILES);
  });

  it('a marché `apps/web/src` — trois portails sur quatre RENDENT cet effectif', () => {
    expect(WEB_FILES.length).toBeGreaterThanOrEqual(MIN_WEB_FILES);
  });

  it('a marché `packages/*/src` — la racine qui héberge le module déclarant', () => {
    expect(PACKAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
  });

  it('a bien parsé du TSX — sinon la moitié du corpus serait invisible', () => {
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

  it('voit encore la famille ANCRÉE SUR LA SECTION — celle que CE cliquet gouverne', () => {
    expect(SECTION_ANCHORED_SITES).toBeGreaterThanOrEqual(MIN_SECTION_ANCHORED_SITES);
  });

  it('a trouvé EXACTEMENT UN foyer déclarant, reconnu par construction', () => {
    // Zéro ⇒ le module a disparu et le cliquet est décoratif.
    // Deux ⇒ la canonicalisation a déjà re-divergé.
    expect(HOMES).toHaveLength(1);
    expect(HOMES[0]).toBe(EXPECTED_HOME);
  });
});

/* ================================================================== *
 * R1 — TOLÉRANCE ZÉRO sur le `_count` NON FILTRÉ ancré SECTION
 * ================================================================== */

describe('R1 — plus aucun `_count … enrollments` NON FILTRÉ ancré sur la SECTION', () => {
  it('zéro contrevenant — c’est la VARIANTE A de l’audit, et elle est fermée', () => {
    // Le message porte le SITE et la RÈGLE, jamais un simple compte.
    expect(R1_OFFENDERS.map(describeSite)).toEqual([]);
  });

  it("l'allowlist manuelle expédie VIDE — le foyer est DÉRIVÉ, pas énuméré", () => {
    expect(MANUAL_ALLOWLIST).toEqual([]);
  });
});

/* ================================================================== *
 * R2 — INTERDICTION TOTALE de la somme cumulative
 * ================================================================== */

describe('R2 — une somme d’effectifs ne peut plus être rendue comme un nombre d’ÉLÈVES', () => {
  it('zéro `+=` et zéro `reduce(+)` sur un effectif, PARTOUT, sans plafond', () => {
    // Un taux d'occupation qui veut légitimement sommer passe par
    // `sumRosterSizes`, dont le TYPE dit que le résultat est des PLACES.
    expect(R2_OFFENDERS.map(describeSite)).toEqual([]);
  });
});

/* ================================================================== *
 * R3 — le plafond DÉCROISSANT
 * ================================================================== */

describe('R3 — les `where` de population écrits à la main ne peuvent que DIMINUER', () => {
  it(`reste sous le plafond épinglé (${R3_CEILING})`, () => {
    if (R3_OFFENDERS.length > R3_CEILING) {
      // En cas de DÉPASSEMENT, la sortie NOMME chaque site : un plafond qui ne
      // rend qu'un nombre n'est pas actionnable.
      expect(R3_OFFENDERS.map(describeSite)).toEqual([]);
    }
    expect(R3_OFFENDERS.length).toBeLessThanOrEqual(R3_CEILING);
  });

  it('le plafond a bien BAISSÉ — épingler sans convertir est un ÉCHEC', () => {
    expect(R3_CEILING).toBeLessThan(R3_MEASURED_BEFORE_CONVERSION);
  });
});

/* ================================================================== *
 * R4 — l'ÉNUM ne peut pas dériver
 * ================================================================== */

describe('R4 — les populations restent DÉRIVÉES de `enum EnrollmentStatus`', () => {
  const SCHEMA = readFileSync(SCHEMA_PATH, 'utf8');
  const HOME_SOURCE = readFileSync(join(REPO_ROOT, EXPECTED_HOME), 'utf8');

  const enumMembers = (): string[] => {
    const start = SCHEMA.indexOf('enum EnrollmentStatus {');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = SCHEMA.indexOf('}', start);
    return SCHEMA.slice(SCHEMA.indexOf('{', start) + 1, end)
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l.length > 0);
  };

  /** La liste telle qu'elle est ÉCRITE dans le module — lue, pas importée. */
  const listInModule = (name: string): string[] => {
    const at = HOME_SOURCE.indexOf(`export const ${name} = [`);
    expect(at).toBeGreaterThanOrEqual(0);
    const open = HOME_SOURCE.indexOf('[', at);
    const close = HOME_SOURCE.indexOf(']', open);
    return HOME_SOURCE.slice(open + 1, close)
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter((s) => s.length > 0);
  };

  it('SEATED ∪ AWAITING ∪ {transferred_in} ∪ EXIT === l’énum, byte à byte', () => {
    // Un SEPTIÈME membre fait rougir ce test au lieu de se ranger en silence
    // dans « tous les autres » — c'est tout l'objet de R4.
    const partition = [
      ...listInModule('ROSTER_SEATED_STATUSES'),
      ...listInModule('ROSTER_AWAITING_STATUSES'),
      'transferred_in',
      ...listInModule('ROSTER_EXIT_STATUSES'),
    ].sort();
    expect(partition).toEqual([...enumMembers()].sort());
  });

  it('`ROSTER_ALL_STATUSES` est le miroir EXACT de l’énum, dans l’ordre de déclaration', () => {
    expect(listInModule('ROSTER_ALL_STATUSES')).toEqual(enumMembers());
  });

  it('`ON_THE_BOOKS` reste DÉRIVÉE — jamais une seconde liste écrite à la main', () => {
    // Deux listes tenues à la main divergent en silence : c'est le mode de panne
    // que cette maison a déjà mesuré. La forme `= ROSTER_ALL_STATUSES.filter(…)`
    // est donc load-bearing, et ce test la fige.
    expect(HOME_SOURCE).toContain('ROSTER_ON_THE_BOOKS_STATUSES: readonly RosterStatus[] =');
    expect(HOME_SOURCE).toContain('ROSTER_ALL_STATUSES.filter(');
  });
});

/* ================================================================== *
 * LA FRONTIÈRE D'AUTORISATION — comptée, jamais convertie (AC-8)
 * ================================================================== */

describe('le module de COMPTAGE ne franchit pas la frontière d’AUTORISATION', () => {
  const ACCESS_SERVICE = 'apps/api/src/modules/students/student-access.service.ts';

  it('`student-access.service.ts` est dans le corpus et LIT bien des inscriptions', () => {
    const facts = CLASSIFIED.get(ACCESS_SERVICE);
    expect(facts).toBeDefined();
    expect(facts!.recognised).toBeGreaterThanOrEqual(1);
  });

  it('il n’IMPORTE PAS le module canonique (ADR-063 §D1 / ADR-066 §D1)', () => {
    // Y importer le module changerait la POPULATION ou la PORTÉE D'ANNÉE du mur
    // d'autorisation enseignant : une modification d'AUTHZ déguisée en correction
    // de comptage. Assertion de GRAPHE D'IMPORT, pas de forme.
    const facts = CLASSIFIED.get(ACCESS_SERVICE);
    expect(facts).toBeDefined();
    for (const token of ['rosterCountArg', 'distinctStudentsWhere', 'readDistinctStudents']) {
      expect(facts!.source).not.toContain(token);
    }
  });

  it('il est COMPTÉ dans le plafond R3, jamais exempté — sinon la classe paraîtrait fermée', () => {
    // C'est la posture honnête : visible dans le résidu, donc personne ne peut
    // croire que le mur a été converti.
    expect(R3_OFFENDERS.some((s) => s.file === ACCESS_SERVICE)).toBe(true);
    expect(MANUAL_ALLOWLIST.some((a) => a.file === ACCESS_SERVICE)).toBe(false);
  });

  it('aucun guard ni aucune stratégie n’importe le module', () => {
    const guards = [...CLASSIFIED.entries()].filter(
      ([file]) => file.includes('.guard.') || file.includes('.strategy.'),
    );
    expect(guards.length).toBeGreaterThanOrEqual(3);
    for (const [file, facts] of guards) {
      expect({ file, uses: facts.source.includes(HOME_FUNCTION) }).toEqual({ file, uses: false });
    }
  });
});

/* ================================================================== *
 * LES FICHIERS CONVERTIS SONT TOUJOURS VUS — et gardent la clé `enrollments`
 * ================================================================== */

const CONVERTED = [
  'apps/api/src/modules/analytics/analytics.service.ts',
  'apps/api/src/modules/grades/assessments.controller.ts',
  'apps/api/src/modules/school-structure/classes.controller.ts',
  'apps/api/src/modules/school-structure/structure.controller.ts',
  'apps/api/src/modules/teaching/teachers.controller.ts',
];

describe('les fichiers convertis sont TOUJOURS VUS — un vert par disparition n’en est pas un', () => {
  it('chacun est dans la carte et ne porte AUCUNE contravention', () => {
    // Cette liste ne pilote AUCUNE exemption : elle refuse un vert obtenu parce
    // que la marche aurait cessé de voir ces fichiers.
    for (const file of CONVERTED) {
      expect(CLASSIFIED.has(file)).toBe(true);
      expect(ALL_FINDINGS.filter((s) => s.file === file)).toEqual([]);
    }
  });

  it('AC-6 — la clé `enrollments` SUBSISTE sous `_count` : le cliquet voisin reste VERT', () => {
    // `enrollment-activity-derivation-gate.spec.ts` reconnaît sa famille
    // d'appartenance par la PRÉSENCE de cette clé sous `_count` et exige
    // `hasMembershipFamily >= 5`. L'appel canonique est donc posé À la clause
    // `enrollments:`, jamais en remplaçant le littéral `_count` par un spread.
    const withMembershipKeys = [...CLASSIFIED.values()].filter((f) => f.membershipKeys > 0);
    expect(withMembershipKeys.length).toBeGreaterThanOrEqual(5);
  });
});

/* ================================================================== *
 * DNC-10 — rien ne peut désarmer ce cliquet
 * ================================================================== */

describe('DNC-10 — aucun interrupteur', () => {
  it('aucun `SKIP_*` / `ALLOW_*` / `NODE_ENV` ne peut désarmer ce cliquet', () => {
    const SELF = readFileSync(join(__dirname, 'class-roster-size-derivation-gate.spec.ts'), 'utf8');
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
  sectionOwner: 'fixtureGroup',
  sectionColumn: 'fixtureGroupId',
  pupilOwner: 'fixturePupil',
};

const FIXTURE_TS = 'apps/api/src/modules/__fixture/fixture.service.ts';
const FIXTURE_TSX = 'apps/web/src/app/__fixture/fixture-page.tsx';

/** Toute source de fixture est CONCATÉNÉE, jamais écrite en un littéral unique. */
const fixture = (...lines: string[]) => [...lines, ''].join('\n');

const runTs = (source: string) => classify(FIXTURE_TS, source, FIXTURE_NAMES).findings;
const runTsx = (source: string) => classify(FIXTURE_TSX, source, FIXTURE_NAMES).findings;

describe('CONTRÔLE NÉGATIF — les quatre formes interdites DOIVENT être signalées', () => {
  it('R1 — `_count` NON FILTRÉ ancré sur la SECTION (la VARIANTE A de l’audit)', () => {
    const findings = runTs(
      fixture(
        'export async function roster(db: Db, tenantId: string) {',
        `  return db.${FIXTURE_NAMES.sectionOwner}.findMany({`,
        '    where: { tenantId },',
        `    include: { _count: { select: { ${FIXTURE_NAMES.relation}: true } } },`,
        '  });',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R1-unfiltered-section-count']);
  });

  it('R1 — la forme IMBRIQUÉE tombe aussi : l’ancrage suit la PILE, pas le modèle de l’appel', () => {
    // C'est la forme EXACTE d'`assessments.controller.ts` : l'appel est écrit sur
    // `assessment`, mais le `_count` appartient à la SECTION, deux relations plus
    // bas. Une règle énoncée sur le modèle de l'APPEL l'aurait manquée.
    const findings = runTs(
      fixture(
        'export async function papers(db: Db, tenantId: string) {',
        '  return db.fixturePaper.findMany({',
        '    where: { tenantId },',
        '    include: {',
        '      fixtureDuty: {',
        '        include: {',
        `          ${FIXTURE_NAMES.sectionOwner}: {`,
        `            select: { id: true, _count: { select: { ${FIXTURE_NAMES.relation}: true } } },`,
        '          },',
        '        },',
        '      },',
        '    },',
        '  });',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R1-unfiltered-section-count']);
  });

  it('R2 — `+=` sur un effectif (la forme du tableau de bord enseignant)', () => {
    const findings = runTs(
      fixture(
        'export function tally(rows: Row[]) {',
        '  let total = 0;',
        `  for (const r of rows) total += r.${FIXTURE_NAMES.sectionOwner}._count?.${FIXTURE_NAMES.relation} ?? 0;`,
        '  return total;',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R2-cumulative-sum']);
  });

  it('R2 — `reduce(+)` sur des effectifs', () => {
    const findings = runTs(
      fixture(
        'export function tally(rows: Row[]) {',
        `  return rows.reduce((s, c) => s + (c._count?.${FIXTURE_NAMES.relation} ?? 0), 0);`,
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R2-cumulative-sum']);
  });

  it('R3 — `where: { status: … }` écrit à la main sur une lecture ancrée SECTION', () => {
    const findings = runTs(
      fixture(
        'export async function roster(db: Db, tenantId: string) {',
        `  return db.${FIXTURE_NAMES.sectionOwner}.findMany({`,
        '    where: { tenantId },',
        `    include: { _count: { select: { ${FIXTURE_NAMES.relation}: { where: { status: 'active' } } } } },`,
        '  });',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R3-handwritten-population']);
  });

  it('R3 — la forme ENUM et la forme `as const` tombent aussi', () => {
    for (const literal of ['FixtureStatus.active', "'active' as const"]) {
      const findings = runTs(
        fixture(
          'export async function roster(db: Db, tenantId: string) {',
          `  return db.${FIXTURE_NAMES.sectionOwner}.findMany({`,
          '    where: { tenantId },',
          `    include: { ${FIXTURE_NAMES.relation}: { where: { status: ${literal} } } },`,
          '  });',
          '}',
        ),
      );
      expect(findings.map((f) => f.rule)).toEqual(['R3-handwritten-population']);
    }
  });

  it('R3 — un `status: { in: [ … ] }` LITTÉRAL est aussi une population écrite à la main', () => {
    // Sans ce cas, il suffirait d'écrire la liste soi-même pour sortir du cliquet
    // — c'est-à-dire de recréer PF-36 sous une autre syntaxe.
    const findings = runTs(
      fixture(
        'export async function roster(db: Db, tenantId: string, ids: string[]) {',
        `  return db.${FIXTURE_NAMES.model}.findMany({`,
        `    where: { tenantId, ${FIXTURE_NAMES.sectionColumn}: { in: ids }, status: { in: ['active', 'pending'] } },`,
        '    select: { studentId: true },',
        '  });',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R3-handwritten-population']);
  });

  it('R3 — un TERNAIRE ne casse PAS la pile de propriétaires (la forme de `structure.controller`)', () => {
    // Sans `carriesObjectShape`, `classSections: cond ? { … } : false` faisait
    // perdre l'ancrage et le site devenait INVISIBLE — un cliquet vert par
    // aveuglement, le pire des verts.
    const findings = runTs(
      fixture(
        'export async function tree(db: Db, id: string, yearId: string | null) {',
        '  return db.fixtureBand.findUnique({',
        '    where: { id },',
        '    include: {',
        `      ${FIXTURE_NAMES.sectionOwner}s: yearId`,
        `        ? { where: { yearId }, include: { _count: { select: { ${FIXTURE_NAMES.relation}: { where: { status: 'active' } } } } } }`,
        '        : false,',
        '    },',
        '  });',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R3-handwritten-population']);
  });

  it('TSX — une fixture JSX contrevenante FAIT FEU (le piège du ScriptKind)', () => {
    // Sans ce cas, rien ne prouve que la racine `apps/web/src` est réellement
    // jugée : un `.tsx` parsé en `.ts` rend un arbre vide et un cliquet VERT.
    const findings = runTsx(
      fixture(
        'export function Roster({ rows }: { rows: Row[] }) {',
        `  const total = rows.reduce((s, c) => s + (c._count?.${FIXTURE_NAMES.relation} ?? 0), 0);`,
        '  return <span className="kpi">{total} élèves</span>;',
        '}',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['R2-cumulative-sum']);
  });
});

describe('CONTRÔLE POSITIF — sans lui, un comparateur toujours-rouge « prouverait » tout', () => {
  it('le `_count` NON FILTRÉ ancré sur l’ÉLÈVE PASSE — sinon le cliquet exigerait de casser ADR-072', () => {
    // Les sept sites `_count … enrollments` ancrés sur l'ÉLÈVE alimentent
    // `totalEnrollmentCount` : sans le total NON filtré, un enfant diplômé serait
    // classé `none` au lieu d'`out_of_scope`. Ils sont DÉLIBÉRÉS.
    const findings = runTs(
      fixture(
        'export async function pupils(db: Db, tenantId: string) {',
        `  return db.${FIXTURE_NAMES.pupilOwner}.findMany({`,
        '    where: { tenantId },',
        `    include: { _count: { select: { ${FIXTURE_NAMES.relation}: true } } },`,
        '  });',
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('la GARDE DE SUPPRESSION ancrée sur l’ÉLÈVE passe — la router ici laisserait effacer un historique', () => {
    const findings = runTs(
      fixture(
        'export async function guard(db: Db, id: string) {',
        `  const pupil = await db.${FIXTURE_NAMES.pupilOwner}.findUnique({`,
        '    where: { id },',
        `    include: { _count: { select: { ${FIXTURE_NAMES.relation}: true } } },`,
        '  });',
        `  if (pupil && pupil._count.${FIXTURE_NAMES.relation} > 0) throw new Error('non');`,
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('la lecture ancrée SECTION SANS clause de statut passe — R3 juge la POPULATION, pas la lecture', () => {
    // La forme du mur d'autorisation SANS son `status` : elle prouve que R3 vise
    // le `where` de population écrit à la main, pas le fait de lire.
    const findings = runTs(
      fixture(
        'export async function wall(db: Db, tenantId: string, ids: string[]) {',
        `  return db.${FIXTURE_NAMES.model}.findMany({`,
        `    where: { tenantId, ${FIXTURE_NAMES.sectionColumn}: { in: ids } },`,
        '    select: { studentId: true },',
        '  });',
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('une somme de CAPACITÉS (`maxStudents`) passe — ce ne sont pas des effectifs', () => {
    // Le contrôle qui empêche R2 de dégénérer en « aucune addition nulle part ».
    const findings = runTs(
      fixture(
        'export function capacity(rows: Row[]) {',
        '  return rows.reduce((s, c) => s + (c.maxStudents ?? 0), 0);',
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('LA FORME CONVERTIE passe — l’argument vient du module, la population est NOMMÉE', () => {
    const findings = runTs(
      fixture(
        'export async function roster(db: Db, tenantId: string) {',
        `  return db.${FIXTURE_NAMES.sectionOwner}.findMany({`,
        '    where: { tenantId },',
        '    include: {',
        '      _count: {',
        '        select: {',
        `          ${FIXTURE_NAMES.relation}: rosterCountArg({`,
        "            population: 'seated',",
        '            yearScope: ROSTER_YEAR_IMPLIED_BY_SECTION,',
        '          }),',
        '        },',
        '      },',
        '    },',
        '  });',
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('`sumRosterSizes` passe — sommer des PLACES pour un taux d’occupation est JUSTE', () => {
    const findings = runTs(
      fixture(
        'export function occupancy(rows: Row[]) {',
        `  return sumRosterSizes(rows.map((c) => classRosterSize(c._count.${FIXTURE_NAMES.relation})));`,
        '}',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('LE MODULE RÉEL passe par le MÊME classifieur, sans exemption', () => {
    // Contrôle positif sur du code de PRODUCTION : le module canonique est lu
    // depuis l'arbre et jugé par la règle elle-même. Il est reconnu PAR
    // CONSTRUCTION (il déclare `rosterCountArg`), jamais nommé.
    const home = HOMES[0] as string;
    expect(CLASSIFIED.get(home)).toBeDefined();
    expect(OFFENDERS.filter((s) => s.file === home)).toEqual([]);
  });

  it('les sites ancrés sur l’ÉLÈVE existent ENCORE dans l’arbre réel — le contrôle positif n’est pas vide', () => {
    // Si ce compte tombait à zéro, quelqu'un aurait converti les sept sites
    // délibérés et le contrôle positif ci-dessus ne prouverait plus rien.
    expect(PUPIL_ANCHORED_UNFILTERED).toBeGreaterThanOrEqual(5);
  });
});
