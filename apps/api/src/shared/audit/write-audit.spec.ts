import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ts from 'typescript';

import type { PrismaService } from '../prisma/prisma.service';

import { NO_CLIENT_HINTS } from './client-hints';
import { deriveAuditProvenance } from './provenance';
import {
  AUDIT_WRITE_FAILED_MESSAGE,
  writeAudit,
  type AuditTransactionClient,
  type AuditWriteInput,
} from './write-audit';

/**
 * S-E04-6 — the seam's own proof (`ADR-035`, gates G-AUDIT / G-DNC).
 *
 * Three things are proven here and nowhere else:
 *
 *  1. **The brand is real.** `plan.md` §5 claimed a bare
 *     `Prisma.TransactionClient` first parameter already made
 *     `writeAudit(this.prisma, …)` a type error. It does not — `Omit` removes
 *     members, it does not forbid them, and TypeScript is structural. The
 *     `// @ts-expect-error` below is the artefact that decides it: if the brand is
 *     ever weakened back to a bare `TransactionClient`, the directive becomes
 *     unused and `pnpm typecheck` goes RED. A prose claim could not do that.
 *  2. **The row carries the provenance it was handed**, unchanged and
 *     un-reinvented.
 *  3. **DNC-10, structurally.** No env, no flag, no `skip`, and no call site in
 *     the whole API sits inside a `try` block — because a `try/catch` that
 *     downgrades a failed audit write to a warning is the bypass `ADR-035` D2
 *     forbids, wearing different clothes.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SELF_REL = 'apps/api/src/shared/audit/write-audit.ts';
const SELF_PATH = join(REPO_ROOT, SELF_REL);
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose (DNC-08): if the stripper disappears this suite must fail
// at LOAD rather than degrade into "nothing to check, therefore pass".
const { stripCommentsPreservingLines } = require(
  join(REPO_ROOT, 'scripts', 'link-integrity-check.js'),
) as { stripCommentsPreservingLines: (source: string) => string };
/* eslint-enable @typescript-eslint/no-require-imports */

const repoRel = (file: string): string => relative(REPO_ROOT, file).split(sep).join('/');

function walk(root: string, accept: (name: string) => boolean): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['node_modules', '.turbo', 'dist', 'coverage', '.next'].includes(entry.name)) continue;
        stack.push(join(current, entry.name));
      } else if (accept(entry.name)) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files.sort();
}

const PRODUCTION_FILES = walk(
  API_SRC,
  (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts'),
);

/* ================================================================== *
 * Harness — a transaction client that stages, and a store that only
 * absorbs the staging when the callback resolves
 * ================================================================== */

interface AuditRow {
  [key: string]: unknown;
}

function makeTx(faults: { audit?: Error } = {}) {
  const rows: AuditRow[] = [];
  const tx = {
    auditLog: {
      create: jest.fn(async (args: { data: AuditRow }) => {
        if (faults.audit) throw faults.audit;
        rows.push(args.data);
        return { id: 'audit-1', ...args.data };
      }),
    },
  };
  return { tx: tx as unknown as AuditTransactionClient, rows, create: tx.auditLog.create };
}

const PROVENANCE = deriveAuditProvenance(
  { sub: 'kc-1', realm_access: { roles: ['school_admin'] } } as never,
  { ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0 (probe)' },
);

const BASE: AuditWriteInput = {
  tenantId: 'tenant-1',
  actorId: 'user-profile-1',
  action: 'school.create',
  resourceType: 'school',
  resourceId: '11111111-2222-3333-4444-555555555555',
  provenance: PROVENANCE,
};

/* ================================================================== *
 * W-1 — the row it writes
 * ================================================================== */

describe('W-1 — writeAudit writes ONE row carrying exactly what it was handed', () => {
  it('flattens the provenance onto the row and invents nothing', async () => {
    const { tx, rows, create } = makeTx();
    await writeAudit(tx, BASE);

    expect(create).toHaveBeenCalledTimes(1);
    expect(rows[0]).toEqual({
      tenantId: 'tenant-1',
      actorId: 'user-profile-1',
      actorRole: 'school_admin',
      portal: 'admin',
      action: 'school.create',
      resourceType: 'school',
      resourceId: '11111111-2222-3333-4444-555555555555',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (probe)',
    });
  });

  it('an honestly blank provenance stays blank — never a fabricated value', async () => {
    const { tx, rows } = makeTx();
    await writeAudit(tx, {
      ...BASE,
      provenance: deriveAuditProvenance(
        { sub: 'kc-1', realm_access: { roles: [] } } as never,
        NO_CLIENT_HINTS,
      ),
    });
    expect(rows[0]).toMatchObject({
      actorRole: null,
      portal: null,
      ipAddress: null,
      userAgent: null,
    });
  });

  it('before/after are omitted when absent, so an untouched column is NULL and not `{}`', async () => {
    const { tx, rows } = makeTx();
    await writeAudit(tx, { ...BASE, after: { name: 'Collège Voltaire' } });
    expect(Object.keys(rows[0]!)).not.toContain('before');
    expect(rows[0]!.after).toEqual({ name: 'Collège Voltaire' });
  });

  it('a null resourceId is written as null — the @db.Uuid column never receives a composite', async () => {
    const { tx, rows } = makeTx();
    await writeAudit(tx, { ...BASE, resourceId: null });
    expect(rows[0]!.resourceId).toBeNull();
  });
});

/* ================================================================== *
 * W-2 (AC-2, direction ii) — the failure is re-thrown, never downgraded
 * ================================================================== */

describe('W-2 / AC-2 — a failed audit write FAILS the caller, in French', () => {
  it('re-throws as an InternalServerErrorException carrying an actionable message', async () => {
    const driverError = new Error('invalid input syntax for type inet: "a, b, c"');
    const { tx } = makeTx({ audit: driverError });

    await expect(writeAudit(tx, BASE)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('the raw driver message never reaches the operator — but is kept as `cause`', async () => {
    // `SchoolsManager.tsx` renders the API error string verbatim in a red inline
    // banner, so this message IS user interface copy even though no apps/web file
    // changes in this slice.
    const driverError = new Error('invalid input syntax for type inet: "a, b, c"');
    const { tx } = makeTx({ audit: driverError });

    const raised = await writeAudit(tx, BASE).catch((e: unknown) => e);
    const response = (raised as InternalServerErrorException).getResponse();
    const message = typeof response === 'string' ? response : (response as { message: string }).message;

    expect(message).toBe(AUDIT_WRITE_FAILED_MESSAGE);
    expect(message).not.toContain('inet');
    expect(message).not.toContain('syntax');
    expect((raised as Error).cause).toBe(driverError);
  });

  it('the message is French, actionable, and says the operation was cancelled', () => {
    expect(AUDIT_WRITE_FAILED_MESSAGE).toContain('annulée');
    expect(AUDIT_WRITE_FAILED_MESSAGE).toContain('audit');
    expect(AUDIT_WRITE_FAILED_MESSAGE).toContain('Réessayez');
  });
});

/* ================================================================== *
 * W-3 (AC-6) — the compile-time brand, decided by an artefact
 * ================================================================== */

/**
 * NEVER INVOKED. It exists to be type-checked.
 *
 * If `AuditTransactionClient` is ever weakened back to a bare
 * `Prisma.TransactionClient`, a full `PrismaService` becomes assignable again,
 * the error the directive expects disappears, and TypeScript reports the
 * `@ts-expect-error` itself as an error. That is the whole mechanism: the
 * invariant is decided by `pnpm typecheck`, in both directions, and not by this
 * comment.
 */
export async function brandNegativeControl(
  full: PrismaService,
  input: AuditWriteInput,
): Promise<void> {
  await writeAudit(
    // @ts-expect-error — AC-6: a full PrismaService/PrismaClient declares
    // `$transaction` and `$connect` as methods, which are not assignable to
    // `never`. `Prisma.TransactionClient` OMITS both, so the optional-never brand
    // accepts it and only it. Removing the brand makes THIS LINE the error.
    full,
    input,
  );
}

/** The positive half: a genuine transaction client still compiles. */
export async function brandPositiveControl(
  tx: Prisma.TransactionClient,
  input: AuditWriteInput,
): Promise<void> {
  await writeAudit(tx, input);
}

/* ================================================================== *
 * W-3b (S-E04-7 AC-6, PF-162) — the VOCABULARY is a compile-time
 * invariant too, and this control decides it in both directions
 * ================================================================== */

/**
 * NEVER INVOKED. Type-checked only, exactly like `brandNegativeControl`.
 *
 * `AuditWriteInput.action` is `AuditActionCode` and `.resourceType` is
 * `AuditResourceTypeCode` — unions derived from `AUDIT_ACTIONS` /
 * `AUDIT_RESOURCE_TYPES` in `packages/contracts`. The two directions:
 *
 *   • the union really is closed → the undeclared codes below are errors, the
 *     `@ts-expect-error` directives are satisfied, typecheck is green;
 *   • the union widens back to `string` — which is what it resolved to BEFORE
 *     this slice, because `: readonly AuditActionEntry[]` overrode the trailing
 *     `as const` and made `(typeof AUDIT_ACTIONS)[number]['code']` be `string` —
 *     then these errors vanish, TypeScript reports the `@ts-expect-error`
 *     directives as unused, and typecheck goes RED.
 *
 * That second direction is the whole point. PF-162 implemented over the old
 * annotation would have shipped green and inert: a named type forbidding nothing.
 */
export async function vocabularyNegativeControl(
  tx: Prisma.TransactionClient,
  base: Omit<AuditWriteInput, 'action' | 'resourceType'>,
): Promise<void> {
  await writeAudit(tx, {
    ...base,
    // @ts-expect-error — AC-6: 'role.definitely_not_declared' is in no row of
    // AUDIT_ACTIONS. If this line stops erroring, the action union widened.
    action: 'role.definitely_not_declared',
    resourceType: 'role',
  });
  await writeAudit(tx, {
    ...base,
    action: 'role.create',
    // @ts-expect-error — AC-6: same, for the resource-type union.
    resourceType: 'definitely_not_a_resource_type',
  });
  await writeAudit(tx, {
    ...base,
    // @ts-expect-error — AC-6 / ADR-037 D4: the LEGACY French aliases are
    // deliberately outside the union. Legacy rows are never rewritten and
    // nothing new may be written in that vocabulary, so emitting one is a
    // compile error rather than a review comment.
    action: 'Connexion',
    resourceType: 'role',
  });
}

/** The positive half: declared codes compile, so the union is not vacuously empty. */
export async function vocabularyPositiveControl(
  tx: Prisma.TransactionClient,
  base: Omit<AuditWriteInput, 'action' | 'resourceType'>,
): Promise<void> {
  await writeAudit(tx, { ...base, action: 'role.create', resourceType: 'role' });
  await writeAudit(tx, { ...base, action: 'user.invite', resourceType: 'user_profile' });
  await writeAudit(tx, {
    ...base,
    action: 'coefficient.upsert',
    resourceType: 'subject_coefficient',
  });
}

describe('W-3b / AC-6 — the audit vocabulary is enforced by the compiler (PF-162)', () => {
  it('both controls exist, so the typecheck gate really has something to decide', () => {
    expect(typeof vocabularyNegativeControl).toBe('function');
    expect(typeof vocabularyPositiveControl).toBe('function');
  });

  it('AuditWriteInput types action/resourceType to the contracts unions, not to string', () => {
    const source = stripCommentsPreservingLines(readFileSync(SELF_PATH, 'utf8'));
    expect(source).toMatch(/action:\s*AuditActionCode;/);
    expect(source).toMatch(/resourceType:\s*AuditResourceTypeCode;/);
    expect(source).not.toMatch(/action:\s*string;/);
    expect(source).not.toMatch(/resourceType:\s*string;/);
    // Imported from the ONE declaration, never re-declared locally (ADR-037 D1).
    expect(source).toMatch(/from '@pilotage\/contracts'/);
  });

  it('the contracts declaration uses `as const satisfies`, the form that keeps the union', () => {
    // The measured defect PF-162 names: `: readonly AuditActionEntry[] = [...] as const`
    // widens every element to the interface, so the derived union is `string`. An
    // edit reinstating the annotation makes THIS assertion red rather than making
    // the invariant quietly inert — the failure mode the union exists to prevent.
    const vocab = stripCommentsPreservingLines(
      readFileSync(join(REPO_ROOT, 'packages', 'contracts', 'src', 'audit', 'vocabulary.ts'), 'utf8'),
    );
    expect(vocab).toMatch(/export const AUDIT_ACTIONS = \[/);
    expect(vocab).toMatch(/export const AUDIT_RESOURCE_TYPES = \[/);
    expect(vocab).toMatch(/\] as const satisfies readonly AuditActionEntry\[\];/);
    expect(vocab).toMatch(/\] as const satisfies readonly AuditVocabularyEntry\[\];/);
    expect(vocab).not.toMatch(/AUDIT_ACTIONS:\s*readonly AuditActionEntry\[\]/);
    expect(vocab).not.toMatch(/AUDIT_RESOURCE_TYPES:\s*readonly AuditVocabularyEntry\[\]/);
    expect(vocab).toMatch(
      /export type AuditActionCode = \(typeof AUDIT_ACTIONS\)\[number\]\['code'\];/,
    );
    expect(vocab).toMatch(
      /export type AuditResourceTypeCode = \(typeof AUDIT_RESOURCE_TYPES\)\[number\]\['code'\];/,
    );
  });
});

describe('W-3 / AC-6 — the transaction-client brand is load-bearing, not decorative', () => {
  it('both controls exist, so the typecheck gate really has something to decide', () => {
    expect(typeof brandNegativeControl).toBe('function');
    expect(typeof brandPositiveControl).toBe('function');
  });

  it('the brand is spelled with BOTH deny-list members, not just one', () => {
    const source = stripCommentsPreservingLines(readFileSync(SELF_PATH, 'utf8'));
    expect(source).toMatch(/\$transaction\?:\s*never/);
    expect(source).toMatch(/\$connect\?:\s*never/);
    // And the first parameter really is the branded type — not the bare one that
    // the plan wrongly believed was sufficient.
    expect(source).toMatch(/writeAudit\(\s*tx: AuditTransactionClient,/);
  });

  it('this spec file carries the @ts-expect-error — deleting it is a visible deletion', () => {
    const self = readFileSync(join(__dirname, 'write-audit.spec.ts'), 'utf8');
    expect(self).toContain('@ts-expect-error');
  });
});

/* ================================================================== *
 * W-4 (AC-9 / G-DNC / DNC-10) — no off switch, and no swallowing
 * ================================================================== */

describe('W-4 / AC-9 / DNC-10 — there is no way to write the mutation without the row', () => {
  const source = (): string => stripCommentsPreservingLines(readFileSync(SELF_PATH, 'utf8'));

  it.each(['process.env', 'ConfigService', 'NODE_ENV', 'featureFlag', 'getFlag('])(
    'write-audit.ts contains no %s read',
    (needle) => {
      expect(source()).not.toContain(needle);
    },
  );

  it('AuditWriteInput has no skip/force/disable member', () => {
    const s = source();
    for (const member of ['skip', 'force', 'disable', 'bypass']) {
      expect(s).not.toMatch(new RegExp(`\\b${member}\\w*\\??:`, 'i'));
    }
  });

  it('the file performs the insert and nothing else — no sanitising, no second query', () => {
    const s = source();
    expect(s).not.toContain('sanitiseInetOrNull');
    expect(s).not.toContain('truncateUserAgent');
    expect(s).not.toContain('isIP');
    // Exactly one Prisma call, and it is on the TRANSACTION client.
    expect([...s.matchAll(/\btx\.\w+\.\w+\(/g)].map((m) => m[0])).toEqual(['tx.auditLog.create(']);
    expect(s).not.toMatch(/this\.prisma/);
  });

  it('the one catch in the file RE-THROWS — it is the opposite of a downgrade', () => {
    const s = source();
    expect(s).toMatch(/catch \(cause\) \{\s*throw new InternalServerErrorException/);
    // No branch may return normally out of the catch, and nothing may be logged
    // instead of thrown — that is precisely the DNC-10 bypass ADR-035 D2 forbids.
    const catchBody = /catch \(cause\) \{([\s\S]*?)\n {2}\}/.exec(s)?.[1] ?? '';
    expect(catchBody).not.toBe('');
    expect(catchBody).not.toMatch(/\breturn\b/);
    expect(catchBody).not.toMatch(/console\.(warn|error|log)/);
    expect(catchBody).not.toMatch(/logger/i);
  });

  it('AC-9 — no writeAudit CALL SITE in apps/api/src sits inside a try block', () => {
    // Stated over the AST, not over a regex: a `try {` several lines above a call
    // is invisible to a line-oriented match, and that is exactly the shape a
    // "let's not fail the mutation for an audit hiccup" patch would take.
    const offenders: string[] = [];
    let calls = 0;
    for (const file of PRODUCTION_FILES) {
      if (repoRel(file) === SELF_REL) continue;
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'writeAudit') {
          calls += 1;
          let n: ts.Node | undefined = node.parent;
          while (n?.parent) {
            if (ts.isTryStatement(n.parent) && n.parent.tryBlock === n) {
              offenders.push(`${repoRel(file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
              break;
            }
            n = n.parent;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
    // The vacuity guard: the walk found the real call sites, so `[]` above is a
    // measurement and not an empty scan.
    expect(calls).toBeGreaterThanOrEqual(10);
  });
});
