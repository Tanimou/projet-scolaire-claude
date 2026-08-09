import {
  UnknownTimezoneError,
  classifyAuditAction,
  classifyAuditResourceType,
  resolveAuditWindow,
} from '@pilotage/contracts';

import { generateAuditCsv, weakerVocabulary } from './audit-csv.generator';

/**
 * S-E04-4 — the WORKER half of G-TRUTH, and the only behavioural proof that the
 * regulator-facing artefact reads the one declaration.
 *
 * Why this file is here and not in `apps/api`: `apps/api` cannot import
 * `apps/worker`, so asserting the CSV from the api gate would be a fiction. The
 * api gate (`apps/api/src/shared/quality/audit-vocabulary-gate.spec.ts`) states
 * its worker half as TEXTUAL and points here — see its V-4 block. Both files are
 * executed by `node scripts/test-ratchet.js <app>`.
 *
 * What it pins, in order of what a regulator would notice first:
 *   1. the column set and its ORDER (a header is a contract);
 *   2. `action` / `resource_type` reproduced BYTE-FOR-BYTE — labels are extra
 *      columns, never a replacement (AC-4's posture applied to the export);
 *   3. an unknown code is present, visibly `unknown`, never filtered (DNC-08 in
 *      the artefact a DPO hands over);
 *   4. the labels are byte-identical to what the contracts resolver returns —
 *      the generator holds no copy of the vocabulary (AC-6).
 */

const TENANT = 'tenant-1';

interface Row {
  createdAt: Date;
  actorId: string | null;
  portal: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
}

/** The SAME fixture shape the api gate drives: canonical / legacy / unknown. */
const ROWS: Row[] = [
  {
    createdAt: new Date('2026-01-02T10:00:00.000Z'),
    actorId: 'u-1',
    portal: 'admin',
    action: 'role.delete',
    resourceType: 'role',
    resourceId: 'r-1',
    ipAddress: '10.0.0.1',
  },
  {
    createdAt: new Date('2026-01-01T09:00:00.000Z'),
    actorId: 'u-2',
    portal: 'admin',
    action: 'Suppression',
    resourceType: 'Résultats',
    resourceId: null,
    ipAddress: null,
  },
  {
    createdAt: new Date('2025-12-31T08:00:00.000Z'),
    actorId: null,
    // The fourth portal. No writer emits it today; the export must not choke
    // on it the day one does.
    portal: 'student',
    action: 'zz.not_a_real_code',
    resourceType: 'zz_unknown_type',
    resourceId: 'x-1',
    ipAddress: null,
  },
];

/** The tenant's reporting zone, as `Tenant.timezone` carries it (S-E04-5). */
const TENANT_ZONE = 'Europe/Paris';

function makeArgs(
  rows: Row[] = ROWS,
  opts: { parameters?: Record<string, unknown>; timezone?: string | null } = {},
): {
  args: Parameters<typeof generateAuditCsv>[0];
  findMany: jest.Mock;
  tenantFindUnique: jest.Mock;
} {
  const findMany = jest.fn().mockResolvedValue(rows);
  const timezone = opts.timezone === undefined ? TENANT_ZONE : opts.timezone;
  const tenantFindUnique = jest
    .fn()
    .mockResolvedValue(timezone === null ? null : { timezone });
  return {
    findMany,
    tenantFindUnique,
    args: {
      prisma: {
        auditLog: { findMany },
        tenant: { findUnique: tenantFindUnique },
      } as never,
      tenantId: TENANT,
      schoolId: null,
      parameters: opts.parameters ?? {},
    },
  };
}

async function csvLines(rows?: Row[]): Promise<{ text: string; lines: string[] }> {
  const { args } = makeArgs(rows);
  const result = await generateAuditCsv(args);
  const text = result.buffer.toString('utf-8');
  return { text, lines: text.split('\n') };
}

describe('generateAuditCsv — the DPO export reads the one declaration', () => {
  it('the header is the ten columns, in order, with the labels APPENDED beside the raw values', async () => {
    const { lines } = await csvLines();
    expect(lines[0]!.replace(/^\uFEFF/, '')).toBe(
      [
        'created_at',
        'actor_id',
        'portal',
        'action',
        'action_label',
        'resource_type',
        'resource_type_label',
        'vocabulary',
        'resource_id',
        'ip_address',
      ].join(','),
    );
  });

  it('opens correctly in French Excel — the file starts with a UTF-8 BOM', async () => {
    const { args } = makeArgs();
    const { buffer } = await generateAuditCsv(args);
    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);
  });

  it('stays tenant-scoped and bounded — no new query shape (G-TENANT untouched)', async () => {
    const { args, findMany } = makeArgs();
    await generateAuditCsv(args);
    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0]![0].where;
    expect(where.tenantId).toBe(TENANT);
    expect(findMany.mock.calls[0]![0].take).toBe(50_000);
  });

  it('a canonical row: raw value byte-for-byte, French label beside it, vocabulary=canonical', async () => {
    const { lines } = await csvLines();
    const cells = lines[1]!.split(',');
    expect(cells[3]).toBe('role.delete');
    expect(cells[4]).toBe(classifyAuditAction('role.delete').label);
    expect(cells[5]).toBe('role');
    expect(cells[6]).toBe(classifyAuditResourceType('role').label);
    expect(cells[7]).toBe('canonical');
    // The label is a real French label, not an echo of the code.
    expect(cells[4]).not.toBe('role.delete');
  });

  it('a legacy French row: NOT rewritten, NOT hidden, flagged legacy (AC-4)', async () => {
    const { lines } = await csvLines();
    const cells = lines[2]!.split(',');
    expect(cells[3]).toBe('Suppression');
    expect(cells[4]).toBe('Suppression');
    expect(cells[5]).toBe('Résultats');
    expect(cells[6]).toBe('Résultats');
    expect(cells[7]).toBe('legacy');
  });

  it('an unknown code is PRESENT, visibly unknown, and echoed verbatim (DNC-08)', async () => {
    const { text, lines } = await csvLines();
    // Three data rows in, three data rows out — nothing was filtered.
    expect(lines).toHaveLength(4);
    const cells = lines[3]!.split(',');
    expect(cells[3]).toBe('zz.not_a_real_code');
    expect(cells[4]).toBe('zz.not_a_real_code');
    expect(cells[6]).toBe('zz_unknown_type');
    expect(cells[7]).toBe('unknown');
    // …and no generic bucket was substituted anywhere in the file.
    for (const bucket of ['Inconnu', 'Autre', 'N/A']) {
      expect(text).not.toContain(bucket);
    }
  });

  it('the fourth portal survives the export untouched', async () => {
    const { lines } = await csvLines();
    expect(lines[3]!.split(',')[2]).toBe('student');
  });

  it('AC-6 — every label equals what the contracts resolver returns, row for row', async () => {
    const { lines } = await csvLines();
    for (let i = 0; i < ROWS.length; i++) {
      const row = ROWS[i]!;
      const cells = lines[i + 1]!.split(',');
      expect(cells[4]).toBe(classifyAuditAction(row.action).label);
      expect(cells[6]).toBe(classifyAuditResourceType(row.resourceType).label);
    }
  });

  it('CSV escaping still holds for a label or value containing a comma or a quote', async () => {
    const { lines } = await csvLines([
      {
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        actorId: 'u,3',
        portal: 'admin',
        action: 'code, with comma',
        resourceType: 'quote"inside',
        resourceId: null,
        ipAddress: null,
      },
    ]);
    expect(lines[1]).toContain('"u,3"');
    expect(lines[1]).toContain('"code, with comma"');
    expect(lines[1]).toContain('"quote""inside"');
  });

  it('an empty result still emits the header — never an empty file', async () => {
    const { lines } = await csvLines([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('action_label');
  });
});

/* ================================================================== *
 * S-E04-5 — the CSV and the screen answer the SAME filter
 * ================================================================== */

describe('generateAuditCsv — the day boundary is the tenant’s, and it is shared', () => {
  it('the `to` day is INCLUDED: an exclusive `lt` at midnight of the next Paris day', async () => {
    const { args, findMany } = makeArgs(ROWS, { parameters: { to: '2026-08-08' } });
    await generateAuditCsv(args);
    const where = findMany.mock.calls[0]![0].where;
    // Paris is UTC+2 on 8 August → the day ends at 2026-08-08T22:00:00Z.
    expect(where.createdAt.lt.toISOString()).toBe('2026-08-08T22:00:00.000Z');
    // The bound that shipped before was `lte: new Date('2026-08-08')`, i.e.
    // T00:00:00Z — the whole selected day missing from a regulator's file while
    // the table above it showed the rows. Pinned so it cannot come back.
    expect(where.createdAt.lte).toBeUndefined();
    expect(where.createdAt.lt.toISOString()).not.toBe('2026-08-08T00:00:00.000Z');
  });

  it('the `from` day starts at Paris midnight, not UTC midnight', async () => {
    const { args, findMany } = makeArgs(ROWS, { parameters: { from: '2026-08-08' } });
    await generateAuditCsv(args);
    const where = findMany.mock.calls[0]![0].where;
    expect(where.createdAt.gte.toISOString()).toBe('2026-08-07T22:00:00.000Z');
  });

  it('P0-5 — the worker resolves the SAME window the API resolves, from the same helper', async () => {
    const { args, findMany } = makeArgs(ROWS, {
      parameters: { from: '2026-08-01', to: '2026-08-09' },
    });
    await generateAuditCsv(args);
    const where = findMany.mock.calls[0]![0].where;
    const expected = resolveAuditWindow('2026-08-01', '2026-08-09', TENANT_ZONE);
    expect(where.createdAt.gte.toISOString()).toBe(expected.gte!.toISOString());
    expect(where.createdAt.lt.toISOString()).toBe(expected.lt!.toISOString());
  });

  it('an ISO datetime is read as its day — the export button may post either shape', async () => {
    const { args, findMany } = makeArgs(ROWS, {
      parameters: { to: '2026-08-08T14:00:00.000Z' },
    });
    await generateAuditCsv(args);
    expect(findMany.mock.calls[0]![0].where.createdAt.lt.toISOString()).toBe(
      '2026-08-08T22:00:00.000Z',
    );
  });

  it('the zone comes from the tenant row, never from the export parameters', async () => {
    const { args, findMany, tenantFindUnique } = makeArgs(ROWS, {
      // A caller-supplied zone must change nothing. Two DPOs exporting the same
      // filter must not receive two different files.
      parameters: { to: '2026-08-08', timezone: 'Pacific/Kiritimati' },
      timezone: 'Europe/Paris',
    });
    await generateAuditCsv(args);
    expect(tenantFindUnique).toHaveBeenCalledWith({
      where: { id: TENANT },
      select: { timezone: true },
    });
    expect(findMany.mock.calls[0]![0].where.createdAt.lt.toISOString()).toBe(
      '2026-08-08T22:00:00.000Z',
    );
  });

  it('a different tenant zone moves the boundary — the zone is load-bearing, not decorative', async () => {
    const { args, findMany } = makeArgs(ROWS, {
      parameters: { to: '2026-08-08' },
      timezone: 'Pacific/Kiritimati', // UTC+14
    });
    await generateAuditCsv(args);
    expect(findMany.mock.calls[0]![0].where.createdAt.lt.toISOString()).toBe(
      '2026-08-08T10:00:00.000Z',
    );
  });

  it('an unusable tenant zone FAILS the export — it never silently reverts to UTC', async () => {
    const { args } = makeArgs(ROWS, {
      parameters: { to: '2026-08-08' },
      timezone: 'Mars/Olympus_Mons',
    });
    await expect(generateAuditCsv(args)).rejects.toBeInstanceOf(UnknownTimezoneError);
  });

  it('a missing tenant row falls back to the column default, and still bounds by day', async () => {
    const { args, findMany } = makeArgs(ROWS, {
      parameters: { to: '2026-08-08' },
      timezone: null,
    });
    await generateAuditCsv(args);
    expect(findMany.mock.calls[0]![0].where.createdAt.lt.toISOString()).toBe(
      '2026-08-08T22:00:00.000Z',
    );
  });

  it('G-TENANT — the tenant predicate survives the new window code', async () => {
    const { args, findMany } = makeArgs(ROWS, {
      parameters: { from: '2026-08-01', to: '2026-08-09' },
    });
    await generateAuditCsv(args);
    expect(findMany.mock.calls[0]![0].where.tenantId).toBe(TENANT);
  });
});

describe('weakerVocabulary — a row is only as classified as its weakest axis', () => {
  it.each([
    ['canonical', 'canonical', 'canonical'],
    ['canonical', 'legacy', 'legacy'],
    ['legacy', 'canonical', 'legacy'],
    ['legacy', 'unknown', 'unknown'],
    ['unknown', 'canonical', 'unknown'],
    ['legacy', 'legacy', 'legacy'],
  ] as const)('(%s, %s) → %s', (a, b, expected) => {
    expect(weakerVocabulary(a, b)).toBe(expected);
  });
});
