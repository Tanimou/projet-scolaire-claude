import {
  classifyAuditAction,
  classifyAuditResourceType,
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

function makeArgs(rows: Row[] = ROWS): {
  args: Parameters<typeof generateAuditCsv>[0];
  findMany: jest.Mock;
} {
  const findMany = jest.fn().mockResolvedValue(rows);
  return {
    findMany,
    args: {
      prisma: { auditLog: { findMany } } as never,
      tenantId: TENANT,
      schoolId: null,
      parameters: {},
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
