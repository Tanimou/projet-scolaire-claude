import {
  CSV_INJECTION_TRIGGERS,
  CSV_NEUTRALISER,
  UnknownTimezoneError,
  classifyAuditAction,
  classifyAuditResourceType,
  neutraliseCsvCell,
  resolveAuditWindow,
} from '@pilotage/contracts';

import { csvEscape, generateAuditCsv, weakerVocabulary } from './audit-csv.generator';

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

/**
 * S-E04-11 / PF-140 (i) — **the ten columns that may never move.**
 *
 * A downstream parser keys on position. `action_label` / `resource_type_label` /
 * `vocabulary` were once inserted MID-header and pushed `resource_id` and
 * `ip_address` from 5-6 to 8-9 with no acceptance criterion asking; the exact-
 * string header pin that already existed in this file did NOT stop it, because
 * the author edited the code and that pin in the same commit. A pin an author
 * edits in lockstep is not a ratchet.
 *
 * So the guard is expressed TWICE, with two different failure messages: this
 * prefix (positions are the contract) and the full header (the column set).
 * « You moved a column » and « you added a column » must not look like one
 * failure.
 */
const FROZEN_PREFIX_V1 = [
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
] as const;

/** Appended by S-E04-11 — a new column goes at the END, never in the middle. */
const APPENDED_V2 = ['action_vocabulary', 'resource_type_vocabulary'] as const;

/** The header cells, BOM stripped. */
function headerCells(line: string): string[] {
  return line.replace(/^\uFEFF/, '').split(',');
}

describe('generateAuditCsv — the DPO export reads the one declaration', () => {
  it('the FROZEN PREFIX keeps its positions — indices 0..9 may never move', async () => {
    const { lines } = await csvLines();
    const header = headerCells(lines[0]!);
    // PF-140(i): moving any of these is a breaking change for every downstream
    // parser, and it must fail HERE rather than be discovered by a regulator.
    expect(header.slice(0, FROZEN_PREFIX_V1.length)).toEqual([...FROZEN_PREFIX_V1]);
    // The two columns that actually moved last time, pinned BY INDEX with the
    // reason attached — a test that merely mirrors the code is not a ratchet.
    expect(header.indexOf('resource_id')).toBe(8);
    expect(header.indexOf('ip_address')).toBe(9);
  });

  it('the column set is the frozen prefix PLUS the appended pair — nothing else', async () => {
    const { lines } = await csvLines();
    expect(headerCells(lines[0]!)).toEqual([...FROZEN_PREFIX_V1, ...APPENDED_V2]);
  });

  it('every data row is exactly as wide as the header — the drift with no symptom', async () => {
    // The row builder is a SECOND list. PF-140(i) was a header and a row edited
    // together; a row that drifts from its header shifts every value silently.
    const { lines } = await csvLines();
    const width = headerCells(lines[0]!).length;
    expect(width).toBe(FROZEN_PREFIX_V1.length + APPENDED_V2.length);
    for (let i = 1; i < lines.length; i++) {
      expect({ row: i, cells: lines[i]!.split(',').length }).toEqual({ row: i, cells: width });
    }
  });

  it('the header is the twelve columns, in order, with the labels APPENDED beside the raw values', async () => {
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
        // S-E04-11 / PF-140 (ii) — the two axes the collapsed `vocabulary`
        // column summarises. APPENDED: indices 0..9 above are untouched.
        'action_vocabulary',
        'resource_type_vocabulary',
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
 * S-E04-11 / PF-140 (ii) — the two axes stop being collapsed into one
 * ================================================================== */

describe('generateAuditCsv — the export is no less truthful than the screen', () => {
  it('G-TRUTH — the appended columns ARE the contracts resolvers, row for row', async () => {
    const { lines } = await csvLines();
    for (let i = 0; i < ROWS.length; i++) {
      const row = ROWS[i]!;
      const cells = lines[i + 1]!.split(',');
      expect(cells[10]).toBe(classifyAuditAction(row.action).vocabulary);
      expect(cells[11]).toBe(classifyAuditResourceType(row.resourceType).vocabulary);
    }
  });

  it('G-TRUTH — the kept `vocabulary` column is DERIVABLE from the two, never a third axis', async () => {
    // AC-2's justification made behavioural: column 7 is exactly
    // `weakerVocabulary(col 10, col 11)`, so the summary and its parts cannot
    // disagree — which is what makes the redundancy honest, and what will let a
    // later, announced format change retire column 7 safely.
    const { lines } = await csvLines();
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i]!.split(',');
      expect({ row: i, collapsed: cells[7] }).toEqual({
        row: i,
        collapsed: weakerVocabulary(
          cells[10] as 'canonical' | 'legacy' | 'unknown',
          cells[11] as 'canonical' | 'legacy' | 'unknown',
        ),
      });
    }
  });

  it('WHICH axis was unclassified is now readable — the defect PF-140 (ii) named', async () => {
    // A row whose axes DISAGREE. The collapsed column says `unknown` and cannot
    // say which half; the appended pair says the action was understood and the
    // resource type was not. Its own fixture, so the shared ROWS above — which
    // every index-based assertion in this file depends on — is not disturbed.
    const { lines } = await csvLines([
      {
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        actorId: 'u-9',
        portal: 'admin',
        action: 'role.delete',
        resourceType: 'zz_unknown_type',
        resourceId: null,
        ipAddress: null,
      },
    ]);
    const cells = lines[1]!.split(',');
    expect(cells[7]).toBe('unknown');
    expect(cells[10]).toBe('canonical');
    expect(cells[11]).toBe('unknown');
  });
});

/* ================================================================== *
 * S-E04-11 / PF-140 (iii) — the file is opened as a SPREADSHEET
 * ================================================================== */

describe('csvEscape — formula injection is neutralised, ordinary values are not touched', () => {
  it('a malicious cell is emitted INERT, and its payload survives in full', async () => {
    const payload = "=cmd|' /C calc'!A0";
    const { lines } = await csvLines([
      {
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        actorId: 'u-4',
        portal: 'admin',
        action: payload,
        resourceType: 'role',
        resourceId: null,
        ipAddress: null,
      },
    ]);
    const cell = lines[1]!.split(',')[3]!;
    // Force-quoted AND prefixed: quoting alone does not neutralise, Excel
    // evaluates `"=1+1"` on import.
    expect(cell.startsWith('"\'=')).toBe(true);
    // NOTHING was dropped from a regulator's file — the payload is recoverable
    // by stripping the surrounding quotes and exactly ONE leading apostrophe.
    expect(cell.slice(1, -1).replace(/^'/, '')).toBe(payload);
    // …and the cell no longer begins with a character a spreadsheet evaluates.
    expect(cell.slice(1, 2)).toBe("'");
  });

  it.each([
    ['=', '=1+1'],
    ['+', '+1+1'],
    ['-', '-1+1'],
    ['@', '@SUM(1+1)'],
    ['tab', '\tSUM(1)'],
    ['carriage return', '\rrow-splitter'],
  ])('a leading %s is neutralised and force-quoted', (_name, value) => {
    const escaped = csvEscape(value);
    expect(escaped.startsWith('"\'')).toBe(true);
    expect(escaped.endsWith('"')).toBe(true);
    expect(escaped.slice(1, -1)).toBe(`'${value}`);
  });

  it('the neutralisation is applied AT MOST ONCE — the prefix is not itself a trigger', () => {
    // P1-6: a leading TAB is the other standard mitigation and is itself in the
    // trigger set, so prefixing one produces a cell the escaper must consider
    // dangerous again. `'` is not a trigger, so one pass suffices and this
    // function never recurses.
    const once = csvEscape('=1+1');
    expect(once).toBe('"\'=1+1"');
    expect(once).not.toContain("''");
    // Re-escaping is NOT idempotent and never was — `csvEscape('a,b')` is
    // `"a,b"` and re-escaping that legitimately doubles the quotes (HEAD behaved
    // the same). Round-tripping is the parser's job; what must hold is that the
    // NEUTRALISER is not re-applied.
    expect(csvEscape(once)).not.toContain("''");
    expect(csvEscape("'=1+1")).toBe("'=1+1");
  });

  it('a bare \\r cannot split a record, and the terminator stays LF', async () => {
    const { text, lines } = await csvLines([
      {
        createdAt: new Date('2026-02-02T00:00:00.000Z'),
        actorId: 'u-5',
        portal: 'admin',
        action: 'part-one\rpart-two',
        resourceType: 'role',
        resourceId: null,
        ipAddress: null,
      },
    ]);
    // Header + ONE data row. A bare CR in an unquoted cell would have made two.
    expect(lines).toHaveLength(2);
    expect(lines[1]!).toContain('"part-one\rpart-two"');
    // P1-7: the record separator is NOT promoted to CRLF while fixing `\r`.
    // RFC 4180 would say CRLF; changing it would move every byte offset in the
    // file, which is the silent byte change this slice exists to stop.
    expect(text).not.toContain('\r\n');
  });

  it('ordinary accented French values are BYTE-IDENTICAL — asserted on the real fixture', async () => {
    const { lines } = await csvLines();
    // The legacy French row, written out in full. None of its cells begins with
    // a trigger character, so none is quoted and none is prefixed.
    expect(lines[2]!).toBe(
      [
        '2026-01-01T09:00:00.000Z',
        'u-2',
        'admin',
        'Suppression',
        'Suppression',
        'Résultats',
        'Résultats',
        'legacy',
        '', // resource_id
        '', // ip_address
        'legacy',
        'legacy',
      ].join(','),
    );
    // …and NO cell anywhere in the file was quoted or prefixed: not one fixture
    // value begins with a trigger character, so the escaper is a no-op on all of
    // them. (Checked per cell rather than on `text`: a French label may legally
    // contain an apostrophe INSIDE it — « Suppression d'un rôle » — and only a
    // LEADING one would be the neutraliser.)
    for (const line of lines) {
      for (const cell of line.split(',')) {
        expect({ cell, touched: cell.startsWith('"') || cell.startsWith("'") }).toEqual({
          cell,
          touched: false,
        });
      }
    }
    // The canonical row's French label came through untouched as well.
    expect(lines[1]!.split(',')[4]).toBe(classifyAuditAction('role.delete').label);
    // An empty cell stays empty, an IPv4 and an ISO timestamp stay raw.
    expect(lines[1]!.split(',')[9]).toBe('10.0.0.1');
    expect(lines[1]!.split(',')[0]).toBe('2026-01-02T10:00:00.000Z');
    expect(lines[3]!.split(',')[9]).toBe('');
  });
});

/* ================================================================== *
 * S-E05-1 / PF-168 / ADR-037 D8 — the neutraliser has ONE home
 * ================================================================== */

describe('neutraliseCsvCell — the shared predicate, driven directly', () => {
  it('the neutraliser is NOT itself a trigger — this is what makes one pass enough', () => {
    // The whole reason the prefix is `'` and not a leading tab. A tab IS in the
    // set below, so prefixing one would produce a cell the escaper must consider
    // dangerous again and the transform would recurse.
    expect(CSV_INJECTION_TRIGGERS).not.toContain(CSV_NEUTRALISER);
    expect(CSV_NEUTRALISER).toBe("'");
    // U+0027, plain ASCII — NOT the typographic U+2019 the French headings use.
    expect(CSV_NEUTRALISER.charCodeAt(0)).toBe(0x27);
    expect(CSV_INJECTION_TRIGGERS.slice()).toEqual(['=', '+', '-', '@', '\t', '\r']);
  });

  it('the function is UNARY — every call site hands it to `.map`, which passes (v, i, arr)', () => {
    // P1-3: a second parameter (a separator, say) would silently receive the
    // column index at `header.map(csvEscape)`. Pinned on both the shared
    // predicate and the worker escaper built on it.
    expect(neutraliseCsvCell.length).toBe(1);
    expect(csvEscape.length).toBe(1);
    expect(['a', '=b', 'c'].map(csvEscape)).toEqual([
      csvEscape('a'),
      csvEscape('=b'),
      csvEscape('c'),
    ]);
  });

  it.each(CSV_INJECTION_TRIGGERS.map((t) => [JSON.stringify(t), t]))(
    'a leading %s is flagged and prefixed, and the payload survives in full',
    (_name, trigger) => {
      const original = `${trigger}SUM(1+1)`;
      const { text, neutralised } = neutraliseCsvCell(original);
      expect(neutralised).toBe(true);
      expect(text).toBe(`'${original}`);
      // Reversible: strip exactly ONE leading apostrophe from a cell this
      // function neutralised, and the original is back, byte for byte.
      expect(text.replace(/^'/, '')).toBe(original);
    },
  );

  it('the transform is applied AT MOST ONCE, and is not injective on `\'`-leading input', () => {
    const once = neutraliseCsvCell('=1+1');
    expect(once).toEqual({ text: "'=1+1", neutralised: true });
    // Idempotent on its own output — no `''`.
    expect(neutraliseCsvCell(once.text)).toEqual({ text: "'=1+1", neutralised: false });
    // P2-8, stated rather than discovered: a cell that ALREADY starts with an
    // apostrophe is not a trigger, so it passes through untouched and the
    // documented inverse ("strip one leading `'`") applies only to cells this
    // function prefixed. Applying it blindly to the line below would resurrect
    // `=1+1`. `csvEscape("'=1+1") === "'=1+1"` (asserted above) pins the same
    // thing at the escaper level; changing it is a format change, not a patch.
    expect(neutraliseCsvCell("'=1+1").neutralised).toBe(false);
  });

  it.each([
    ['the empty cell', ''],
    ['accented French', 'Évaluation trimestrielle'],
    ['a canonical action code', 'role.delete'],
    ['an IPv4', '10.0.0.1'],
    ['an ISO timestamp', '2026-01-02T10:00:00.000Z'],
    ['a trigger that is NOT first', 'a=b'],
    ['a spaced equals', '2 = deux'],
    ['the em dash placeholder U+2014', '—'],
    ['an en dash U+2013', '–'],
    ['the mid-dot separator', '· Sévérité'],
    ['the typographic apostrophe U+2019', '’alerte'],
    ['a French label containing an apostrophe', "Suppression d'un rôle"],
  ])('%s is BYTE-IDENTICAL and not flagged', (_name, value) => {
    expect(neutraliseCsvCell(value)).toEqual({ text: value, neutralised: false });
  });

  it.each([
    ['an international phone number', '+33 6 12 34 56 78'],
    ['the app’s own placeholder number', '+225 07 00 00 00 00'],
    ['a negative number', '-1.4'],
    ['an externalRef starting with a hyphen', '-A17'],
  ])('%s IS neutralised — deliberately, and this is the accepted cost', (_name, value) => {
    // ADR-037 D7's uniform-never-allowlist rule, with its price written down
    // instead of discovered in review. A phone exports as `'+33 …` and a signed
    // number becomes TEXT in Excel (left-aligned, not summable). An allowlist
    // per column is what drifts the day a raw client header joins the export, so
    // the uniform rule wins — and the consequence is that callers must NOT start
    // routing numeric cells through an escaper as an "improvement".
    const { text, neutralised } = neutraliseCsvCell(value);
    expect(neutralised).toBe(true);
    expect(text).toBe(`'${value}`);
    expect(text.replace(/^'/, '')).toBe(value);
  });
});

describe('the DIALECT is per-surface — the shared predicate is not a shared escaper', () => {
  /**
   * The web escaper (`apps/web/src/lib/csv.ts`) is NOT executed here and this
   * file makes no claim that it is: `apps/web` has no unit runner (Playwright
   * only — PF-129/PF-133) and cannot be imported from the worker's jest project.
   * What these cases pin is the CONTRACT the web escaper is built from — the
   * shared predicate composed with the web's own quote-trigger set — so that a
   * change to the shared half that would break the semicolon dialect turns this
   * ratcheted spec red. The web WIRING is evidenced separately, by
   * `scripts/csv-escape-check.js` rule C (an executed import+call check over the
   * real file) and by the deletions in the diff.
   */
  const escapeWebDialect = (v: string): string => {
    const { text, neutralised } = neutraliseCsvCell(v);
    // The web separator is `;`, so `;` is in ITS quote-trigger set and not in
    // the worker's. This is the one line that differs between the two surfaces.
    if (neutralised || /[",;\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  it('a `;` quotes on the web and does NOT quote in the worker — pinned against each other', () => {
    expect(escapeWebDialect('a;b')).toBe('"a;b"');
    expect(csvEscape('a;b')).toBe('a;b');
    // P1-4, the reason the union set is forbidden: `audit_log.user_agent` is one
    // column away from being exported and every such row would change bytes in
    // the regulator's file if the worker adopted the web's trigger set.
    expect(csvEscape('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    );
  });

  it('the web trigger set is a strict SUPERSET of the worker’s — `,` quotes on BOTH surfaces', () => {
    // Corrected during the land pass (R-30 — the ASSERTION was wrong, not the
    // code). This case first read « a `,` quotes in the worker and does NOT
    // quote on the web » and asserted `escapeWebDialect('a,b') === 'a,b'`. That
    // reads `/[",;\n\r]/` as though the leading `",` were one token; it is a
    // class of FIVE characters and the comma is one of them. The web has always
    // quoted on a comma — at HEAD too — so the claim was false and this suite
    // was red. `apps/web/src/lib/csv.ts` was NOT touched to satisfy it.
    //
    // The two dialects are not symmetric opposites: the web set is the worker's
    // set PLUS `;`. That single difference is the whole of the PF-169 split, and
    // the direction matters. Adopting the web set in the worker would force-quote
    // every `;`-bearing `user_agent` in the regulator's file — which is why
    // ADR-037 D8 forbids the union — while adopting the worker set on the web
    // would UNQUOTE `Martin; Dupont` and break the record.
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(escapeWebDialect('a,b')).toBe('"a,b"');
    // The asymmetry stated as the property, not as a pair of examples.
    expect(csvEscape('a;b')).toBe('a;b');
    expect(escapeWebDialect('a;b')).toBe('"a;b"');
  });

  it('a triggering cell gets BOTH treatments on both surfaces', () => {
    expect(escapeWebDialect('=a;b')).toBe('"\'=a;b"');
    expect(csvEscape('=a,b')).toBe('"\'=a,b"');
    // The case a user will report by name (P2-7).
    expect(escapeWebDialect('+33 6 12 34 56 78')).toBe('"\'+33 6 12 34 56 78"');
  });

  it('AlertsExportButton’s old private copy was one property short — it prefixed but left the cell BARE', () => {
    // PF-168 called that copy "ALREADY CORRECT". It prefixed, then tested the
    // ORIGINAL against its quote regex, so `=1+1` shipped as bare `'=1+1`.
    // Adopting the shared escaper changes that file's output bytes too, and this
    // is the assertion that says which way.
    expect(escapeWebDialect('=1+1')).toBe('"\'=1+1"');
    expect(escapeWebDialect('=1+1')).not.toBe("'=1+1");
  });

  it('DELTA 3 — the two parent exports gain comma-quoting, and every grade row changes bytes', () => {
    // Added by the land pass. The `escapeCell` copies deleted from
    // parent/grades and parent/attendance quoted on `/[";\r\n]/` — NO comma.
    // The shared escaper quotes on `/[",;\n\r]/`. So a French decimal, which is
    // exactly what `GradeExportRow.scoreOn20` ("15,0") and `coefficient` ("1,5")
    // are, now ships quoted. Harmless under the `;` delimiter, but it is a byte
    // change on EVERY row of the parent grades export and the story documented
    // only two deltas. Pinned here so the third is on the record rather than
    // discovered by a parent whose file looks different.
    expect(escapeWebDialect('15,0')).toBe('"15,0"');
    expect(escapeWebDialect('1,5')).toBe('"1,5"');
    // Same class for a comma-bearing free-text `Justification` / `Commentaire`.
    expect(escapeWebDialect('Absent, justifié par la famille')).toBe(
      '"Absent, justifié par la famille"',
    );
  });

  it('non-triggering French text is byte-identical on BOTH dialects', () => {
    for (const v of ['Évaluation trimestrielle', 'Prénom', 'Réussite (%)', '—', '']) {
      expect(escapeWebDialect(v)).toBe(v);
      expect(csvEscape(v)).toBe(v);
    }
    // `Martin; Dupont` quotes on the web (its separator) but is otherwise intact.
    expect(escapeWebDialect('Martin; Dupont')).toBe('"Martin; Dupont"');
    expect(escapeWebDialect('Il a dit "oui"')).toBe('"Il a dit ""oui"""');
  });

  it('nullish and numeric-ish inputs behave as at HEAD', () => {
    // P2-10: the `s.length > 0` guard survived the lift — `''` stays `''` and
    // does NOT become a bare apostrophe.
    expect(csvEscape('')).toBe('');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
    expect(csvEscape(0)).toBe('0');
    expect(neutraliseCsvCell('')).toEqual({ text: '', neutralised: false });
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

  /**
   * S-E04-11 / PF-149 — **REWRITTEN, not softened.**
   *
   * This assertion (`rejects.toBeInstanceOf(UnknownTimezoneError)`) was correct
   * and became false the moment the error acquired a deliberate answer: the raw
   * contracts error is now MAPPED, at the seam, to a terminal job failure whose
   * message a DPO can act on. The claim it defended — *the export fails closed,
   * it never reverts to UTC* — is still asserted below, and now with more, not
   * less: nothing is queried, and the offending zone is named.
   */
  it('an unusable tenant zone FAILS the export — terminally, and by name', async () => {
    const { args, findMany } = makeArgs(ROWS, {
      parameters: { to: '2026-08-08' },
      timezone: 'Mars/Olympus_Mons',
    });
    const err = await generateAuditCsv(args).then(
      () => {
        throw new Error('generateAuditCsv resolved — an unusable zone must fail the export.');
      },
      (e: unknown) => e as Error,
    );

    // BullMQ grades this terminal on attempt 1 of 3 (`queue-metrics.ts:504-506`)
    // — a bad `Tenant.timezone` is configuration, and three identical retries
    // help nobody. Asserted by NAME because that is exactly how BullMQ and
    // `classifyFailure` recognise it, across module copies.
    expect(err.name).toBe('UnrecoverableError');
    // The raw contracts error no longer escapes: it was answered, not leaked.
    expect(err).not.toBeInstanceOf(UnknownTimezoneError);

    // The message reaches a human verbatim — `exports.processor.ts:112-124` logs
    // it and persists `errorMessage: msg.slice(0, 500)`, which `/admin/exports`
    // renders in a `truncate`d span whose only full disclosure is a `title`
    // tooltip (unreachable by keyboard, unreachable on touch). So the FIRST
    // sentence has to be self-sufficient: French, naming the zone, then the fix
    // and the tenant.
    expect(err.message).toContain('Mars/Olympus_Mons');
    expect(err.message).toContain(TENANT);
    const firstSentence = err.message.slice(0, err.message.indexOf('.') + 1);
    expect(firstSentence).toContain('Mars/Olympus_Mons');
    expect(firstSentence.length).toBeLessThanOrEqual(110);
    expect(err.message).not.toContain('UnknownTimezoneError');
    expect(err.message.length).toBeLessThanOrEqual(500);

    // AC-8 — it FAILED CLOSED. No rows were read, so no file with wrong day
    // boundaries can exist: the alternative (a silent fallback to the server
    // zone) is the defect S-E04-5 removed and this slice must not reintroduce.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('the guard spans the WINDOW RESOLUTION, not just the assert line', async () => {
    // `assertKnownTimezone(declaredZone)` is skipped entirely on the
    // `DEFAULT_AUDIT_TIMEZONE` branch, and `resolveAuditWindow` asserts again
    // downstream (`window.ts:323` → `zonedDayStartUtc` → `partsInZone`). A `try`
    // around the assert alone would guard the branch that cannot fire today and
    // miss the one that fires for every tenant at once.
    //
    // Reaching that downstream branch on a full-ICU host (`process.versions.icu`
    // = 76.1) requires stubbing `Intl`: the formatter is ACCEPTED (so the assert
    // passes, and caches) and then fails to produce a field. The zone below is
    // used in this test ONLY — `window.ts:86` caches formatters per zone for the
    // life of the module, so sharing a zone would make these tests order-
    // dependent.
    const DOWNSTREAM_ZONE = 'Indian/Kerguelen';
    const realDateTimeFormat = Intl.DateTimeFormat;
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function stubbed(
      locale: string,
      options: Intl.DateTimeFormatOptions,
    ) {
      const real = new realDateTimeFormat(locale, { ...options, timeZone: 'UTC' });
      return {
        resolvedOptions: () => ({ ...real.resolvedOptions(), timeZone: options.timeZone }),
        // Everything except the day — `partsInZone` raises `UnknownTimezoneError`
        // for the missing field, from INSIDE the window resolution.
        formatToParts: (d: Date) => real.formatToParts(d).filter((p) => p.type !== 'day'),
        format: (d: Date) => real.format(d),
      };
    };
    try {
      const { args, findMany } = makeArgs(ROWS, {
        // Both bounds supplied, so the throw comes from `resolveAuditWindow`
        // rather than from the `zonedYmd` default — the span under test.
        parameters: { from: '2026-08-01', to: '2026-08-08' },
        timezone: DOWNSTREAM_ZONE,
      });
      const err = await generateAuditCsv(args).then(
        () => {
          throw new Error('generateAuditCsv resolved — a downstream failure must fail closed.');
        },
        (e: unknown) => e as Error,
      );
      expect(err.name).toBe('UnrecoverableError');
      expect(err.message).toContain(DOWNSTREAM_ZONE);
      expect(findMany).not.toHaveBeenCalled();
    } finally {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = realDateTimeFormat;
    }
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
