import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E03-2 / `AC-3` / `PF-288` / `ADR-071` — LE CLIQUET : aucune AUTORISATION
 * élève n'est résolue par une lecture privée de `guardianship` liée à
 * l'identité de l'appelant, hors du module qui DÉCLARE `StudentAccessService`.
 *
 * LA RÈGLE, EN UNE LIGNE
 * ----------------------
 * Un appel `<expr>.guardianship.<opération de LECTURE>({ where: … })` dont le
 * `where` LIE `userProfileId` à une expression d'identité (`me.id`, `user.id`,
 * `args.callerId`…) est un contrevenant, sauf s'il est écrit dans le fichier qui
 * déclare la classe `StudentAccessService`.
 *
 * POURQUOI LA RÈGLE PORTE SUR L'IDENTITÉ ET NON SUR LE MODÈLE — le premier jet
 * tombait dans le piège
 * ---------------------------------------------------------------------------
 * Une règle énoncée sur « toute requête `guardianship` » attrape SEIZE sites,
 * dont la totalité du fan-out de notifications, les écrans d'administration des
 * tutelles et la file de réclamations d'enfant. Aucun d'eux ne répond à
 * « cet appelant peut-il lire cet élève ? » — ils énumèrent des tuteurs
 * JOIGNABLES (`guardian: { userProfileId: { not: null } }`) ou administrent le
 * lien lui-même. Au moment du gate il ne resterait alors que les trois sorties
 * que R-30 interdit : une allowlist longue, une conversion hors périmètre, ou un
 * relâchement de la règle jusqu'à ce qu'elle passe.
 *
 * Le PREMIER discriminant est donc la forme de la valeur liée à `userProfileId` :
 *   - une expression d'identité (identifiant ou accès de propriété) → une
 *     AUTORISATION : « la tutelle DE CET APPELANT sur cet élève » ;
 *   - un littéral d'objet (`{ not: null }`) → une ÉNUMÉRATION : « tous les
 *     tuteurs rattachés à un compte ».
 *
 * ET IL FAUT UN SECOND SIGNAL, mesuré ce run plutôt que supposé. La forme
 * seule attrape `apps/worker/src/modules/parent-digest/parent-digest-cron.service.ts:168`,
 * qui résout les enfants d'un tuteur par SON PROPRE `userProfileId` — même
 * requête, mais dans un CRON. Un cron n'a pas d'appelant : il n'AUTORISE
 * personne, il ITÈRE sur des tuteurs, exactement comme les fan-outs de
 * notification. Le signaler ne laisserait que les trois sorties interdites
 * (R-30). Le second signal est donc la présence, DANS LE MÊME CORPS DE
 * FONCTION, du principal appelant — `realm_access`, la seule manière dont ce
 * produit lit les rôles d'un porteur de jeton. Une AUTORISATION suppose un
 * appelant ; une énumération non.
 *
 * Les deux signaux sont reconnus PAR CONSTRUCTION, sans aucun nom en exception.
 *
 * ET POURQUOI « LECTURE » : `guardianship.create` / `update` administrent le
 * lien de tutelle (`guardians.controller.ts`, `child-claims.service.ts`). Les
 * verbes d'écriture ne sont pas dans `READ_OPERATIONS` — exclusion par
 * construction, là encore.
 *
 * L'INVENTAIRE EST DÉRIVÉ PAR MARCHE, JAMAIS ÉNUMÉRÉ (ADR-064 §D1a)
 * -----------------------------------------------------------------
 * Aucune liste jumelle de chemins écrite à la main : ce dépôt a déjà payé cette
 * facture (deux listes tenues à la main ⇒ dérive silencieuse ⇒ 503 sur quatre
 * portails). Trois racines marchées — `apps/api/src`, `apps/worker/src` et
 * `packages/<paquet>/src` — avec un plancher de vacuité PAR RACINE, parce qu'un
 * plancher GLOBAL resterait satisfait par `apps/api` seul pendant qu'une racine
 * disparaîtrait de la marche en silence.
 *
 * LE FOYER CANONIQUE EST RECONNU PAR CONSTRUCTION
 * -----------------------------------------------
 * Le seul site légitime n'est pas nommé dans une exception : c'est le fichier
 * qui DÉCLARE `class StudentAccessService`, trouvé par la même marche. Le
 * cliquet exige qu'il y en ait EXACTEMENT UN — zéro signifierait que l'ABAC
 * canonique a disparu et que le cliquet est devenu décoratif ; deux
 * signifieraient que la canonicalisation a déjà re-divergé.
 *
 * Cela ferme aussi l'INVERSION évidente : déplacer la chaîne de `grades` ou de
 * `lessons` vers un helper partagé satisferait « pas dans le contrôleur » tout
 * en recréant la divergence. Un tel helper n'est pas le foyer, donc il est
 * signalé.
 *
 * L'ALLOWLIST : EXACTEMENT UNE ENTRÉE, SA RAISON EN LIGNE, ET NON DÉCORATIVE
 * -------------------------------------------------------------------------
 * `attendance.controller.ts` conserve sa chaîne privée. Elle est ALLOWLISTÉE et
 * non convertie parce que sa branche enseignante est DÉJÀ BORNÉE
 * (`teacherOfStudentWhere`, S-E05-5) — ce n'est pas un fail-open — et parce que
 * son ordre de branches est un CHOIX documenté que la conversion inverserait
 * (`PF-266` : un principal `school_admin`+`parent`, aujourd'hui borné à ses
 * propres enfants, serait ÉLARGI). Une tranche qui RESSERRE n'élargit pas un
 * cinquième handler au passage. L'entrée est clé par FICHIER et non par ligne
 * (une clé de ligne rancit à la première édition), et un test exige qu'elle
 * corresponde ENCORE à un site réel : une allowlist qui ne protège plus rien est
 * une allowlist à supprimer, pas à garder.
 *
 * `MANUAL_ALLOWLIST` est nommée et bornée à UNE entrée par assertion. Aucune
 * variable d'environnement, aucun `NODE_ENV`, aucun `SKIP_*` / `ALLOW_*`
 * (DNC-10). Les deux helpers requis le sont sans garde : s'ils s'évaporent,
 * cette suite doit mourir au CHARGEMENT plutôt que dégénérer en « rien à
 * vérifier » (DNC-08).
 *
 * LES FIXTURES N'EMBARQUENT AUCUN NOM DE MODÈLE RÉEL (PF-295)
 * -----------------------------------------------------------
 * `body-metatype-gate.spec.ts:761,765` enregistre la collision : un motif écrit
 * en toutes lettres dans une fixture devient un faux positif pour le grep du
 * relecteur suivant. Le classifieur reçoit donc le nom du modèle EN PARAMÈTRE et
 * les fixtures emploient `fixtureWardship`, qui n'existe nulle part dans le
 * produit.
 *
 * CE QUE LE CLIQUET NE PROUVE PAS
 * -------------------------------
 * 1. Il prouve une FORME. Il est AVEUGLE à un ABAC élève privé écrit autrement :
 *    `enrollment.findFirst` sur une section enseignée, ou
 *    `student.findFirst({ where: { guardianships: { some: … } } })` — la
 *    tutelle traversée par la relation INVERSE, où le modèle jugé n'apparaît pas
 *    en tête d'appel. La classe fermée ici est « la chaîne
 *    `guardianship` + identité de l'appelant », qui est celle des quatre copies
 *    mesurées, pas « toute autorisation élève concevable ».
 * 1bis. Le SECOND signal est contournable en déplaçant la lecture de
 *    `realm_access` hors du corps qui émet la requête. C'est la contrepartie
 *    assumée de ne pas signaler le cron du digest ; le premier signal, lui,
 *    reste armé.
 * 2. Il ne prouve pas que le service canonique décide JUSTE. Cela est porté
 *    ailleurs et de façon exécutée : `student-access.service.spec.ts`,
 *    `grades-read-abac.spec.ts`, `lessons-read-abac.spec.ts`.
 * 2bis. RÉSIDU ENREGISTRÉ, NON CORRIGÉ — `PF-344` : le cron du digest
 *    hebdomadaire porte une CINQUIÈME expression de « les enfants de ce
 *    tuteur », hors du service canonique. Elle est hors de CETTE règle (pas
 *    d'appelant), et sa convergence est sa propre tranche : le worker ne
 *    dispose ni de `KeycloakJwtPayload` ni de `StudentAccessService`.
 * 3. Il ne voit pas les `where` imbriqués d'un `include`/`select`
 *    (`lessons.controller.ts:223` porte `guardianships: { where: … }` dans un
 *    `include`). Ce sont des fan-outs, hors règle de toute façon.
 *
 * LIMITE CONNUE, R-1 : LE CHEMIN DE GATE
 * --------------------------------------
 * `scripts/ci-gate.sh:396` ne fait tourner la suite complète que quand le diff
 * touche `GATE_MACHINERY` (`^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)`).
 * Ce fichier en fait partie, donc le cliquet tourne sur CETTE PR. Une PR future
 * qui ne toucherait QUE `packages/**` ou `apps/worker/**` prendrait la branche
 * `--skip src/shared/quality/` et ce cliquet ne s'exécuterait pas sur elle.
 * Résidu réel, DÉJÀ enregistré sous `PF-333` — pas de ré-allocation d'identifiant.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/** Le nom du modèle Prisma jugé. INJECTÉ dans le classifieur (PF-295). */
const MODEL_NAME = 'guardianship';

/** Le nom de la classe qui DÉFINIT le foyer légitime. */
const CANONICAL_CLASS = 'StudentAccessService';

/** La clé dont la LIAISON discrimine autorisation et énumération. */
const IDENTITY_KEY = 'userProfileId';

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

/**
 * Les `*.spec.ts`, les `__fixtures__/` et les `*.d.ts` sont HORS corpus : une
 * spec n'émet aucune requête de production, elle porte des doubles et des
 * fixtures délibérément contrevenantes — dont celles de CE fichier. Les juger
 * produirait un auto-rouge que l'on « corrigerait » par une exclusion, c'est-à-
 * dire par une allowlist déguisée.
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

/** Planchers PAR RACINE, jamais des égalités (convention maison : tout plancher est `>=`). */
const MIN_API_FILES = 150;
const MIN_WORKER_FILES = 50;
const MIN_PACKAGE_FILES = 38;

/**
 * Plancher de RECONNAISSANCE : le nombre de sites `guardianship.*` que la marche
 * doit encore VOIR. Zéro contravention sur zéro reconnaissance ne prouve rien.
 */
const MIN_MODEL_CALL_SITES = 20;

/** Plancher du CONTRÔLE NÉGATIF réel : les sites de fan-out qui doivent PASSER. */
const MIN_FANOUT_SITES = 3;

/* ================================================================== *
 * LE CLASSIFIEUR — le nom du modèle est INJECTÉ (PF-295)
 * ================================================================== */

type ModelCall = {
  operation: string;
  line: number;
  /** `true` ⇔ opération de lecture. */
  isRead: boolean;
  /** `true` ⇔ le `where` lie `userProfileId` à une EXPRESSION D'IDENTITÉ. */
  bindsCallerIdentity: boolean;
  /** `true` ⇔ le `where` lie `userProfileId` à un LITTÉRAL D'OBJET (`{ not: null }`). */
  bindsFanOut: boolean;
  /**
   * `true` ⇔ le CORPS DE FONCTION englobant lit le principal appelant
   * (`realm_access`). C'est le second signal : sans appelant, il n'y a pas
   * d'autorisation à rendre.
   */
  hasPrincipal: boolean;
};

type Binding = 'identity' | 'fan-out' | 'other';

/**
 * Comment `identityKey` est lié, à n'importe quelle profondeur du nœud reçu.
 *
 * `me.id`, `user.id`, `args.callerId`, `callerId` → IDENTITÉ : une valeur qui
 * VIENT de la requête, donc une autorisation.
 * `{ not: null }`, `{ in: [...] }` → ÉNUMÉRATION.
 * `'literal'`, `true`, `null` → ni l'un ni l'autre.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bindingsOf(node: any, identityKey: string): Binding[] {
  const out: Binding[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : undefined;
      if (key === identityKey) {
        const value = n.initializer;
        if (ts.isObjectLiteralExpression(value)) out.push('fan-out');
        else if (ts.isPropertyAccessExpression(value) || ts.isIdentifier(value)) out.push('identity');
        else out.push('other');
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/**
 * Le CORPS DE FONCTION englobant lit-il le principal appelant ? Remonte aux
 * parents jusqu'à la première fonction/méthode — `setParentNodes` est activé
 * à la création du `SourceFile`, ce qui rend cette remontée possible.
 *
 * `realm_access` est le SEUL vocabulaire par lequel ce produit lit les rôles
 * d'un porteur de jeton (`jwt.strategy.ts` le déclare, les quatre copies
 * mesurées le lisent toutes). Le motif est CONCATÉNÉ pour que ce fichier ne
 * devienne pas son propre faux positif au grep du relecteur suivant (PF-295).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function enclosingBodyReadsPrincipal(node: any, sf: any): boolean {
  const PRINCIPAL = 'realm_' + 'access';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursor: any = node.parent;
  while (cursor) {
    if (
      ts.isFunctionDeclaration(cursor) ||
      ts.isMethodDeclaration(cursor) ||
      ts.isArrowFunction(cursor) ||
      ts.isFunctionExpression(cursor)
    ) {
      return (cursor.getText(sf) as string).includes(PRINCIPAL);
    }
    cursor = cursor.parent;
  }
  return false;
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

/** Recense, pour UN fichier, chaque appel `<expr>.<modelName>.<op>(…)`. */
function classify(path: string, source: string, modelName: string, identityKey: string): ModelCall[] {
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
        const bindings = where === undefined ? [] : bindingsOf(where, identityKey);
        out.push({
          operation,
          line: (sf.getLineAndCharacterOfPosition(node.getStart(sf)).line as number) + 1,
          isRead: READ_OPERATIONS.has(operation),
          bindsCallerIdentity: bindings.includes('identity'),
          bindsFanOut: bindings.includes('fan-out'),
          hasPrincipal: enclosingBodyReadsPrincipal(node, sf),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Le fichier DÉCLARE-t-il la classe canonique ? Reconnaissance par construction. */
function declaresCanonical(path: string, source: string, className: string): boolean {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let found = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (n: any) => {
    if (found) return;
    if (ts.isClassDeclaration(n) && n.name && n.name.text === className) {
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

type FileFacts = { source: string; calls: ModelCall[]; isCanonicalHome: boolean };

const { entries, skipped } = walkRead.mapWalkedFiles<FileFacts>(ALL_FILES, (path, source) => [
  rel(path),
  {
    source,
    calls: classify(path, source, MODEL_NAME, IDENTITY_KEY),
    isCanonicalHome: declaresCanonical(path, source, CANONICAL_CLASS),
  },
]);
const CLASSIFIED = new Map(entries);
walkRead.warnSkipped('student-authz-locality-gate', skipped);

const CANONICAL_HOMES = [...CLASSIFIED.entries()]
  .filter(([, facts]) => facts.isCanonicalHome)
  .map(([file]) => file);

type Site = ModelCall & { file: string };

const MODEL_CALL_SITES: Site[] = [...CLASSIFIED.entries()].flatMap(([file, facts]) =>
  facts.calls.map((call) => ({ ...call, file })),
);

/**
 * L'ALLOWLIST MANUELLE — EXACTEMENT UNE ENTRÉE, sa raison EN LIGNE.
 *
 * Clé par FICHIER, jamais par ligne : une clé de ligne rancit à la première
 * édition du fichier et se « répare » en la remontant, ce qui est une allowlist
 * qui se réécrit toute seule. Un test plus bas exige que cette entrée
 * corresponde ENCORE à un site réel — une allowlist devenue décorative doit être
 * SUPPRIMÉE, pas conservée.
 */
const MANUAL_ALLOWLIST: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'apps/api/src/modules/attendance/attendance.controller.ts',
    reason:
      "S-E05-5 — la branche enseignante de ce handler est DÉJÀ bornée par `teacherOfStudentWhere` : " +
      "ce n'est pas un fail-open. Son ordre de branches (`parent` d'abord et terminal) est un CHOIX " +
      "documenté (`PF-266`) que la conversion INVERSERAIT, élargissant un principal " +
      "`school_admin`+`parent` aujourd'hui borné à ses propres enfants. Une tranche qui resserre " +
      "n'élargit pas un cinquième handler au passage. Conversion = sa propre tranche.",
  },
];

const OFFENDERS: Site[] = MODEL_CALL_SITES.filter(
  (site) =>
    site.isRead &&
    site.bindsCallerIdentity &&
    site.hasPrincipal &&
    !CANONICAL_HOMES.includes(site.file) &&
    !MANUAL_ALLOWLIST.some((a) => a.file === site.file),
);

const describeSite = (s: Site) =>
  `${s.file}:${s.line} — ${MODEL_NAME}.${s.operation}() lie ${IDENTITY_KEY} à l'identité de ` +
  `l'appelant hors de ${CANONICAL_CLASS} (copie privée de l'ABAC élève)`;

/* ================================================================== *
 * LE CORPUS EST BIEN LE CORPUS — les garde-fous de vacuité
 * ================================================================== */

describe('la dérivation n’est pas vacante', () => {
  it('a marché `apps/api/src` — plancher PAR RACINE', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(MIN_API_FILES);
  });

  it('a marché `apps/worker/src`', () => {
    expect(WORKER_FILES.length).toBeGreaterThanOrEqual(MIN_WORKER_FILES);
  });

  it('a marché `packages/*/src` — la racine que le précédent maison OUBLIE', () => {
    expect(PACKAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
  });

  it("porte l'identité comptable — un plancher sur la LISTE ne se transporte pas sur la CARTE", () => {
    expect(CLASSIFIED.size + skipped.length).toBe(ALL_FILES.length);
  });

  it("n'a pas perdu plus que le budget calibré sur la taille du corpus", () => {
    expect(skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(ALL_FILES.length));
  });

  it('a RECONNU des sites `guardianship.*` — zéro contravention sur zéro reconnaissance ne prouve rien', () => {
    expect(MODEL_CALL_SITES.length).toBeGreaterThanOrEqual(MIN_MODEL_CALL_SITES);
  });

  it('a trouvé EXACTEMENT UN foyer canonique, reconnu par construction', () => {
    // Zéro ⇒ l'ABAC canonique a disparu et le cliquet est devenu décoratif.
    // Deux ⇒ la canonicalisation a déjà re-divergé, ou un helper « partagé » a
    // été créé pour contourner la règle sans la violer littéralement.
    expect(CANONICAL_HOMES).toHaveLength(1);
    expect(CANONICAL_HOMES[0]).toBe('apps/api/src/modules/students/student-access.service.ts');
  });

  it('PLANCHER ANTI-VACUITÉ — le foyer canonique EST reconnu comme liant l’identité', () => {
    // Le contrôle positif sur du CODE RÉEL : si le classifieur cessait de
    // reconnaître la forme, il rendrait zéro contrevenant en étant simplement
    // aveugle. Le foyer porte la forme jugée ; il doit la porter VISIBLEMENT.
    const home = CANONICAL_HOMES[0] as string;
    const bound = MODEL_CALL_SITES.filter(
      (s) => s.file === home && s.isRead && s.bindsCallerIdentity && s.hasPrincipal,
    );
    expect(bound.length).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== *
 * LE CLIQUET LUI-MÊME
 * ================================================================== */

describe('AC-3 — aucune AUTORISATION élève n’est résolue hors de StudentAccessService', () => {
  it('zéro contrevenant sur les trois racines', () => {
    // Le message porte le SITE (`file:line`), jamais un simple compte.
    expect(OFFENDERS.map(describeSite)).toEqual([]);
  });

  it("l'allowlist manuelle contient EXACTEMENT UNE entrée, et elle porte sa raison", () => {
    expect(MANUAL_ALLOWLIST).toHaveLength(1);
    const only = MANUAL_ALLOWLIST[0];
    expect(only).toBeDefined();
    expect(only!.file).toBe('apps/api/src/modules/attendance/attendance.controller.ts');
    expect(only!.reason.length).toBeGreaterThan(120);
  });

  it("l'allowlist n'est pas DÉCORATIVE — son entrée protège encore un site réel", () => {
    // Une allowlist qui ne correspond plus à rien doit être SUPPRIMÉE. Si ce
    // test rougit, `attendance.controller.ts` a été converti : retirer l'entrée,
    // pas « réparer » le test.
    const only = MANUAL_ALLOWLIST[0];
    expect(only).toBeDefined();
    expect(CLASSIFIED.has(only!.file)).toBe(true);
    const protectedSites = MODEL_CALL_SITES.filter(
      (s) => s.file === only!.file && s.isRead && s.bindsCallerIdentity && s.hasPrincipal,
    );
    expect(protectedSites.length).toBeGreaterThanOrEqual(1);
  });

  it('les DEUX copies supprimées par cette tranche ne reviennent pas', () => {
    // Cette liste ne pilote AUCUNE exemption : elle refuse un vert obtenu parce
    // que la marche aurait cessé de voir ces fichiers.
    for (const file of [
      'apps/api/src/modules/grades/grades.controller.ts',
      'apps/api/src/modules/lessons/lessons.controller.ts',
    ]) {
      expect(CLASSIFIED.has(file)).toBe(true);
      expect(
        MODEL_CALL_SITES.filter((s) => s.file === file && s.bindsCallerIdentity),
      ).toEqual([]);
    }
  });

  it('CONTRÔLE NÉGATIF SUR DU CODE RÉEL — le fan-out `{ not: null }` PASSE', () => {
    // Sans ce contrôle, un comparateur toujours-rouge « prouverait » tout. Ces
    // sites énumèrent les tuteurs JOIGNABLES pour les notifications ; les
    // signaler ne laisserait que les trois sorties interdites.
    const fanOut = MODEL_CALL_SITES.filter((s) => s.bindsFanOut);
    expect(fanOut.length).toBeGreaterThanOrEqual(MIN_FANOUT_SITES);
    expect(fanOut.filter((s) => OFFENDERS.includes(s))).toEqual([]);
  });

  it('CONTRÔLE NÉGATIF SUR DU CODE RÉEL — le CRON du digest, lié à une identité mais SANS appelant, PASSE', () => {
    // Mesuré ce run : `parent-digest-cron.service.ts` résout les enfants d’un
    // tuteur par son propre `userProfileId`. La FORME est celle de la règle ;
    // le CONTEXTE ne l'est pas — un cron n'autorise personne. C'est ce site
    // qui rend le second signal nécessaire plutôt que décoratif : sans lui,
    // le cliquet naîtrait ROUGE sur du code innocent et se « réparerait » par
    // une deuxième entrée d’allowlist (R-30). Résidu enregistré : `PF-344`.
    const principalless = MODEL_CALL_SITES.filter(
      (s) => s.isRead && s.bindsCallerIdentity && !s.hasPrincipal,
    );
    expect(principalless.length).toBeGreaterThanOrEqual(1);
    expect(principalless.filter((s) => OFFENDERS.includes(s))).toEqual([]);
  });

  it('aucun `SKIP_*` / `ALLOW_*` / `NODE_ENV` ne peut désarmer ce cliquet (DNC-10)', () => {
    const SELF = readFileSync(join(__dirname, 'student-authz-locality-gate.spec.ts'), 'utf8');
    // Un `SKIP_…` ou un `ALLOW_…` ne peut désarmer quoi que ce soit qu'en étant
    // LU dans l'environnement : c'est donc la LECTURE qu'on interdit, pas les
    // noms — qui apparaissent en prose juste au-dessus et dans le titre de ce
    // test. Les motifs sont CONCATÉNÉS (PF-295).
    for (const needle of ['pro' + 'cess.env', "require('node:pro" + "cess')"]) {
      expect(SELF).not.toContain(needle);
    }
  });
});

/* ================================================================== *
 * ROUGE-AVANT / VERT-APRÈS, sur fixtures — modèle SYNTHÉTIQUE (PF-295)
 * ================================================================== */

const FIXTURE_MODEL = 'fixtureWardship';
const FIXTURE_PATH = join(API_SRC, 'modules', '__fixture', 'fixture.controller.ts');

/** Toute source de fixture est CONCATÉNÉE, jamais écrite en un littéral unique. */
const fixture = (...lines: string[]) => [...lines, ''].join('\n');

const runFixture = (source: string) => classify(FIXTURE_PATH, source, FIXTURE_MODEL, IDENTITY_KEY);
const onlyCall = (calls: ModelCall[]): ModelCall => {
  expect(calls).toHaveLength(1);
  return calls[0] as ModelCall;
};
const isOffending = (call: ModelCall) => call.isRead && call.bindsCallerIdentity && call.hasPrincipal;

describe('CONTRÔLE NÉGATIF — les formes contrevenantes DOIVENT être signalées', () => {
  it('la forme `grades` supprimée : `findFirst` + `guardian: { userProfileId: me.id }`', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function guard(prisma: Db, studentId: string, me: Me, jwt: Jwt) {',
          "  const roles = jwt.realm_" + "access?.roles ?? [];",
          '  void roles;',
          `  const link = await prisma.${FIXTURE_MODEL}.findFirst({`,
          `    where: { tenantId: me.tenantId, studentId, status: 'active', guardian: { ${IDENTITY_KEY}: me.id } },`,
          '  });',
          '  if (!link) throw new ForbiddenError();',
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(true);
  });

  it('la forme `lessons` supprimée : la même chaîne sur le client de TRANSACTION', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function guard(tx: Db, tenantId: string, studentId: string, me: Me, jwt: Jwt) {',
          "  const roles = jwt.realm_" + "access?.roles ?? [];",
          '  void roles;',
          `  return tx.${FIXTURE_MODEL}.findFirst({`,
          `    where: { tenantId, studentId, guardian: { ${IDENTITY_KEY}: me.id } },`,
          '  });',
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(true);
  });

  it('L’INVERSION : déplacer la chaîne dans un helper « partagé » ne la sauve pas', () => {
    // Le foyer est reconnu par la DÉCLARATION de la classe canonique, pas par un
    // chemin. Un `shared/abac/read-student.ts` porte exactement la même forme et
    // reste donc un contrevenant.
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function canRead(prisma: Db, studentId: string, callerProfileId: string, jwt: Jwt) {',
          "  const roles = jwt.realm_" + "access?.roles ?? [];",
          '  void roles;',
          `  return prisma.${FIXTURE_MODEL}.findFirst({ where: { studentId, guardian: { ${IDENTITY_KEY}: callerProfileId } } });`,
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(true);
  });

  it('la forme `count` compte aussi — un garde peut refuser sur un compte nul', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function guard(prisma: Db, studentId: string, me: Me, jwt: Jwt) {',
          "  const roles = jwt.realm_" + "access?.roles ?? [];",
          '  void roles;',
          `  const n = await prisma.${FIXTURE_MODEL}.count({ where: { studentId, guardian: { ${IDENTITY_KEY}: me.id } } });`,
          '  if (n === 0) throw new ForbiddenError();',
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(true);
  });
});

describe('CONTRÔLE POSITIF — sans lui, un comparateur toujours-rouge « prouverait » tout', () => {
  it('le FAN-OUT `{ not: null }` passe — il énumère des tuteurs, il n’autorise personne', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function recipients(prisma: Db, tenantId: string, studentId: string) {',
          `  return prisma.${FIXTURE_MODEL}.findMany({`,
          `    where: { tenantId, studentId, status: 'active', guardian: { ${IDENTITY_KEY}: { not: null } } },`,
          `    include: { guardian: { select: { ${IDENTITY_KEY}: true } } },`,
          '  });',
          '}',
        ),
      ),
    );
    expect(call.bindsFanOut).toBe(true);
    expect(isOffending(call)).toBe(false);
  });

  it('l’ÉCRITURE passe PAR CONSTRUCTION — administrer un lien n’est pas autoriser une lecture', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function link(prisma: Db, studentId: string, me: Me, jwt: Jwt) {',
          "  const roles = jwt.realm_" + "access?.roles ?? [];",
          '  void roles;',
          `  return prisma.${FIXTURE_MODEL}.updateMany({`,
          `    where: { studentId, guardian: { ${IDENTITY_KEY}: me.id } },`,
          "    data: { status: 'revoked' },",
          '  });',
          '}',
        ),
      ),
    );
    expect(call.isRead).toBe(false);
    expect(call.bindsCallerIdentity).toBe(true);
    expect(isOffending(call)).toBe(false);
  });

  it('une lecture d’ADMINISTRATION sur un id fourni passe — les écrans tutelles', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function byId(prisma: Db, id: string, tenantId: string) {',
          `  return prisma.${FIXTURE_MODEL}.findUnique({ where: { id, tenantId } });`,
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(false);
  });

  it('un `select` de `userProfileId` sans `where` n’est pas une liaison', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function listAll(prisma: Db, tenantId: string) {',
          `  return prisma.${FIXTURE_MODEL}.findMany({ where: { tenantId }, select: { ${IDENTITY_KEY}: true } });`,
          '}',
        ),
      ),
    );
    expect(isOffending(call)).toBe(false);
  });

  it('la MÊME chaîne SANS appelant passe — la forme d’un cron, pas d’une autorisation', () => {
    const call = onlyCall(
      runFixture(
        fixture(
          'export async function digest(prisma: Db, tenantId: string, profile: Profile) {',
          `  return prisma.${FIXTURE_MODEL}.findMany({ where: { tenantId, guardian: { ${IDENTITY_KEY}: profile.id } } });`,
          '}',
        ),
      ),
    );
    expect(call.bindsCallerIdentity).toBe(true);
    expect(call.hasPrincipal).toBe(false);
    expect(isOffending(call)).toBe(false);
  });

  it('LE FOYER RÉEL passe par le MÊME classifieur, sans exemption de forme', () => {
    // Contrôle positif sur du code de production : le module canonique est lu
    // depuis l'arbre, jugé par la règle, et n'est épargné QUE parce qu'il est le
    // foyer — pas parce que sa forme serait différente.
    const home = CANONICAL_HOMES[0] as string;
    const facts = CLASSIFIED.get(home);
    expect(facts).toBeDefined();
    expect(facts!.calls.some((c) => c.isRead && c.bindsCallerIdentity && c.hasPrincipal)).toBe(true);
    expect(OFFENDERS.filter((s) => s.file === home)).toEqual([]);
  });
});
