import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  PrismaService,
  TENANT_GUC,
  TenantContextError,
  assertTenantId,
  runWithTenant,
  type TenantTransactionRunner,
} from './prisma.service';

/**
 * S-E01-2 / PF-02 moitié (b) — le contexte tenant part en PARAMÈTRE LIÉ, refuse
 * en amont, et se relit.
 *
 * Aucun de ces tests n'a besoin d'une base : `runWithTenant` prend son client en
 * argument (même forme que `readMigrationState`), donc le faux client ci-dessous
 * suffit. Construire `PrismaService` exigerait un client généré et un
 * `DATABASE_URL` — c'est exactement ce qu'on évite.
 *
 * Le faux client implémente les QUATRE entrées SQL brutes, pas seulement
 * `$queryRaw`. C'est ce qui rend l'assertion « l'id n'apparaît dans aucun texte
 * SQL » non tautologique : avec un faux qui ne répond qu'à `$queryRaw`, le texte
 * inspecté serait par construction fait de littéraux de compilation, donc
 * l'assertion ne pourrait jamais échouer, et l'ancienne implémentation
 * (`$executeRawUnsafe` avec l'id interpolé) planterait sur une méthode absente —
 * un échec de FORME, pas de sécurité. Ici elle est enregistrée puis inspectée, et
 * elle échoue pour la bonne raison.
 */

type RawCall = { method: string; sql: string; params: unknown[] };

const VALID = '3f2b1c4d-5e6a-4b8c-9d0e-1f2a3b4c5d6e';
const VALID_UPPER = '3F2B1C4D-5E6A-4B8C-9D0E-1F2A3B4C5D6E';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const INJECTION = `x'; DROP TABLE "user"; --`;

function sqlOf(arg: unknown): string {
  // Un template balisé arrive en `TemplateStringsArray` (un tableau) : on
  // reconstitue le texte réellement émis en marquant les trous de liaison.
  return Array.isArray(arg) ? (arg as unknown[]).join('?') : String(arg);
}

function rawRecorder(log: RawCall[], reply: (call: RawCall) => unknown) {
  const record =
    (method: string) =>
    (arg0: unknown, ...rest: unknown[]) => {
      const call: RawCall = { method, sql: sqlOf(arg0), params: rest };
      log.push(call);
      return Promise.resolve(reply(call));
    };

  return {
    $queryRaw: record('$queryRaw'),
    $queryRawUnsafe: record('$queryRawUnsafe'),
    $executeRaw: record('$executeRaw'),
    $executeRawUnsafe: record('$executeRawUnsafe'),
  };
}

/**
 * Faux client. Le client RACINE et le client de TRANSACTION ont des journaux
 * séparés : `set_config(..., true)` est local à la transaction, donc une requête
 * émise sur la racine renverrait la bonne valeur puis s'évaporerait avant `fn`.
 * La relecture seule ne distingue pas ces deux mondes ; le journal racine vide,
 * si.
 */
function fakeClient(reply?: (call: RawCall) => unknown) {
  const rootLog: RawCall[] = [];
  const txLog: RawCall[] = [];
  const echo = reply ?? ((call: RawCall) => [{ applied: call.params[0] }]);
  const tx = rawRecorder(txLog, echo);
  let transactions = 0;

  const client = {
    ...rawRecorder(rootLog, echo),
    $transaction: async <R>(fn: (t: unknown) => Promise<R>): Promise<R> => {
      transactions += 1;
      return fn(tx);
    },
  };

  return {
    runner: client as unknown as TenantTransactionRunner,
    tx,
    rootLog,
    txLog,
    transactions: () => transactions,
  };
}

describe('assertTenantId — refus en amont, jamais d’assainissement (AC-2, AC-8, DNC-10)', () => {
  const REFUSED: [string, unknown][] = [
    ['la chaîne vide', ''],
    ['des espaces', '   '],
    ['un joker', '*'],
    ['un identifiant « système »', 'system'],
    ['un identifiant « default »', 'default'],
    ['public', 'public'],
    ['undefined', undefined],
    ['null', null],
    ['un nombre', 42],
    ['une chaîne quelconque', 'not-a-uuid'],
    ['la charge utile d’injection', INJECTION],
    ['un UUID emballé dans un tableau (coercition)', [VALID]],
    ['un objet dont toString rend un UUID (coercition)', { toString: () => VALID }],
    ['un UUID suivi d’un saut de ligne', VALID + '\n'],
    ['un UUID entre accolades (accepté par Postgres, pas ici)', '{' + VALID + '}'],
    ['un UUID sans tirets (accepté par Postgres, pas ici)', VALID.replace(/-/g, '')],
    ['un UUID préfixé par une injection', INJECTION + VALID],
  ];

  it.each(REFUSED)('refuse %s', (_label, value) => {
    expect(() => assertTenantId(value)).toThrow(TenantContextError);
  });

  const ACCEPTED: [string, string][] = [
    ['un UUID canonique', VALID],
    ['le même en majuscules — la casse n’est PAS normalisée', VALID_UPPER],
    ['l’UUID nul, qui est bien formé et n’est pas un cas particulier', NIL_UUID],
  ];

  it.each(ACCEPTED)('accepte %s et le rend inchangé', (_label, value) => {
    expect(assertTenantId(value)).toBe(value);
  });

  it('ne recopie jamais la valeur refusée dans le message', () => {
    // Le message finit dans les logs structurés et peut finir dans un corps 500 :
    // il nomme le motif et la forme, jamais le contenu.
    try {
      assertTenantId(INJECTION);
      throw new Error('aurait dû lever');
    } catch (error) {
      expect(error).toBeInstanceOf(TenantContextError);
      expect((error as Error).message).not.toContain(INJECTION);
      expect((error as Error).message).not.toContain('DROP');
    }
  });
});

describe('runWithTenant — la valeur est LIÉE, jamais écrite dans le SQL (AC-1, AC-5a)', () => {
  it('n’émet le tenant que comme paramètre, et sur le client de transaction', async () => {
    const fake = fakeClient();

    await runWithTenant(fake.runner, VALID, async () => 'ok');

    // (a) aucun texte SQL émis, par aucune des quatre entrées brutes, ne contient
    // l'id. C'est l'assertion qui aurait attrapé l'ancienne ligne interpolée.
    for (const call of [...fake.txLog, ...fake.rootLog]) {
      expect(call.sql).not.toContain(VALID);
    }

    expect(fake.txLog).toHaveLength(1);
    const call = fake.txLog[0] as RawCall;
    expect(call.method).toBe('$queryRaw');
    expect(call.params).toEqual([VALID]);
    expect(call.sql).toContain('set_config');
    expect(call.sql).toContain(TENANT_GUC);
    expect(call.sql).toContain('AS applied');

    // Le contexte est local à la transaction : rien ne doit partir sur la racine.
    expect(fake.rootLog).toHaveLength(0);
  });

  it('pose le réglage en portée TRANSACTION (`is_local = true`), jamais en portée session', async () => {
    // LA seule mutation d'un caractère qui fait fuiter des données entre tenants
    // en laissant les 56 autres tests verts.
    //
    // `set_config(name, value, is_local)` : avec `true` le réglage meurt au COMMIT
    // de la transaction ; avec `false` il vit sur la CONNEXION. Or Prisma rend la
    // connexion au pool après la transaction, donc en portée session le contexte
    // du tenant A reste posé sur une connexion que la requête SUIVANTE — celle du
    // tenant B — récupérera. C'est exactement la fuite cross-tenant que ce helper
    // existe pour empêcher, et c'est le pire mode de défaillance possible : aucune
    // erreur, aucune trace, des lignes du mauvais tenant rendues comme si de rien.
    //
    // Aucune assertion existante ne voit ce changement. Le faux client renvoie
    // `params[0]` quel que soit le troisième argument, donc la relecture (AC-3)
    // reste satisfaite ; `toContain('set_config')` et `toContain(TENANT_GUC)`
    // restent satisfaits ; le cliquet de source ne cherche que la forme
    // assignative `SET LOCAL x =`, qui n'apparaît pas ici. Le drapeau n'est
    // observable QUE dans le texte SQL émis — d'où cette assertion.
    //
    // On ne peut pas le prouver plus fort sans base : la portée réelle ne
    // s'observe qu'en relisant `current_setting` dans une SECONDE requête de la
    // même transaction, puis hors transaction. Ce test verrouille l'intention ;
    // la preuve d'exécution appartient à la story qui amène le premier appelant
    // et un Postgres (voir ADR-032, § Deferred).
    const fake = fakeClient();

    await runWithTenant(fake.runner, VALID, async () => 'ok');

    const { sql } = fake.txLog[0] as RawCall;

    // Le trou de liaison est marqué `?` par `sqlOf`. La forme entière est
    // asservie d'un coup : nom littéral, valeur liée, portée transaction.
    expect(sql).toMatch(/set_config\(\s*'app\.current_tenant_id'\s*,\s*\?\s*,\s*true\s*\)/);
    expect(sql).not.toMatch(/set_config\([^)]*,\s*false\s*\)/);
    // Le nom littéral doit rester CELUI qu'exporte le module : une divergence
    // entre ce helper et le futur prédicat de policy est indétectable et son
    // symptôme est « tout marche, rien n'est isolé » (ADR-032 D1).
    expect(sql).toContain("'" + TENANT_GUC + "'");
  });

  it('appelle `fn` exactement une fois, avec le client de TRANSACTION', async () => {
    const fake = fakeClient();
    const fn = jest.fn(async (_tx: unknown) => 0);

    const result = await runWithTenant(fake.runner, VALID, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    // Identité, pas « quelque chose de vrai » : `fn(this)` au lieu de `fn(tx)`
    // passerait un `toHaveBeenCalled()` nu.
    expect(fn.mock.calls[0]?.[0]).toBe(fake.tx);
    // Valeur FAUSSE volontairement : un `return result || fallback` deviendrait
    // rouge ici, alors qu'un `toBeTruthy()` l'aurait laissé passer.
    expect(result).toBe(0);
  });

  it('laisse passer une valeur `null` de retour sans la remplacer', async () => {
    const fake = fakeClient();

    await expect(runWithTenant(fake.runner, NIL_UUID, async () => null)).resolves.toBeNull();
  });
});

describe('runWithTenant — refus AVANT l’ouverture de la transaction (AC-2, AC-6)', () => {
  const REFUSED: [string, unknown][] = [
    ['la chaîne vide', ''],
    ['un non-string', 42],
    ['undefined', undefined],
    ['la charge utile d’injection', INJECTION],
  ];

  it.each(REFUSED)('%s : aucune transaction, aucune requête, aucun appel de `fn`', async (
    _label,
    value,
  ) => {
    const fake = fakeClient();
    const fn = jest.fn(async () => 'jamais');

    await expect(runWithTenant(fake.runner, value, fn)).rejects.toBeInstanceOf(TenantContextError);

    expect(fake.transactions()).toBe(0);
    expect(fake.txLog).toHaveLength(0);
    expect(fake.rootLog).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('runWithTenant — la relecture PROUVE l’application (AC-3)', () => {
  const BAD_READBACKS: [string, () => unknown][] = [
    ['un résultat vide', () => []],
    ['une valeur nulle', () => [{ applied: null }]],
    ['une colonne absente ou renommée', () => [{ set_config: VALID }]],
    ['une valeur non-string', () => [{ applied: 42 }]],
    ['un autre tenant', () => [{ applied: NIL_UUID }]],
    ['une réponse qui n’est pas un tableau', () => ({ applied: VALID })],
  ];

  it.each(BAD_READBACKS)('%s fait lever et `fn` n’est JAMAIS appelé', async (_label, reply) => {
    const fake = fakeClient(reply);
    const fn = jest.fn(async () => 'jamais');

    await expect(runWithTenant(fake.runner, VALID, fn)).rejects.toBeInstanceOf(TenantContextError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('compare strictement : une casse différente n’est pas la même valeur', async () => {
    const fake = fakeClient(() => [{ applied: VALID_UPPER }]);

    await expect(runWithTenant(fake.runner, VALID, async () => 'ok')).rejects.toBeInstanceOf(
      TenantContextError,
    );
  });
});

describe('PrismaService.withTenant délègue sans rien relâcher (AC-6)', () => {
  // On emprunte la méthode du prototype contre un stub minimal : construire
  // `PrismaService` construirait un vrai `PrismaClient`.
  const withTenant = PrismaService.prototype.withTenant as unknown as (
    this: unknown,
    tenantId: unknown,
    fn: (tx: unknown) => Promise<unknown>,
  ) => Promise<unknown>;

  const REFUSED: [string, unknown][] = [
    ['la chaîne vide', ''],
    ['un non-string', { toString: () => VALID }],
    ['la charge utile d’injection', INJECTION],
  ];

  it.each(REFUSED)('%s : `$transaction` n’est jamais appelé', async (_label, value) => {
    const transaction = jest.fn();
    const fn = jest.fn(async () => 'jamais');

    await expect(withTenant.call({ $transaction: transaction }, value, fn)).rejects.toBeInstanceOf(
      TenantContextError,
    );

    expect(transaction).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it('un id valide traverse jusqu’à `fn`', async () => {
    const fake = fakeClient();

    await expect(withTenant.call(fake.runner, VALID, async () => 'ok')).resolves.toBe('ok');
    expect(fake.transactions()).toBe(1);
  });
});

describe('Cliquet de source — l’interpolation ne peut pas revenir en silence (AC-7)', () => {
  // Mécanisé plutôt qu'observé à l'œil : un relecteur ne remarque pas de façon
  // fiable un `$executeRawUnsafe` réintroduit au milieu d'un fichier.
  const MODULES = readdirSync(__dirname)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .map((name) => ({ name, source: readFileSync(join(__dirname, name), 'utf8') }));

  /** Les backticks abondent dans les commentaires français : on les retire. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  /** Templates qui interpolent SANS être balisés par `$queryRaw` (donc liés). */
  function untaggedInterpolations(source: string): string[] {
    const found: string[] = [];
    const templates = /(\$queryRaw)?`([^`]*)`/g;
    let match: RegExpExecArray | null;

    while ((match = templates.exec(source)) !== null) {
      const body = match[2] ?? '';
      if (body.includes('${') && match[1] === undefined) found.push(body);
    }

    return found;
  }

  it('le répertoire expose bien les modules attendus', () => {
    expect(MODULES.map((m) => m.name)).toContain('prisma.service.ts');
  });

  for (const mod of MODULES) {
    describe(mod.name, () => {
      const CODE = stripComments(mod.source);

      it('n’utilise aucune entrée SQL brute non paramétrable', () => {
        // Coupé en deux pour que l'assertion ne se reconnaisse pas elle-même.
        expect(mod.source).not.toContain('RawUn' + 'safe');
      });

      it('ne pose plus le réglage par une forme assignative', () => {
        expect(mod.source).not.toMatch(/SET\s+LOCAL\s+[\w.]+\s*=/i);
      });

      it('n’interpole dans aucun texte SQL non balisé', () => {
        // Parité : si elle est impaire, le découpage a mal lu le fichier et
        // l'assertion suivante ne voudrait rien dire.
        expect((CODE.match(/`/g) ?? []).length % 2).toBe(0);
        expect(untaggedInterpolations(CODE)).toEqual([]);
      });

      it.each([
        ['un tenant « système »', 'SYSTEM_' + 'TENANT'],
        ['un drapeau SKIP_', 'SKIP' + '_'],
        ['un drapeau ALLOW_', 'ALLOW' + '_'],
        ['une option de contournement', 'skip' + 'Tenant'],
      ])('ne contient pas %s (DNC-10)', (_label, token) => {
        expect(mod.source).not.toContain(token);
      });
    });
  }

  it('le seul template interpolant du service est celui balisé `$queryRaw`', () => {
    const service = MODULES.find((m) => m.name === 'prisma.service.ts');
    const code = stripComments(service?.source ?? '');

    expect(code).toContain('$queryRaw`');
    expect(code).toContain(TENANT_GUC);
    expect(code).toContain('set_config');
  });

  it('les exports n’ont pas d’arité laissant place à un sac d’options (DNC-10)', () => {
    expect(assertTenantId.length).toBe(1);
    expect(runWithTenant.length).toBe(3);
  });
});
