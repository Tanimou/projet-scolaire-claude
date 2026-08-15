import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ServiceUnavailableException } from '@nestjs/common';

import {
  type AppRolePrismaService,
  type AppRoleProbeClient,
  probeAppRole,
} from './app-role-prisma.service';
import { type PrismaService, runWithTenant, TenantContextError } from './prisma.service';
import {
  APP_ROLE_REQUIRED_PRIVILEGES,
  type AppRoleProbe,
  appRoleVerdict,
  currentTenantScopeFrame,
  privilegeKey,
  readPoolSettings,
  TenantScopeError,
} from './tenant-scope';
import { TenantScopeService } from './tenant-scope.service';

/**
 * S-E01-1d — la couture de portée tenant, prouvée SANS base.
 *
 * CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PROUVE PAS. Il pilote la couture avec
 * des clients synthétiques : il démontre l'OPT-IN, l'imbrication, les trois états
 * de `DATABASE_URL_APP`, le verdict de sonde et l'absence de contournement. Il ne
 * démontre PAS que PostgreSQL refuse la ligne d'un autre tenant — ça, c'est la
 * preuve EXÉCUTÉE contre un vrai cluster comme `app_user` sur une base jetable
 * (AC-2), et aucune assertion d'ici ne doit être lue comme si elle en tenait
 * lieu. Un spec qui appelle le service directement peut être vert pendant que le
 * chemin HTTP est cassé ; c'est écrit ici pour que personne ne s'y trompe.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/** Le client de transaction synthétique que la fausse racine rend à `fn`. */
interface FakeTx {
  readonly id: number;
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * Une racine Prisma synthétique : elle compte ses `$transaction`, et sa
 * `$queryRaw` répond au `set_config` en RELISANT la valeur liée — exactement ce
 * qu'`applyTenantContext` exige, sans base.
 */
function fakeRunner() {
  const applied: string[] = [];
  let transactions = 0;
  let nextTxId = 0;

  const runner = {
    async $transaction<R>(fn: (tx: FakeTx) => Promise<R>): Promise<R> {
      transactions += 1;
      nextTxId += 1;
      const tx: FakeTx = {
        id: nextTxId,
        async $queryRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
          applied.push(String(values[0]));
          return [{ applied: values[0] }];
        },
      };
      return fn(tx);
    },
  };

  return {
    runner,
    applied: () => [...applied],
    transactions: () => transactions,
  };
}

/** Le service, câblé sur un propriétaire factice et un rôle applicatif factice. */
function buildScope(options: { appRoleRunner: unknown; refused?: boolean; state?: string }) {
  const owner = fakeRunner();

  const prisma = {
    // Même délégation que la vraie : la validation puis la transaction.
    withTenant<T>(tenantId: string, fn: (tx: FakeTx) => Promise<T>): Promise<T> {
      return runWithTenant(owner.runner, tenantId, fn);
    },
  };

  const appRole = {
    currentState: () =>
      options.state ?? (options.appRoleRunner === null ? 'degraded_no_app_url' : 'enforced'),
    currentRefusalReason: () => null,
    transactionRunnerOrNull: () => {
      if (options.refused === true) {
        throw new ServiceUnavailableException('refusé');
      }
      return options.appRoleRunner;
    },
  };

  const service = new TenantScopeService(
    prisma as unknown as PrismaService,
    appRole as unknown as AppRolePrismaService,
  );

  return { service, owner };
}

// ---------------------------------------------------------------------------
// AC-4 — la couture est OPT-IN, jamais ambiante
// ---------------------------------------------------------------------------

describe('AC-4 — opt-in, pas ambiant', () => {
  it('hors de toute portée, il n’y a AUCUN cadre et `current()` est undefined', () => {
    const app = fakeRunner();
    const { service } = buildScope({ appRoleRunner: app.runner });

    expect(currentTenantScopeFrame()).toBeUndefined();
    expect(service.current()).toBeUndefined();

    // Le simple fait d'avoir construit le service n'ouvre rien.
    expect(app.transactions()).toBe(0);
  });

  it('la portée est refermée à la sortie : `current()` redevient undefined', async () => {
    const app = fakeRunner();
    const { service } = buildScope({ appRoleRunner: app.runner });

    const seen = await service.run(TENANT_A, async () => service.current());

    expect(seen).toEqual({ tenantId: TENANT_A });
    expect(service.current()).toBeUndefined();
  });

  it('`current()` ne rend JAMAIS le client de transaction — la couture ne se traverse pas à rebours', async () => {
    const app = fakeRunner();
    const { service } = buildScope({ appRoleRunner: app.runner });

    const inside = await service.run(TENANT_A, async () => service.current());

    expect(Object.keys(inside ?? {})).toEqual(['tenantId']);
  });

  it('le `tx` arrive en PARAMÈTRE LEXICAL du callback', async () => {
    const app = fakeRunner();
    const { service } = buildScope({ appRoleRunner: app.runner });

    const received = await service.run(TENANT_A, async (tx) => typeof tx);

    expect(received).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// AC-1 / FR2 — le GUC est posé par le code EXISTANT, pas réimplémenté
// ---------------------------------------------------------------------------

describe('AC-1 / FR2 — `withTenant` / `runWithTenant` sont RÉUTILISÉS', () => {
  it('ouvrir une portée pose le contexte tenant sur la transaction du rôle applicatif', async () => {
    const app = fakeRunner();
    const { service, owner } = buildScope({ appRoleRunner: app.runner });

    await service.run(TENANT_A, async () => 'ok');

    expect(app.transactions()).toBe(1);
    expect(app.applied()).toEqual([TENANT_A]);
    // Le propriétaire n'a rien vu passer : c'est tout l'intérêt.
    expect(owner.transactions()).toBe(0);
  });

  it('un tenant mal formé est refusé AVANT toute transaction (état `missing/invalid context`, distinct du mode dégradé)', async () => {
    const app = fakeRunner();
    const { service } = buildScope({ appRoleRunner: app.runner });

    await expect(service.run('pas-un-uuid', async () => 'jamais')).rejects.toBeInstanceOf(
      TenantContextError,
    );
    expect(app.transactions()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — imbrication : réutilisation sur le même tenant, refus sur un autre
// ---------------------------------------------------------------------------

describe('AC-5 — portée imbriquée', () => {
  it('MÊME tenant : le `tx` existant est réutilisé et AUCUNE seconde transaction n’est ouverte', async () => {
    const app = fakeRunner();
    const { service } = buildScope({ appRoleRunner: app.runner });

    const same = await service.run(TENANT_A, async (outer) =>
      service.run(TENANT_A, async (inner) => inner === outer),
    );

    expect(same).toBe(true);
    // LA propriété : une seule transaction, donc une seule connexion, donc un
    // seul GUC posé. Une seconde transaction atterrirait sur une AUTRE connexion
    // du pool, où le contexte n'est pas posé.
    expect(app.transactions()).toBe(1);
    expect(app.applied()).toEqual([TENANT_A]);
  });

  it('AUTRE tenant : refus explicite qui NOMME les deux', async () => {
    const app = fakeRunner();
    const { service } = buildScope({ appRoleRunner: app.runner });

    const attempt = service.run(TENANT_A, async () => service.run(TENANT_B, async () => 'jamais'));

    await expect(attempt).rejects.toBeInstanceOf(TenantScopeError);
    await expect(attempt).rejects.toThrow(TENANT_A);
    await expect(attempt).rejects.toThrow(TENANT_B);
    expect(app.transactions()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — les TROIS états de `DATABASE_URL_APP`
// ---------------------------------------------------------------------------

describe('AC-3 — les trois états de DATABASE_URL_APP', () => {
  it('ABSENTE : la portée s’ouvre quand même, sur le PROPRIÉTAIRE, et l’état est nommé', async () => {
    const { service, owner } = buildScope({ appRoleRunner: null });

    await expect(service.run(TENANT_A, async () => 'ok')).resolves.toBe('ok');

    expect(owner.transactions()).toBe(1);
    expect(owner.applied()).toEqual([TENANT_A]);
    expect(service.state()).toBe('degraded_no_app_url');
  });

  it('DÉCLARÉE MAIS INUTILISABLE : on REFUSE, on ne se rabat PAS sur le propriétaire (DNC-08)', async () => {
    const { service, owner } = buildScope({ appRoleRunner: null, refused: true, state: 'refused_unusable' });

    await expect(service.run(TENANT_A, async () => 'jamais')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    // LE point : aucune transaction propriétaire n'a été ouverte. Un repli
    // silencieux serait exactement la forme que DNC-08 interdit.
    expect(owner.transactions()).toBe(0);
    expect(service.state()).toBe('refused_unusable');
  });

  it('DÉCLARÉE ET UTILISABLE : la portée s’ouvre sur le rôle applicatif', async () => {
    const app = fakeRunner();
    const { service, owner } = buildScope({ appRoleRunner: app.runner });

    await service.run(TENANT_A, async () => 'ok');

    expect(app.transactions()).toBe(1);
    expect(owner.transactions()).toBe(0);
    expect(service.state()).toBe('enforced');
  });
});

// ---------------------------------------------------------------------------
// DNC-10 — aucune variable ne rend une portée dégradée silencieuse ni une
// portée enforcée contournable
// ---------------------------------------------------------------------------

describe('DNC-10 — aucun contournement par variable d’environnement', () => {
  const BYPASS_SHAPED = [
    'TENANT_SCOPE_BYPASS',
    'DISABLE_TENANT_SCOPE',
    'PILOTAGE_RLS_OFF',
    'FORCE_OWNER_CONNECTION',
    'TENANT_SCOPE_DEV_MODE',
    'NODE_ENV',
  ];

  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of BYPASS_SHAPED) {
      saved.set(key, process.env[key]);
      process.env[key] = key === 'NODE_ENV' ? 'production' : '1';
    }
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it('les six variables posées ne changent RIEN au mode dégradé', async () => {
    const { service, owner } = buildScope({ appRoleRunner: null });

    await service.run(TENANT_A, async () => 'ok');

    expect(owner.transactions()).toBe(1);
    expect(owner.applied()).toEqual([TENANT_A]);
  });

  it('les six variables posées ne contournent PAS une portée enforcée', async () => {
    const app = fakeRunner();
    const { service, owner } = buildScope({ appRoleRunner: app.runner });

    await service.run(TENANT_A, async () => 'ok');

    expect(app.transactions()).toBe(1);
    expect(app.applied()).toEqual([TENANT_A]);
    expect(owner.transactions()).toBe(0);
  });

  it('les six variables posées ne rendent pas un tenant invalide acceptable', async () => {
    const app = fakeRunner();
    const { service } = buildScope({ appRoleRunner: app.runner });

    await expect(service.run('', async () => 'jamais')).rejects.toBeInstanceOf(TenantContextError);
    expect(app.transactions()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// La SONDE — un état inclassable n'est jamais un vert
// ---------------------------------------------------------------------------

describe('sonde du rôle applicatif — le verdict est une fonction pure', () => {
  function healthyProbe(overrides: Partial<AppRoleProbe> = {}): AppRoleProbe {
    const privileges: Record<string, boolean> = {};
    for (const requirement of APP_ROLE_REQUIRED_PRIVILEGES) {
      privileges[privilegeKey(requirement.table, requirement.privilege)] = true;
    }
    return {
      currentUser: 'app_user',
      tableOwner: 'pilotage',
      bypassRls: false,
      memberOfOwner: false,
      privileges,
      ...overrides,
    };
  }

  it('le CONTRÔLE POSITIF : une connexion saine est déclarée enforçante', () => {
    expect(appRoleVerdict(healthyProbe())).toEqual({ enforcing: true, reason: null });
  });

  it('le PROPRIÉTAIRE déguisé en rôle applicatif est REFUSÉ', () => {
    const verdict = appRoleVerdict(healthyProbe({ currentUser: 'pilotage' }));
    expect(verdict.enforcing).toBe(false);
    expect(verdict.reason).toContain('PROPRIÉTAIRE');
  });

  it('BYPASSRLS est REFUSÉ', () => {
    const verdict = appRoleVerdict(healthyProbe({ bypassRls: true }));
    expect(verdict.enforcing).toBe(false);
    expect(verdict.reason).toContain('BYPASSRLS');
  });

  it('l’appartenance au propriétaire est REFUSÉE (les privilèges s’héritent)', () => {
    const verdict = appRoleVerdict(healthyProbe({ memberOfOwner: true }));
    expect(verdict.enforcing).toBe(false);
    expect(verdict.reason).toContain('membre du propriétaire');
  });

  it('CONNECTABLE MAIS NON ACCORDÉ est REFUSÉ — le cas du cluster où `app_user` est né après la migration', () => {
    const verdict = appRoleVerdict(healthyProbe({ privileges: {} }));
    expect(verdict.enforcing).toBe(false);
    expect(verdict.reason).toContain('calendar_event.SELECT');
    expect(verdict.reason).toContain('permission denied');
  });

  it('la CLÔTURE RELATIONNELLE compte : `enrollment` ou un `include` manquant refuse aussi', () => {
    for (const table of ['enrollment', 'cycle', 'grade_level', 'class_section']) {
      const privileges: Record<string, boolean> = {};
      for (const requirement of APP_ROLE_REQUIRED_PRIVILEGES) {
        privileges[privilegeKey(requirement.table, requirement.privilege)] =
          requirement.table !== table;
      }
      const verdict = appRoleVerdict(healthyProbe({ privileges }));
      expect(verdict.enforcing).toBe(false);
      expect(verdict.reason).toContain(table);
    }
  });

  it('un propriétaire illisible est INCLASSABLE, donc refusé (DNC-08)', () => {
    const verdict = appRoleVerdict(healthyProbe({ tableOwner: null }));
    expect(verdict.enforcing).toBe(false);
    expect(verdict.reason).toContain('DNC-08');
  });

  it('`probeAppRole` sur une connexion vide rend un état FAIL-CLOSED', async () => {
    const client: AppRoleProbeClient = { $queryRaw: async () => [] };
    const probe = await probeAppRole(client);

    expect(probe.currentUser).toBeNull();
    expect(probe.bypassRls).toBe(true);
    expect(probe.memberOfOwner).toBe(true);
    expect(appRoleVerdict(probe).enforcing).toBe(false);
  });

  it('`probeAppRole` mappe la matrice de privilèges par table et par verbe', async () => {
    let call = 0;
    const client: AppRoleProbeClient = {
      async $queryRaw() {
        call += 1;
        if (call === 1) {
          return [
            {
              current_user_name: 'app_user',
              table_owner: 'pilotage',
              bypass_rls: false,
              member_of_owner: false,
            },
          ];
        }
        return APP_ROLE_REQUIRED_PRIVILEGES.map((requirement) => ({
          table_name: requirement.table,
          privilege: requirement.privilege,
          held: true,
        }));
      },
    };

    const probe = await probeAppRole(client);
    expect(appRoleVerdict(probe)).toEqual({ enforcing: true, reason: null });
  });
});

// ---------------------------------------------------------------------------
// Le pool est LU, jamais composé
// ---------------------------------------------------------------------------

describe('réglage de pool — lecture seule', () => {
  it('lit `connection_limit` et `pool_timeout` quand ils sont déclarés', () => {
    expect(readPoolSettings('postgres:x?schema=public&connection_limit=5&pool_timeout=10')).toEqual({
      connectionLimit: 5,
      poolTimeout: 10,
    });
  });

  it('rend `null` plutôt qu’un défaut — aucune valeur n’est inventée', () => {
    expect(readPoolSettings('postgres:x?schema=public')).toEqual({
      connectionLimit: null,
      poolTimeout: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Cliquets de source — les propriétés qu'un test de comportement ne voit pas
// ---------------------------------------------------------------------------

describe('cliquets de source de la couture', () => {
  const SEAM = ['tenant-scope.ts', 'tenant-scope.service.ts', 'app-role-prisma.service.ts'];

  function sourceOf(name: string): string {
    return readFileSync(join(__dirname, name), 'utf8');
  }

  /** Les commentaires PARLENT des contournements ; le CODE ne doit pas les porter. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  it('le code de la couture ne lit AUCUNE variable d’environnement hors DATABASE_URL_APP (DNC-10)', () => {
    const reads: string[] = [];
    for (const name of SEAM) {
      for (const match of stripComments(sourceOf(name)).matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        reads.push(match[1]);
      }
    }
    expect(reads).toEqual(['DATABASE_URL_APP']);
  });

  it('le code de la couture ne branche sur AUCUN `NODE_ENV`', () => {
    for (const name of SEAM) {
      expect(stripComments(sourceOf(name))).not.toContain('NODE_ENV');
    }
  });

  it('la couture ne réimplémente NI `set_config` NI le prédicat des policies (ADR-032 §D1–§D3)', () => {
    for (const name of ['tenant-scope.ts', 'tenant-scope.service.ts']) {
      expect(stripComments(sourceOf(name))).not.toContain('set_config');
    }
    // …et elle passe bien par le helper existant, plutôt qu'en recopiant le SQL.
    const service = stripComments(sourceOf('tenant-scope.service.ts'));
    expect(service).toContain('.withTenant(');
    expect(service).toContain('runWithTenant(');
  });

  it('aucune chaîne de connexion n’est COMPOSÉE : l’URL part verbatim dans `datasourceUrl`', () => {
    const code = stripComments(sourceOf('app-role-prisma.service.ts'));
    expect(code).toContain('datasourceUrl: declared');
    // L'URL n'est jamais concaténée, ni normalisée, ni reconstruite : du code
    // capable de composer une chaîne de connexion peut composer le mauvais RÔLE.
    expect(code).not.toContain('declared +');
    expect(code).not.toContain('+ declared');
    expect(code).not.toContain('declared.replace');
    expect(code).not.toContain('new URL(');
    // …et surtout, jamais une réécriture de la connexion du PROPRIÉTAIRE.
    expect(code).not.toContain('process.env.DATABASE_URL;');
  });

  it('le second client est DISTINCT de `PrismaService` — sinon `onModuleInit` connecterait le propriétaire deux fois', () => {
    const code = stripComments(sourceOf('app-role-prisma.service.ts'));
    expect(code).not.toContain('extends PrismaService');
    expect(code).not.toContain('extends PrismaClient');
    expect(code).toContain('$disconnect()');
  });

  it('le contrôleur calendrier n’a plus AUCUN site d’appel non porté, et le seed reste dehors', () => {
    const controller = readFileSync(
      join(__dirname, '..', '..', 'modules', 'calendar', 'calendar.controller.ts'),
      'utf8',
    );
    const code = stripComments(controller);
    // Les sept sites convertis émettent sur `tx`, jamais sur le service racine.
    expect(code).not.toContain('this.prisma.');
    expect((code.match(/this\.scope\.run\(/g) ?? []).length).toBe(4);
    // 6 sites `calendar_event` + 1 site `enrollment` = les SEPT sites convertis.
    expect((code.match(/\btx\.calendarEvent\./g) ?? []).length).toBe(6);
    expect((code.match(/\btx\.enrollment\./g) ?? []).length).toBe(1);
    // La garde applicative est CONSERVÉE (défense en profondeur).
    expect((code.match(/throw new NotFoundException\(\)/g) ?? []).length).toBe(2);
    // Le seed reste sur le service, hors portée, et l'exclusion est NOMMÉE.
    expect(code).toContain('this.seed.seedFrenchHolidays(');
    expect(controller).toContain('DÉLIBÉRÉMENT HORS DE LA PORTÉE TENANT');
    // P2025 -> 404 : le plancher base et la garde applicative restent
    // extérieurement indiscernables (pas d'oracle d'existence).
    expect(code).toContain("error.code === 'P2025'");
  });

  it('`calendarVisibilityWhere` est intacte — G-AUTHZ ne dépend pas de la couture', () => {
    const controller = readFileSync(
      join(__dirname, '..', '..', 'modules', 'calendar', 'calendar.controller.ts'),
      'utf8',
    );
    expect(controller).toContain('export function calendarVisibilityWhere(');
    expect(controller).toContain('const isAdmin =');
    // Le filtre `tenantId` explicite reste dans chaque `where` : RLS est un
    // PLANCHER, pas un remplacement du filtre applicatif.
    expect(controller).toContain('const where: Record<string, unknown> = { tenantId, schoolId };');
  });
});
