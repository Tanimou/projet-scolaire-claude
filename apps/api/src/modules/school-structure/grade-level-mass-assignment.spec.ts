import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BadRequestException,
  NotFoundException,
  ParseUUIDPipe,
  ValidationPipe,
  type Type,
} from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PERMISSIONS_META_KEY } from '../../shared/auth/requires-permission.decorator';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';

import { AcademicYearsController } from './academic-years.controller';
import { CyclesController } from './cycles.controller';
import type { SchoolContextService } from './school-context.service';

/**
 * S-E05-13 / PF-51 / ADR-064 — les deux corps `Partial<T>` cessent de s'effacer
 * en `Object`, et le PATCH de niveau cesse d'affecter en masse dans Prisma.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE QUI A ÉTÉ EXÉCUTÉ, ET PAR QUI — daté, jamais affirmé                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * L'agent qui a ÉCRIT ce fichier n'exécute NI jest, NI `pnpm typecheck`, NI
 * aucun build (budget CPU : seul le test-architect lance la chaîne), si bien que
 * ces assertions n'avaient JAMAIS ÉTÉ EXÉCUTÉES par leur auteur. **La passe de
 * land du run 74 les a exécutées** — `npx jest --runInBand` sur ce fichier :
 * **38/38 au VERT** en 17 s, et **33/33** pour le cliquet voisin
 * `../../shared/quality/body-metatype-gate.spec.ts` en 198 s.
 *
 * Un run vert ne prouve pourtant qu'une moitié : il ne dit pas que le test
 * SAURAIT échouer. Les DEUX défenses ont donc été prouvées ROUGES PAR MUTATION,
 * séparément, puis les mutations annulées :
 *
 *   • DÉFENSE 1 — retirer `forbidNonWhitelisted` de `main.ts` fait tomber
 *     EXACTEMENT les 6 refus de clés hostiles. C'est ce qui rend
 *     `globalPipeOptionsFromMainTs()` porteur : avec le littéral recopié qui
 *     occupait sa place, ces 6 tests seraient restés VERTS pendant que la
 *     production cessait de refuser `{"tenantId":…}`.
 *   • DÉFENSE 2 — remettre `data: body` à la place du choix explicite de
 *     champs fait tomber EXACTEMENT les 2 assertions AC-4, celles qui lisent
 *     `Object.keys()` de l'argument remis à `prisma.gradeLevel.update`. Le
 *     choix de champs est donc tenu par un test, pas seulement par un docblock.
 *
 * Ce qui avait tourné DÈS L'ÉCRITURE, avant tout jest :
 *
 *   • le recensement `grep -rn "@Body() [a-zA-Z]*: Partial<" apps/api/src
 *     --include=*.ts` → EXACTEMENT DEUX occurrences avant
 *     (`cycles.controller.ts:168`, `academic-years.controller.ts:247`), code de
 *     sortie 1 / zéro occurrence après ;
 *   • le recensement des appelants de première partie (G-PORTAL) :
 *     `grep -rn 'grade-levels' apps/web/src packages/` → `admin/cycles/
 *     actions.ts:61` (POST) et `:71` (DELETE) ; `grep -rn '/terms' apps/web/src
 *     packages/` → `admin/academic-years/actions.ts:68` (POST) et `:78`
 *     (DELETE), plus trois liens statiques `/legal/terms` sans rapport
 *     (`page.tsx:786`, `ParentRegisterForm.tsx:172`, `AuthSplitLayout.tsx:145`).
 *     ZÉRO appelant d'AUCUN des deux PATCH → 4/4 portails intacts, par
 *     recensement et non par affirmation ;
 *   • le recensement, PAR ANALYSE SYNTAXIQUE, des 77 paramètres `@Body()` des
 *     41 contrôleurs (voir `../../shared/quality/body-metatype-gate.spec.ts`) ;
 *   • la lecture de `schema.prisma:385-406` (`GradeLevel` : `tenantId`,
 *     `schoolId`, `cycleId` scalaires `@db.Uuid` inscriptibles) et de
 *     `main.ts:141-145` (les options exactes du pipe global).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI DEUX FAMILLES DE TESTS, ET POURQUOI AUCUNE N'ASSERTE UN STATUT  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * La tranche pose DEUX défenses indépendantes sur le même handler, et un code
 * de statut ne sait pas les distinguer : un 400 est vert que le field-pick
 * existe ou non. Chaque défense est donc prouvée par son PROPRE oracle, et
 * chacune doit pouvoir échouer SEULE :
 *
 *   • DÉFENSE 1 (contrat de décorateur) — on construit le VRAI `ValidationPipe`
 *     avec les options littérales de `main.ts:141-145`, sur le metatype LU DANS
 *     LES MÉTADONNÉES DE ROUTE (jamais sur une classe réimportée à la main : ce
 *     qu'il faut prouver, c'est que la ROUTE déclare une classe, pas qu'une
 *     classe existe quelque part dans le fichier).
 *   • DÉFENSE 2 (fait de flot de données) — on appelle la méthode DIRECTEMENT,
 *     ce qui court-circuite la phase PIPE de Nest, c'est-à-dire simule
 *     exactement une régression de la défense 1, et on asserte sur l'ARGUMENT
 *     remis à `prisma.gradeLevel.update`.
 *
 * L'assertion de la défense 2 porte sur l'ENSEMBLE DES CLÉS, pas sur une clé.
 * `expect(arg.data.tenantId).toBeUndefined()` est vert sur un
 * `{ tenantId: undefined }` répandu par un `data: body` — c'est-à-dire vert sur
 * le défaut lui-même. Et elle ne se limite pas à `tenantId` : `schoolId` est une
 * FK VALIDE vers une école d'un AUTRE tenant, et `list()`
 * (`cycles.controller.ts:65-67`) filtre sur `where: { schoolId }` sans
 * `tenantId` — la ligne se remet donc à lister CHEZ L'AUTRE TENANT. Une
 * assertion qui ne regarde que `tenantId` est verte pendant que cette fuite-là
 * reste ouverte.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LE FAUX PRISMA EST DÉLIBÉRÉMENT NON FILTRANT                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Il ENREGISTRE les arguments et rend ses fixtures SANS LES APPLIQUER. C'est
 * voulu : un double qui filtrerait de lui-même par tenant rendrait ces tests
 * verts sans que le code porte la moindre clause, c'est-à-dire prouverait le
 * faux (même raisonnement qu'`enrollments-roster-abac.spec.ts`).
 */

/** La clé de métadonnées de Nest pour les paramètres de route, en LITTÉRAL — même convention qu'`enrollments-roster-abac.spec.ts:92`. */
const ROUTE_ARGS_METADATA_KEY = '__routeArguments__';

/**
 * Les options du pipe global, **DÉRIVÉES** de `apps/api/src/main.ts` — jamais
 * recopiées.
 *
 * POURQUOI CETTE FONCTION EXISTE (le mode d'échec qu'elle ferme)
 * --------------------------------------------------------------
 * Ce fichier portait d'abord un littéral `{ transform, whitelist,
 * forbidNonWhitelisted }` annoté « RECOPIÉES de `main.ts:141-145` ». Une
 * **deuxième liste tenue à la main** est exactement la dérive silencieuse que
 * ce dépôt a déjà payée ailleurs : supprimer `forbidNonWhitelisted` de
 * `main.ts` aurait laissé **toutes** les assertions de ce fichier au VERT
 * pendant que la production cessait de refuser `{"tenantId":…}`. Le test aurait
 * alors prouvé le contraire de sa thèse.
 *
 * On LIT donc la source de `main.ts`, on y trouve le `new ValidationPipe({…})`
 * réellement monté, et on en extrait les propriétés booléennes. Le pipe que ces
 * tests exercent **est** celui de production, à la lettre près. Si quelqu'un
 * retire une clause là-bas, les refus attendus ici tombent en ROUGE — le seul
 * comportement honnête.
 *
 * Un échec de lecture n'est JAMAIS un PASS : source introuvable, `new
 * ValidationPipe` absent ou littéral vide JETTENT, au lieu de retomber sur un
 * défaut silencieux (même doctrine que le cliquet voisin, qui refuse aussi de
 * transformer un import illisible en succès).
 */
function globalPipeOptionsFromMainTs(): Record<string, boolean> {
  const mainTs = resolve(__dirname, '..', '..', 'main.ts');
  const source = readFileSync(mainTs, 'utf8');

  const at = source.indexOf('new ValidationPipe(');
  if (at === -1) {
    throw new Error(
      `main.ts n'expose plus aucun « new ValidationPipe( » (${mainTs}) — le pipe ` +
        'global a été déplacé ou supprimé : ce test doit être relu, pas contourné.',
    );
  }

  const open = source.indexOf('{', at);
  if (open === -1) {
    throw new Error('main.ts : « new ValidationPipe( » sans littéral d’options.');
  }

  // Équilibrage d’accolades — le littéral est plat aujourd’hui, mais un
  // compteur ne se trompe pas si une option imbriquée apparaît demain.
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) {
    throw new Error('main.ts : littéral d’options du pipe non terminé.');
  }

  const literal = source.slice(open + 1, close);
  const options: Record<string, boolean> = {};
  for (const match of literal.matchAll(/(\w+)\s*:\s*(true|false)\b/g)) {
    options[String(match[1])] = match[2] === 'true';
  }

  if (Object.keys(options).length === 0) {
    throw new Error(`main.ts : aucune option booléenne lue dans « ${literal.trim()} ».`);
  }
  return options;
}

const GLOBAL_PIPE_OPTIONS = globalPipeOptionsFromMainTs();

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const ME = '33333333-3333-3333-3333-333333333333';

const LEVEL_ID = 'aaaaaaaa-0000-4000-8000-00000000000a';
const SCHOOL_ID = 'bbbbbbbb-0000-4000-8000-00000000000b';
const OTHER_SCHOOL_ID = 'bbbbbbbb-0000-4000-8000-00000000000c';
const CYCLE_ID = 'cccccccc-0000-4000-8000-00000000000c';
const OTHER_CYCLE_ID = 'cccccccc-0000-4000-8000-00000000000d';
const TERM_ID = 'dddddddd-0000-4000-8000-00000000000d';

/** Les TROIS SEULES colonnes que `updateGradeLevel` a le droit d'écrire. */
const WRITABLE = ['code', 'name', 'orderIndex'];

/**
 * Les scalaires `GradeLevel` inscriptibles que Prisma accepterait
 * (`schema.prisma:385-406`) et qui ne doivent JAMAIS venir du fil. `tenantId`
 * ne porte NI relation NI clé étrangère et `grade_level` ne porte AUCUNE
 * policy RLS : rien, en base, n'aurait rattrapé l'écriture.
 */
const FORBIDDEN_SCALARS = ['tenantId', 'schoolId', 'cycleId', 'id', 'createdAt'];

type UpdateCall = { where: unknown; data: Record<string, unknown> };

function makeHarness(callerTenantId: string = TENANT) {
  const updates: UpdateCall[] = [];
  const statements: string[] = [];

  const prisma = {
    gradeLevel: {
      findUnique: async () => {
        statements.push('gradeLevel.findUnique');
        return {
          id: LEVEL_ID,
          tenantId: TENANT,
          schoolId: SCHOOL_ID,
          cycleId: CYCLE_ID,
          _count: { classSections: 0 },
        };
      },
      update: async (args: UpdateCall) => {
        statements.push('gradeLevel.update');
        updates.push(args);
        // La forme de la RÉPONSE est inchangée par la tranche (G-TRUTH) : le
        // handler rend la ligne Prisma, telle quelle.
        return { id: LEVEL_ID, tenantId: TENANT, schoolId: SCHOOL_ID, cycleId: CYCLE_ID };
      },
      delete: async () => {
        statements.push('gradeLevel.delete');
        return { id: LEVEL_ID };
      },
    },
    term: {
      findUnique: async () => {
        statements.push('term.findUnique');
        return { id: TERM_ID, tenantId: TENANT };
      },
      update: async (args: UpdateCall) => {
        statements.push('term.update');
        updates.push(args);
        return { id: TERM_ID, tenantId: TENANT };
      },
    },
  } as unknown as PrismaService;

  const users = {
    ensureUser: async () => {
      statements.push('user.ensure');
      return { id: ME, tenantId: callerTenantId };
    },
  } as unknown as UserSyncService;

  const ctx = {
    forTenant: async () => ({ schoolId: SCHOOL_ID }),
    forUser: async () => ({ schoolId: SCHOOL_ID, tenantId: callerTenantId }),
  } as unknown as SchoolContextService;

  return {
    updates,
    statements,
    cycles: new CyclesController(prisma, users, ctx),
    years: new AcademicYearsController(prisma, users, ctx),
  };
}

const JWT = { sub: ME, realm_access: { roles: ['school_admin'] } } as unknown as KeycloakJwtPayload;

type RouteArgEntry = { data?: unknown; pipes?: unknown[]; index?: number };
type RouteArgs = Record<string, RouteArgEntry>;

function routeArgs(ctor: unknown, method: string): RouteArgs {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA_KEY, ctor as object, method) as
    | RouteArgs
    | undefined;
  if (!args) throw new Error(`aucune métadonnée de route sur ${method} — le décorateur a disparu`);
  return args;
}

/** Les clés d'un décorateur de paramètre INTÉGRÉ : `"${paramtype}:${index}"`, deux entiers. */
const BUILTIN_KEY = /^\d+:\d+$/;

/**
 * Le code numérique du slot `@Body()` — DÉRIVÉ, jamais écrit en dur (FR-6).
 *
 * `RouteParamtypes` n'est pas réexporté par la racine `@nestjs/common`, et
 * écrire `3` en dur relierait ce fichier à un détail interne de Nest 10. On le
 * calibre donc sur un handler dont on SAIT qu'il ne porte qu'un seul décorateur
 * de paramètre intégré : `CyclesController.create(@Body(), @CurrentJwt())` —
 * `@CurrentJwt()` est un décorateur CUSTOM, dont la clé
 * (`<uid>__customRouteArgs__:<index>`) n'est pas numérique.
 *
 * C'est le garde-fou de l'erreur d'indexation la plus coûteuse ici :
 * `@CurrentJwt() jwt: KeycloakJwtPayload` reflète LUI AUSSI `Object` sur
 * presque tous les handlers de ces deux fichiers. Un bug d'index lirait donc un
 * `Object` parfaitement légitime et conclurait au défaut — ou, dans l'autre
 * sens, laisserait passer le vrai. On LIT le slot, on ne le compte pas.
 *
 * Un échec de calibration jette au CHARGEMENT : « impossible de savoir » n'est
 * jamais rapporté comme un PASS (DNC-08).
 */
const BODY_PARAMTYPE = (() => {
  const builtin = Object.keys(routeArgs(CyclesController, 'create')).filter((k) =>
    BUILTIN_KEY.test(k),
  );
  const [onlyKey] = builtin;
  // `builtin.length !== 1` ne RESTREINT pas `builtin[0]` sous
  // `noUncheckedIndexedAccess` : on lit le slot, puis on jette sur son absence.
  if (builtin.length !== 1 || onlyKey === undefined) {
    throw new Error(
      `calibration impossible : CyclesController.create porte ${builtin.length} décorateurs de ` +
        `paramètre intégrés (attendu : 1, son @Body()). Clés vues : ${builtin.join(', ')}`,
    );
  }
  return Number(onlyKey.split(':')[0]);
})();

/** L'index positionnel du paramètre `@Body()` du handler. */
function bodyParamIndex(ctor: unknown, method: string): number {
  const keys = Object.keys(routeArgs(ctor, method)).filter((k) =>
    k.startsWith(`${BODY_PARAMTYPE}:`),
  );
  const [onlyKey] = keys;
  // `expect(...).toHaveLength(1)` est un matcher, PAS une garde de type : il ne
  // restreint rien. Le `throw` en dessous est la garde réelle, et il jette au
  // lieu de rapporter un PASS (DNC-08).
  expect(keys).toHaveLength(1);
  if (onlyKey === undefined) {
    throw new Error(
      `aucun slot \`@Body()\` (paramtype ${BODY_PARAMTYPE}) sur ${method} — le décorateur a disparu`,
    );
  }
  return Number(onlyKey.split(':')[1]);
}

/** Le metatype RÉELLEMENT déclaré par la route pour son corps. */
function bodyMetatype(ctor: unknown, prototype: object, method: string): Type {
  const paramtypes = Reflect.getMetadata('design:paramtypes', prototype, method) as
    | unknown[]
    | undefined;
  if (!paramtypes) {
    throw new Error(
      `aucun \`design:paramtypes\` sur ${method} — \`emitDecoratorMetadata\` n'est pas actif ` +
        'sous ce runner, et TOUT ce fichier serait vert pour la pire des raisons.',
    );
  }
  return paramtypes[bodyParamIndex(ctor, method)] as Type;
}

/* ================================================================== *
 * 0 — CONTRÔLE POSITIF : le harnais mesure ce qu'il croit mesurer
 * ================================================================== */

describe('les métadonnées de décorateur SONT émises sous ce runner', () => {
  /**
   * Le défaut a été mesuré sur `dist/` (tsc) ; ces tests tournent sous ts-jest.
   * `ts-jest` lit `apps/api/tsconfig.json` → `@pilotage/tsconfig/node.json`, qui
   * pose `emitDecoratorMetadata: true`. Un futur passage à `@swc/jest` sans
   * `decoratorMetadata: true` rendrait `design:paramtypes` `undefined` PARTOUT.
   * Ce contrôle POSITIF est la seule assertion qui garde les autres honnêtes.
   */
  it('un corps DÉJÀ correct reflète sa vraie classe, pas `Object`', () => {
    const metatype = bodyMetatype(CyclesController, CyclesController.prototype, 'create');
    expect(metatype).not.toBe(Object);
    expect(metatype.name).toBe('CreateCycleDto');
  });

  it('le slot `@Body()` a été calibré, pas deviné', () => {
    expect(Number.isInteger(BODY_PARAMTYPE)).toBe(true);
    // `updateGradeLevel` porte `@Param` PUIS `@Body` PUIS `@CurrentJwt` : le
    // corps est en position 1, et c'est la calibration qui doit le dire.
    expect(bodyParamIndex(CyclesController, 'updateGradeLevel')).toBe(1);
  });
});

/* ================================================================== *
 * 1 — DÉFENSE 1 : le pipe global s'exécute enfin (AC-5)
 * ================================================================== */

describe('AC-5 (G-TENANT) — le VRAI ValidationPipe refuse les clés hostiles', () => {
  const pipe = new ValidationPipe({ ...GLOBAL_PIPE_OPTIONS });
  const metatype = () =>
    bodyMetatype(CyclesController, CyclesController.prototype, 'updateGradeLevel');

  it('le corps du PATCH est une CLASSE — c’est ce qui réarme le pipe', () => {
    // `Partial<GradeLevelDto>` s'effaçait ici en `Object`, et
    // `ValidationPipe.toValidate()` rend `false` pour `Object` : le pipe rendait
    // le corps BRUT. C'est le mécanisme, mesuré sur l'artefact livré, pas une
    // hypothèse.
    expect(metatype()).not.toBe(Object);
    expect(metatype().name).toBe('UpdateGradeLevelDto');
  });

  it.each(FORBIDDEN_SCALARS)(
    'rejette `%s` en 400 — `forbidNonWhitelisted` s’applique enfin',
    async (key) => {
      await expect(
        pipe.transform({ [key]: OTHER_TENANT }, { type: 'body', metatype: metatype() }),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('rejette un `orderIndex` chaîne — `enableImplicitConversion` n’est PAS activé', async () => {
    // Avant : la chaîne partait telle quelle vers une colonne `Int` et Prisma
    // rendait 500. Le gain est le CODE, pas le fait qu'« il y ait une erreur » —
    // une assertion « ça échoue » serait verte des deux côtés.
    await expect(
      pipe.transform({ orderIndex: '3' }, { type: 'body', metatype: metatype() }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejette un `name` de 41 caractères — la borne est celle de `GradeLevelDto`', async () => {
    await expect(
      pipe.transform({ name: 'x'.repeat(41) }, { type: 'body', metatype: metatype() }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepte un PATCH partiel légitime, et un PATCH VIDE (comportement INCHANGÉ)', async () => {
    // Épinglé exprès : `{}` traverse un DTO tout-`@IsOptional()`, atteint
    // `prisma.update` avec tous les champs `undefined` et rend 200. C'était déjà
    // le cas AVANT la tranche : ce n'est pas une régression, et c'est exactement
    // le genre de chose qu'un relecteur ultérieur « corrige » en 400 en cassant
    // un appelant.
    await expect(pipe.transform({}, { type: 'body', metatype: metatype() })).resolves.toBeDefined();
    await expect(
      pipe.transform({ name: 'Sixième', orderIndex: 1 }, { type: 'body', metatype: metatype() }),
    ).resolves.toMatchObject({ name: 'Sixième', orderIndex: 1 });
  });
});

/* ================================================================== *
 * 2 — DÉFENSE 2 : le field-pick tient MÊME SI la défense 1 disparaît (AC-4)
 * ================================================================== */

describe('AC-4 (G-TENANT, porteur) — l’ARGUMENT remis à Prisma, pas le statut HTTP', () => {
  it('un corps hostile appelé DIRECTEMENT n’émet que { code, name, orderIndex }', async () => {
    const h = makeHarness();
    // Appel DIRECT : la phase PIPE de Nest est court-circuitée. C'est le point —
    // c'est la simulation d'une régression de la défense 1, et la seule
    // situation où la défense 2 est la dernière ligne.
    const hostile = {
      tenantId: OTHER_TENANT,
      schoolId: OTHER_SCHOOL_ID,
      cycleId: OTHER_CYCLE_ID,
      id: 'ffffffff-0000-4000-8000-0000000000ff',
      createdAt: new Date(0),
      name: 'Niveau renommé',
    };

    await h.cycles.updateGradeLevel(LEVEL_ID, hostile as never, JWT);

    expect(h.updates).toHaveLength(1);
    const call = h.updates[0]!;
    // L'ENSEMBLE DES CLÉS, jamais une clé : `expect(data.tenantId).toBeUndefined()`
    // est vert sur `{ tenantId: undefined }` répandu par un `data: body`.
    const keys = Object.keys(call.data).sort();
    expect(keys).toEqual([...WRITABLE].sort());
    for (const forbidden of FORBIDDEN_SCALARS) expect(keys).not.toContain(forbidden);
    expect(call.data.name).toBe('Niveau renommé');
    expect(call.where).toEqual({ id: LEVEL_ID });
  });

  it('n’écrit RIEN quand le corps est vide — les trois champs restent `undefined`', async () => {
    const h = makeHarness();
    await h.cycles.updateGradeLevel(LEVEL_ID, {} as never, JWT);
    expect(h.updates).toHaveLength(1);
    const call = h.updates[0]!;
    expect(Object.keys(call.data).sort()).toEqual([...WRITABLE].sort());
    for (const field of WRITABLE) expect(call.data[field]).toBeUndefined();
  });

  it('la garde de tenant EXISTANTE est intacte — une ligne d’un autre tenant reste 404', async () => {
    // Le double n'applique AUCUN filtre : c'est le contrôleur, et lui seul, qui
    // compare `level.tenantId` à celui de l'appelant.
    const h = makeHarness(OTHER_TENANT);
    await expect(h.cycles.updateGradeLevel(LEVEL_ID, {} as never, JWT)).rejects.toThrow(
      NotFoundException,
    );
    expect(h.updates).toHaveLength(0);
  });
});

/* ================================================================== *
 * 3 — `updateTerm` : validation, et PAS d'affectation en masse (AC-6)
 * ================================================================== */

describe('AC-6 — le PATCH de trimestre refuse une date invalide AVANT Prisma', () => {
  const pipe = new ValidationPipe({ ...GLOBAL_PIPE_OPTIONS });
  const metatype = () =>
    bodyMetatype(AcademicYearsController, AcademicYearsController.prototype, 'updateTerm');

  it('le corps du PATCH est une CLASSE `UpdateTermDto`', () => {
    expect(metatype()).not.toBe(Object);
    expect(metatype().name).toBe('UpdateTermDto');
  });

  it('`{"startDate":"pas-une-date"}` → 400, et non `Invalid Date` → Prisma → 500', async () => {
    await expect(
      pipe.transform({ startDate: 'pas-une-date' }, { type: 'body', metatype: metatype() }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejette une clé inconnue — `forbidNonWhitelisted` s’applique aussi ici', async () => {
    await expect(
      pipe.transform({ tenantId: OTHER_TENANT }, { type: 'body', metatype: metatype() }),
    ).rejects.toThrow(BadRequestException);
  });

  it("`orderIndex` n'a PAS gagné de `@Min` — le POST n'en a pas non plus", async () => {
    // Resserrer ici ferait qu'un PATCH refuserait ce que le POST accepte :
    // `TermDto.orderIndex` porte `@IsInt()` seul. C'est une inconsistance
    // nouvelle, pas un durcissement.
    await expect(
      pipe.transform({ orderIndex: -1 }, { type: 'body', metatype: metatype() }),
    ).resolves.toMatchObject({ orderIndex: -1 });
  });

  it('le handler continue de FIELD-PICKER — cette moitié était DÉJÀ correcte et n’a pas bougé', async () => {
    // À dire précisément : ce site-ci n'a JAMAIS eu de trou d'affectation en
    // masse. Il ne validait rien ; il picorait déjà ses quatre champs.
    const h = makeHarness();
    await h.years.updateTerm(TERM_ID, { name: 'T1' } as never, JWT);
    expect(h.updates).toHaveLength(1);
    const call = h.updates[0]!;
    expect(Object.keys(call.data).sort()).toEqual(['endDate', 'name', 'orderIndex', 'startDate']);
    expect(call.data.name).toBe('T1');
  });

  it('PF-284 reste OUVERT — un PATCH à UN SEUL côté ne déclenche pas `assertDateOrder`', async () => {
    // Enregistré, PAS corrigé. `assertDateOrder` ne s'exécute que si les DEUX
    // dates sont présentes, donc un `endDate` antérieur au `startDate` STOCKÉ
    // passe. `@IsDateString()` ne peut pas le voir : un validateur par champ
    // n'a pas accès à la valeur stockée. La fermeture demande une
    // lecture-puis-comparaison côté handler — une autre tranche.
    const h = makeHarness();
    await expect(
      h.years.updateTerm(TERM_ID, { endDate: '1999-01-01' } as never, JWT),
    ).resolves.toBeDefined();
    expect(h.updates).toHaveLength(1);
  });
});

/* ================================================================== *
 * 4 — `ParseUUIDPipe` : les deux moitiés de la preuve (AC-7)
 * ================================================================== */

describe('AC-7 — `ParseUUIDPipe` monté, prouvé DEUX FOIS', () => {
  /**
   * Aucune des deux moitiés seule n'est une preuve honnête : un appel DIRECT au
   * handler court-circuite la phase PIPE (donc « le handler n'a rien lu » ne
   * prouve pas que le pipe existe), et des métadonnées ne prouvent pas que le
   * pipe refuse. Même idiome en deux temps qu'`S-E05-14`
   * (`enrollments.controller.ts:778`).
   */
  it('(a) le pipe refuse un id malformé, et AUCUNE instruction Prisma n’a lieu', async () => {
    const h = makeHarness();
    const pipe = new ParseUUIDPipe();
    await expect(pipe.transform('pas-un-uuid', { type: 'param', data: 'levelId' })).rejects.toThrow(
      BadRequestException,
    );
    expect(h.statements).toHaveLength(0);
  });

  it('(a bis) le pipe ACCEPTE un uuid v4, la version que `@default(uuid())` produit', async () => {
    const pipe = new ParseUUIDPipe();
    await expect(pipe.transform(LEVEL_ID, { type: 'param', data: 'levelId' })).resolves.toBe(
      LEVEL_ID,
    );
  });

  /**
   * Les SIX paramètres de chemin qui atteignent une colonne `@db.Uuid`. Le
   * brief en nomme cinq ; le sixième (`POST academic-years/:id/terms`) est le
   * MÊME défaut sur la route sœur, et le laisser dehors aurait créé une
   * asymétrie à l'intérieur du fichier qu'on est en train de réparer. Les deux
   * POST et les deux DELETE ont de VRAIS appelants de première partie
   * (`actions.ts:61/:71` et `:68/:78`) : leur surface d'erreur passe de
   * Prisma P2023 → 500 à un 400 du pipe. C'est un vrai changement de contrat,
   * il est dit plutôt que supposé invisible — et les quatre appelants envoient
   * déjà des uuid réels, donc aucun portail ne casse.
   */
  const PIPE_SITES: ReadonlyArray<[string, unknown, string, string]> = [
    ['CyclesController', CyclesController, 'createGradeLevel', 'id'],
    ['CyclesController', CyclesController, 'updateGradeLevel', 'levelId'],
    ['CyclesController', CyclesController, 'deleteGradeLevel', 'levelId'],
    ['AcademicYearsController', AcademicYearsController, 'createTerm', 'id'],
    ['AcademicYearsController', AcademicYearsController, 'updateTerm', 'termId'],
    ['AcademicYearsController', AcademicYearsController, 'deleteTerm', 'termId'],
  ];

  it.each(PIPE_SITES)('(b) %s.%s monte le pipe sur `:%s`', (_label, ctor, method, param) => {
    const entries = Object.values(routeArgs(ctor, method));
    const found = entries.find((e) => e.data === param);
    expect(found).toBeDefined();
    expect(found?.pipes ?? []).toContain(ParseUUIDPipe);
  });
});

/* ================================================================== *
 * 5 — ce que la tranche ne change PAS (AC-10, AC-11)
 * ================================================================== */

describe('AC-10 / AC-11 — permissions, gardes et formes de réponse INCHANGÉES', () => {
  /**
   * `{ prototype: object }`, jamais `{ prototype: Record<string, object> }` : un
   * VRAI prototype de classe n'a pas de signature d'index de chaîne, et la seule
   * façon de satisfaire cette annotation-là serait d'ajouter un
   * `[k: string]: object` AU CONTRÔLEUR — c'est-à-dire de déformer le code de
   * production pour plaire à son test. L'indexation dynamique est un fait du
   * test : elle est castée ICI, à son site d'appel.
   */
  const PERMISSION_SITES: ReadonlyArray<[string, { prototype: object }, string, string]> = [
    ['CyclesController', CyclesController, 'createGradeLevel', 'grade_levels.write'],
    ['CyclesController', CyclesController, 'updateGradeLevel', 'grade_levels.write'],
    ['CyclesController', CyclesController, 'deleteGradeLevel', 'grade_levels.write'],
    ['AcademicYearsController', AcademicYearsController, 'createTerm', 'terms.write'],
    ['AcademicYearsController', AcademicYearsController, 'updateTerm', 'terms.write'],
    ['AcademicYearsController', AcademicYearsController, 'deleteTerm', 'terms.write'],
  ];

  it.each(PERMISSION_SITES)('%s.%s exige toujours `%s`', (_label, ctor, method, permission) => {
    const handler = (ctor.prototype as Record<string, unknown>)[method];
    // Un handler absent rendrait `Reflect.getMetadata(k, undefined)` — et
    // « pas de méthode » se lirait comme « pas de permission ». On le dit.
    expect(typeof handler).toBe('function');
    expect(Reflect.getMetadata(PERMISSIONS_META_KEY, handler as object)).toEqual([permission]);
  });

  const CONTROLLERS: ReadonlyArray<[string, object]> = [
    ['CyclesController', CyclesController],
    ['AcademicYearsController', AcademicYearsController],
  ];

  it.each(CONTROLLERS)('%s porte toujours `JwtAuthGuard` et `PermissionsGuard`', (_label, ctor) => {
    const guards = (Reflect.getMetadata('__guards__', ctor) ?? []) as unknown[];
    expect(guards.map((g) => (g as { name?: string }).name)).toEqual(
      expect.arrayContaining(['JwtAuthGuard', 'PermissionsGuard']),
    );
  });

  it('G-TRUTH — `updateGradeLevel` rend toujours la ligne Prisma, telle quelle', async () => {
    const h = makeHarness();
    // La tranche change ce qui est ACCEPTÉ, jamais ce qui est RENDU.
    await expect(h.cycles.updateGradeLevel(LEVEL_ID, { name: 'X' } as never, JWT)).resolves.toEqual({
      id: LEVEL_ID,
      tenantId: TENANT,
      schoolId: SCHOOL_ID,
      cycleId: CYCLE_ID,
    });
  });

  it('G-TRUTH — `deleteGradeLevel` rend toujours `{ ok: true }`', async () => {
    const h = makeHarness();
    await expect(h.cycles.deleteGradeLevel(LEVEL_ID, JWT)).resolves.toEqual({ ok: true });
  });
});
