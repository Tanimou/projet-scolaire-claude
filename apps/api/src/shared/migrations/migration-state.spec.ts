import { MigrationPreflightError, assertMigrationsClean } from './migration-preflight';
import { readMigrationState } from './migration-state';

/**
 * S-E02-1 / PF-03 — le preflight doit REFUSER tout schéma non vérifié.
 *
 * Ces tests n'ont pas besoin d'une vraie base : `readMigrationState` ne dépend
 * que de `$queryRawUnsafe`, qu'on simule pour reproduire chaque état réel
 * observé (base non baselinée, migration en attente, migration échouée, propre).
 */

type RawFn = (sql: string) => Promise<unknown>;

/** Faux PrismaClient : ne répond qu'à $queryRawUnsafe. */
function fakePrisma(handler: RawFn) {
  return { $queryRawUnsafe: (sql: string) => handler(sql) } as never;
}

const LEDGER_PRESENT = /to_regclass/;

function prismaWith(options: {
  ledgerPresent: boolean;
  rows?: { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[];
}) {
  return fakePrisma(async (sql: string) => {
    if (LEDGER_PRESENT.test(sql)) return [{ present: options.ledgerPresent }];
    return options.rows ?? [];
  });
}

const silentLogger = { log: () => undefined, warn: () => undefined } as never;

describe('readMigrationState', () => {
  const OLD_ENV = process.env.PRISMA_MIGRATIONS_DIR;

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.PRISMA_MIGRATIONS_DIR;
    else process.env.PRISMA_MIGRATIONS_DIR = OLD_ENV;
  });

  it('signale `unbaselined` quand _prisma_migrations est absente', async () => {
    const state = await readMigrationState(prismaWith({ ledgerPresent: false }));

    expect(state.status).toBe('unbaselined');
    expect(state.schemaVersion).toBeNull();
    expect(state.shipped).toContain('0_baseline');
  });

  it('signale `pending` quand une migration livrée n’est pas appliquée', async () => {
    const state = await readMigrationState(prismaWith({ ledgerPresent: true, rows: [] }));

    expect(state.status).toBe('pending');
    expect(state.pending).toContain('0_baseline');
  });

  it('signale `failed` quand une migration a été rollback', async () => {
    const state = await readMigrationState(
      prismaWith({
        ledgerPresent: true,
        rows: [
          { migration_name: '0_baseline', finished_at: new Date(), rolled_back_at: new Date() },
        ],
      }),
    );

    expect(state.status).toBe('failed');
    expect(state.failed).toContain('0_baseline');
  });

  it('signale `clean` et expose la version de schéma quand tout est appliqué', async () => {
    const state = await readMigrationState(
      prismaWith({
        ledgerPresent: true,
        rows: [{ migration_name: '0_baseline', finished_at: new Date(), rolled_back_at: null }],
      }),
    );

    expect(state.status).toBe('clean');
    expect(state.schemaVersion).toBe('0_baseline');
    expect(state.pending).toHaveLength(0);
  });

  it('refuse un dossier de migrations vide plutôt que de le lire comme « rien à faire »', async () => {
    process.env.PRISMA_MIGRATIONS_DIR = __dirname; // aucun sous-dossier migration.sql
    const state = await readMigrationState(prismaWith({ ledgerPresent: true }));

    expect(state.status).toBe('no-migrations-shipped');
  });
});

describe('assertMigrationsClean', () => {
  const OLD_NODE_ENV = process.env.NODE_ENV;
  const OLD_FLAG = process.env.MIGRATION_PREFLIGHT;

  afterEach(() => {
    process.env.NODE_ENV = OLD_NODE_ENV;
    if (OLD_FLAG === undefined) delete process.env.MIGRATION_PREFLIGHT;
    else process.env.MIGRATION_PREFLIGHT = OLD_FLAG;
  });

  it('lève quand la base n’est pas baselinée (AC3 — refus de servir)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MIGRATION_PREFLIGHT;

    await expect(
      assertMigrationsClean(prismaWith({ ledgerPresent: false }), silentLogger),
    ).rejects.toBeInstanceOf(MigrationPreflightError);
  });

  it('lève quand une migration est en attente (AC3)', async () => {
    process.env.NODE_ENV = 'production';

    await expect(
      assertMigrationsClean(prismaWith({ ledgerPresent: true, rows: [] }), silentLogger),
    ).rejects.toBeInstanceOf(MigrationPreflightError);
  });

  it('IGNORE MIGRATION_PREFLIGHT=off en production (DNC-10 — pas de bypass)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.MIGRATION_PREFLIGHT = 'off';

    await expect(
      assertMigrationsClean(prismaWith({ ledgerPresent: false }), silentLogger),
    ).rejects.toBeInstanceOf(MigrationPreflightError);
  });

  it('honore MIGRATION_PREFLIGHT=off hors production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.MIGRATION_PREFLIGHT = 'off';

    await expect(
      assertMigrationsClean(prismaWith({ ledgerPresent: false }), silentLogger),
    ).resolves.toBeNull();
  });

  it('passe quand toutes les migrations sont appliquées', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MIGRATION_PREFLIGHT;

    const state = await assertMigrationsClean(
      prismaWith({
        ledgerPresent: true,
        rows: [{ migration_name: '0_baseline', finished_at: new Date(), rolled_back_at: null }],
      }),
      silentLogger,
    );

    expect(state?.status).toBe('clean');
  });
});
