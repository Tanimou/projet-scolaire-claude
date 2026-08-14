import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { ForbiddenException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service';

import type { KeycloakJwtPayload } from './jwt.strategy';
import {
  UNPROVISIONED_USER_CODE,
  UNPROVISIONED_USER_MESSAGE,
  UnprovisionedUserError,
  UserSyncService,
} from './user-sync.service';

/**
 * S-E01-1a — la couture identité résout une tenancy, elle n'en invente plus
 * (`PF-01` moitié (a), P0 · G-TENANT, G-AUTHZ, G-AUDIT, G-PORTAL, G-DNC).
 *
 * L'ARTEFACT QUI MANQUAIT
 * -----------------------
 * `user-sync.service.ts` n'avait **aucun spec**, alors que ~242 sites d'appel
 * lisent `me.tenantId` de sa sortie : l'origine de la tenancy de toute l'API
 * n'était pas testée. Mesuré au début de cette story, et c'est la raison pour
 * laquelle la suppression de la branche de création pouvait s'écrire sans qu'un
 * seul test change de couleur.
 *
 * POURQUOI CHAQUE CAS ÉCHOUE CONTRE LE SERVICE D'AVANT (« fails before »)
 * ----------------------------------------------------------------------
 * Seul le test-architect lance la chaîne d'outils, donc l'échec pré-correctif est
 * rendu DÉRIVABLE PAR LECTURE. Le faux client fournit délibérément `findFirst`,
 * `tenant.upsert`, `tenant.create` et `userProfile.create` — c'est-à-dire tout ce
 * dont l'ANCIENNE branche avait besoin pour aller **jusqu'au bout avec succès**.
 * Un faux qui aurait omis ces méthodes aurait fait échouer T-1 sur un
 * `TypeError`, ce qui prouve seulement que le faux est incomplet ; ici T-1 échoue
 * sur ce qui compte : le service ne lève pas, et le RELEVÉ D'APPELS montre
 * `tenant.upsert` puis `userProfile.create`.
 *
 * LE CONTRÔLE POSITIF N'EST PAS DÉCORATIF
 * ---------------------------------------
 * T-2 est la seule chose qui empêche toute cette suite d'être verte sur un
 * service qui refuserait TOUT — l'inversion la plus facile à commettre ici. Il
 * assère la tenancy rendue contre `TENANT_VOLTAIRE`, et explicitement contre
 * `TENANT_INVENTED` (ce que le faux `tenant.upsert` rendrait), pour qu'aucune
 * valeur par défaut du fixture ne puisse le rendre vert.
 */

const TENANT_VOLTAIRE = 'tenant-voltaire-demo';
const TENANT_AUTRE_ECOLE = 'tenant-college-x';
/** Ce que le faux `tenant.upsert` rend : la tenancy que la connexion INVENTAIT. */
const TENANT_INVENTED = 'tenant-invented-by-login';

const SUB = 'kc-sub-of-the-caller';
const SUB_AUTRE = 'kc-sub-of-somebody-else';
const EMAIL = 'admin@pilotage.local';

interface ProfileRow {
  id: string;
  tenantId: string;
  email: string;
  authProviderId: string | null;
}

interface Fake {
  service: UserSyncService;
  calls: string[];
  tenant: { upsert: jest.Mock; create: jest.Mock };
  userProfile: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
  rows: () => ProfileRow[];
}

/**
 * Faux client Prisma à RELEVÉ D'APPELS. `calls` conserve l'ordre, ce qui rend
 * lisible « aucune écriture n'a été émise » comme une propriété de la séquence
 * entière et pas seulement comme trois compteurs à zéro.
 */
function makeFake(seed: ProfileRow[], overrides: Partial<{ findUniqueThrows: Error }> = {}): Fake {
  const store: ProfileRow[] = seed.map((r) => ({ ...r }));
  const calls: string[] = [];

  const userProfile = {
    findUnique: jest.fn(async ({ where }: { where: { authProviderId?: string } }) => {
      calls.push('userProfile.findUnique');
      if (overrides.findUniqueThrows) throw overrides.findUniqueThrows;
      return store.find((r) => r.authProviderId === where.authProviderId) ?? null;
    }),
    // Fourni EXPRÈS bien que le service corrigé ne l'appelle plus : c'est ce qui
    // permet à l'ancienne branche de linking de fonctionner, donc à T-1 d'échouer
    // sur les compteurs d'écriture plutôt que sur une méthode absente.
    findFirst: jest.fn(async ({ where }: { where: { email: string } }) => {
      calls.push('userProfile.findFirst');
      return store.find((r) => r.email === where.email) ?? null;
    }),
    findMany: jest.fn(async ({ where, take }: { where: { email: string }; take?: number }) => {
      calls.push('userProfile.findMany');
      const hits = store.filter((r) => r.email === where.email);
      return typeof take === 'number' ? hits.slice(0, take) : hits;
    }),
    update: jest.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<ProfileRow> }) => {
        calls.push('userProfile.update');
        const row = store.find((r) => r.id === where.id);
        if (!row) throw new Error(`fake: no profile ${where.id}`);
        Object.assign(row, data);
        return { ...row };
      },
    ),
    create: jest.fn(async ({ data }: { data: Partial<ProfileRow> }) => {
      calls.push('userProfile.create');
      const row: ProfileRow = {
        id: `created-${store.length}`,
        tenantId: data.tenantId ?? TENANT_INVENTED,
        email: data.email ?? '',
        authProviderId: data.authProviderId ?? null,
      };
      store.push(row);
      return { ...row };
    }),
  };

  const tenant = {
    upsert: jest.fn(async () => {
      calls.push('tenant.upsert');
      return { id: TENANT_INVENTED, slug: 'demo' };
    }),
    create: jest.fn(async () => {
      calls.push('tenant.create');
      return { id: TENANT_INVENTED, slug: 'demo' };
    }),
  };

  const prisma = { userProfile, tenant } as unknown as PrismaService;

  return {
    service: new UserSyncService(prisma),
    calls,
    tenant,
    userProfile,
    rows: () => store.map((r) => ({ ...r })),
  };
}

function jwt(overrides: Partial<KeycloakJwtPayload> = {}): KeycloakJwtPayload {
  return { sub: SUB, email: EMAIL, ...overrides };
}

async function failureOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected ensureUser to refuse, and it resolved');
}

/** Les trois écritures qu'un refus ne doit JAMAIS émettre. */
function expectNoProvisioningWrite(fake: Fake): void {
  expect(fake.tenant.upsert).toHaveBeenCalledTimes(0);
  expect(fake.tenant.create).toHaveBeenCalledTimes(0);
  expect(fake.userProfile.create).toHaveBeenCalledTimes(0);
  expect(fake.calls).not.toContain('tenant.upsert');
  expect(fake.calls).not.toContain('tenant.create');
  expect(fake.calls).not.toContain('userProfile.create');
}

describe('AC-1 / G-TENANT — un sujet non provisionné est REFUSÉ, et rien n’est écrit', () => {
  it('T-1 — sub inconnu ET email inconnu → UnprovisionedUserError, zéro écriture', async () => {
    const fake = makeFake([{ id: 'p-1', tenantId: TENANT_AUTRE_ECOLE, email: 'someone@else.fr', authProviderId: 'kc-other' }]);

    const err = await failureOf(fake.service.ensureUser(jwt()));

    expect(err).toBeInstanceOf(UnprovisionedUserError);
    expectNoProvisioningWrite(fake);
    // Le relevé complet : QUE des lectures. Une écriture de n'importe quelle
    // forme, même future et non nommée ci-dessus, apparaîtrait ici.
    expect(fake.calls).toEqual(['userProfile.findUnique', 'userProfile.findMany']);
    expect(fake.rows()).toHaveLength(1);
  });

  it('T-1b — un jeton SANS email n’émet même pas la seconde lecture', async () => {
    const fake = makeFake([]);

    const err = await failureOf(
      fake.service.ensureUser({ sub: SUB } as KeycloakJwtPayload),
    );

    expect(err).toBeInstanceOf(UnprovisionedUserError);
    expect(fake.calls).toEqual(['userProfile.findUnique']);
    expectNoProvisioningWrite(fake);
  });

  it('T-1c — le refus est un 403 portant la copie française et le code machine', async () => {
    const fake = makeFake([]);

    const err = (await failureOf(fake.service.ensureUser(jwt()))) as UnprovisionedUserError;

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getStatus()).toBe(403);
    expect(err.name).toBe('UnprovisionedUserError');

    const body = err.getResponse() as { message: string; code: string };
    // `message` doit rester une CHAÎNE : le web rend `body.message` directement.
    expect(typeof body.message).toBe('string');
    expect(body.message).toBe(UNPROVISIONED_USER_MESSAGE);
    expect(body.code).toBe(UNPROVISIONED_USER_CODE);
    expect(body.code).toBe('ACCOUNT_NOT_PROVISIONED');
    expect(err.message).toBe(UNPROVISIONED_USER_MESSAGE);

    // La copie ne nomme aucun interne et ne révèle aucune existence.
    for (const leak of ['UserProfile', 'Tenant', 'tenant', 'demo', 'voltaire', SUB, EMAIL]) {
      expect(body.message).not.toContain(leak);
    }
    // Apostrophe droite, jamais la typographique — elle ne doit pas atteindre le fil.
    expect(body.message).not.toContain('’');
    expect(body.message).toContain("Contactez l'administrateur");
  });
});

describe('AC-2 — CONTRÔLE POSITIF : un sujet provisionné résout, et rend SA tenancy', () => {
  it('T-2 — profil trouvé par authProviderId → aucune levée, tenantId = celui du profil', async () => {
    const fake = makeFake([
      { id: 'p-admin', tenantId: TENANT_VOLTAIRE, email: EMAIL, authProviderId: SUB },
    ]);

    const me = await fake.service.ensureUser(jwt());

    expect(me.id).toBe('p-admin');
    expect(me.tenantId).toBe(TENANT_VOLTAIRE);
    // La valeur assérée n'est PAS le défaut du fixture : si le service inventait
    // encore une tenancy, il rendrait `TENANT_INVENTED`.
    expect(me.tenantId).not.toBe(TENANT_INVENTED);
    expect(fake.calls).toEqual(['userProfile.findUnique']);
    expectNoProvisioningWrite(fake);
    expect(fake.userProfile.update).toHaveBeenCalledTimes(0);
  });
});

describe('AC-3 / G-PORTAL — la branche d’adoption par email ADOPTE toujours', () => {
  // Exactement la forme du compte élève démo (`seed-demo.ts:1506-1514`) et des
  // trois identités du realm : profil semé SANS `authProviderId`, parce que
  // `infra/keycloak/realm-export.json` ne déclare aucun `id` pour ses users —
  // Keycloak frappe l'UUID à l'import. Après cette story, c'est l'UNIQUE chemin
  // de résolution des quatre connexions de démo.
  it('T-3 — sub manque, email touche, profil non lié → update({ authProviderId: sub }) et adoption', async () => {
    const fake = makeFake([
      { id: 'p-seeded', tenantId: TENANT_VOLTAIRE, email: EMAIL, authProviderId: null },
    ]);

    const me = await fake.service.ensureUser(jwt());

    expect(fake.userProfile.update).toHaveBeenCalledTimes(1);
    expect(fake.userProfile.update).toHaveBeenCalledWith({
      where: { id: 'p-seeded' },
      data: { authProviderId: SUB },
    });
    expect(me.id).toBe('p-seeded');
    expect(me.tenantId).toBe(TENANT_VOLTAIRE);
    expect(me.authProviderId).toBe(SUB);
    expectNoProvisioningWrite(fake);
    expect(fake.calls).toEqual([
      'userProfile.findUnique',
      'userProfile.findMany',
      'userProfile.update',
    ]);
  });

  it('T-3b — l’email du jeton est comparé en minuscules, et `preferred_username` sert de repli', async () => {
    const fake = makeFake([
      { id: 'p-seeded', tenantId: TENANT_VOLTAIRE, email: EMAIL, authProviderId: null },
    ]);

    const me = await fake.service.ensureUser({
      sub: SUB,
      preferred_username: EMAIL.toUpperCase(),
    } as KeycloakJwtPayload);

    expect(me.id).toBe('p-seeded');
    expect(fake.userProfile.findMany).toHaveBeenCalledWith({ where: { email: EMAIL }, take: 2 });
  });
});

describe('G-TENANT — l’adoption ne choisit JAMAIS une ligne arbitraire (PF-186 amont)', () => {
  // `email` n'est unique que PAR tenant (`schema.prisma:879`) : un `findFirst`
  // rendrait ici une ligne arbitraire, dans un ordre non spécifié, et lierait
  // `authProviderId` DÉFINITIVEMENT (unique global, `schema.prisma:838`). Sans ce
  // cas, la story remplacerait « tenancy par constante » par « tenancy par ligne
  // arbitraire ».
  it('T-4 — la même adresse dans DEUX tenants → refus, aucune écriture, aucun update', async () => {
    const fake = makeFake([
      { id: 'p-a', tenantId: TENANT_VOLTAIRE, email: EMAIL, authProviderId: null },
      { id: 'p-b', tenantId: TENANT_AUTRE_ECOLE, email: EMAIL, authProviderId: null },
    ]);

    const err = await failureOf(fake.service.ensureUser(jwt()));

    expect(err).toBeInstanceOf(UnprovisionedUserError);
    expect(fake.userProfile.update).toHaveBeenCalledTimes(0);
    expectNoProvisioningWrite(fake);
    expect(fake.rows().every((r) => r.authProviderId === null)).toBe(true);
  });

  // Prise de contrôle + verrouillage de la victime : la ligne est DÉJÀ liée au
  // sujet A. L'écraser volerait l'identité de A, et A — qui manquerait alors son
  // `findUnique` — serait désormais refusé au lieu d'être re-provisionné.
  it('T-5 — un email déjà lié à un AUTRE sujet n’est pas réattribué : refus', async () => {
    const fake = makeFake([
      { id: 'p-a', tenantId: TENANT_VOLTAIRE, email: EMAIL, authProviderId: SUB_AUTRE },
    ]);

    const err = await failureOf(fake.service.ensureUser(jwt({ sub: SUB })));

    expect(err).toBeInstanceOf(UnprovisionedUserError);
    expect(fake.userProfile.update).toHaveBeenCalledTimes(0);
    expectNoProvisioningWrite(fake);
    const [victim] = fake.rows();
    expect(victim?.authProviderId).toBe(SUB_AUTRE);
  });
});

describe('Aucun oracle d’énumération, et aucun fail-open déguisé', () => {
  it('T-6 — les trois formes de refus rendent le MÊME statut, le MÊME code et la MÊME phrase', async () => {
    const cases: Array<[string, Fake]> = [
      ['no-match', makeFake([])],
      [
        'ambiguous',
        makeFake([
          { id: 'p-a', tenantId: TENANT_VOLTAIRE, email: EMAIL, authProviderId: null },
          { id: 'p-b', tenantId: TENANT_AUTRE_ECOLE, email: EMAIL, authProviderId: null },
        ]),
      ],
      [
        'bound-elsewhere',
        makeFake([
          { id: 'p-a', tenantId: TENANT_VOLTAIRE, email: EMAIL, authProviderId: SUB_AUTRE },
        ]),
      ],
    ];

    const shapes: string[] = [];
    for (const [, fake] of cases) {
      const err = (await failureOf(fake.service.ensureUser(jwt()))) as UnprovisionedUserError;
      const body = err.getResponse() as { message: string; code: string };
      shapes.push(`${err.getStatus()}|${body.code}|${body.message}`);
    }

    expect(new Set(shapes).size).toBe(1);
    expect(shapes[0]).toBe(`403|${UNPROVISIONED_USER_CODE}|${UNPROVISIONED_USER_MESSAGE}`);
  });

  // Une panne de base ne doit JAMAIS devenir « vous n'êtes rattaché à aucun
  // établissement » : ce serait un fail-open déguisé, qui masque en plus
  // l'incident. Piloté, pas assuré par revue : les lectures ne sont pas
  // enveloppées d'un try/catch, donc l'erreur remonte telle quelle.
  it('T-7 — une erreur de base REMONTE, elle ne devient pas un refus', async () => {
    const fake = makeFake([], { findUniqueThrows: new Error('db down') });

    const err = await failureOf(fake.service.ensureUser(jwt()));

    expect(err).not.toBeInstanceOf(UnprovisionedUserError);
    expect(err).not.toBeInstanceOf(ForbiddenException);
    expect((err as Error).message).toBe('db down');
    expectNoProvisioningWrite(fake);
  });
});

/* eslint-disable @typescript-eslint/no-require-imports */
// Non gardé, délibérément (DNC-08) : si le stripper disparaît, cette suite doit
// tomber au CHARGEMENT plutôt que de se dégrader en « rien à vérifier, donc
// vert ». Même posture que `shared/quality/audit-provenance-gate.spec.ts:140`.
const { stripCommentsPreservingLines } = require(
  resolve(__dirname, '..', '..', '..', '..', '..', 'scripts', 'link-integrity-check.js'),
) as { stripCommentsPreservingLines: (source: string) => string };
/* eslint-enable @typescript-eslint/no-require-imports */

const API_SRC = resolve(__dirname, '..', '..');
/**
 * Reconstruit par CONCATÉNATION : ce fichier ne doit pas contenir le jeton qu'il
 * cherche, sinon le ratchet échouerait sur lui-même (piège (a) du pré-mortem).
 * L'exclusion de `__filename` plus bas est la seconde ceinture — les deux, parce
 * qu'un futur éditeur qui recollerait le littéral ici ne doit pas rendre le
 * garde-fou rouge par accident.
 */
const DEMO_SLUG_TOKEN = 'DEMO_TENANT' + '_SLUG';
const REGISTER_REL = 'modules/identity/register.controller.ts';

function walk(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['node_modules', '.turbo', 'dist', 'coverage'].includes(entry.name)) continue;
        stack.push(join(current, entry.name));
      } else if (entry.name.endsWith('.ts')) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files.sort();
}

const API_FILES = walk(API_SRC);
const srcRel = (file: string): string => relative(API_SRC, file).split(sep).join('/');

describe('AC-4 / DNC-10 — le ratchet : la constante `demo` ne survit QUE dans la moitié différée', () => {
  // PLANCHER DE NON-VACUITÉ, d'abord : un glob cassé rendrait zéro fichier et le
  // test deviendrait vert en ne prouvant rien (piège (b)). Les chemins sont
  // résolus depuis `__dirname`, jamais `process.cwd()` (piège (c)).
  it('le scan a effectivement lu l’arbre : au moins 100 fichiers, dont register.controller.ts', () => {
    expect(API_FILES.length).toBeGreaterThanOrEqual(100);
    const rels = API_FILES.map(srcRel);
    expect(rels).toContain(REGISTER_REL);
    expect(rels).toContain('shared/auth/user-sync.service.ts');
    expect(readFileSync(join(API_SRC, REGISTER_REL), 'utf8').length).toBeGreaterThan(0);
  });

  it('la constante n’apparaît QUE dans register.controller.ts — ensemble EXACT, pas « aucun ailleurs »', () => {
    const hits = API_FILES.filter(
      (file) => file !== __filename && readFileSync(file, 'utf8').includes(DEMO_SLUG_TOKEN),
    ).map(srcRel);

    // Ensemble exact : « aucune correspondance hors register » resterait vert si
    // register lui-même perdait la sienne, c'est-à-dire si la moitié (b) était
    // fermée sans que la traçabilité le sache.
    expect(hits).toEqual([REGISTER_REL]);
  });
});

describe('DNC-10 — la couture identité ne peut plus créer de tenant, et n’a pas d’interrupteur', () => {
  const SERVICE_PATH = join(API_SRC, 'shared', 'auth', 'user-sync.service.ts');
  // Commentaires RETIRÉS avant toute recherche : ce fichier EXPLIQUE longuement
  // pourquoi il ne contient plus `tenant.upsert` et pourquoi aucun
  // `ALLOW_AUTO_PROVISION` n'y entrera. Un grep brut virerait au rouge sur la
  // documentation du correctif (`PF-83`). Le stripper est conscient des chaînes.
  const SOURCE = stripCommentsPreservingLines(readFileSync(SERVICE_PATH, 'utf8'));

  it('le fichier est bien lu et non vide (plancher de non-vacuité)', () => {
    expect(SOURCE.length).toBeGreaterThan(500);
    expect(SOURCE).toContain('class UserSyncService');
    expect(SOURCE).toContain('ensureUser');
  });

  it.each([
    ['un appel tenant.*', 'tenant' + '.'],
    ['une lecture d’environnement', 'process' + '.env'],
    ['NODE_ENV', 'NODE_' + 'ENV'],
    ['un drapeau ALLOW_', 'ALLOW' + '_'],
    ['un drapeau SKIP_', 'SKIP' + '_'],
    ['ConfigService', 'ConfigService'],
    ['le slug demo', "'demo'"],
    ['findFirst (ligne arbitraire)', 'findFirst'],
  ])('le code exécutable ne contient pas %s', (_label, token) => {
    expect(SOURCE).not.toContain(token);
  });

  it('le refus est le même en développement qu’en production : rien ne le module', async () => {
    // Piloté, pas assuré : le service ne lit aucun environnement, donc le même
    // appel refuse à l'identique quel que soit `NODE_ENV`.
    const fake = makeFake([]);
    await expect(fake.service.ensureUser(jwt())).rejects.toBeInstanceOf(UnprovisionedUserError);
  });
});
