import {
  DEFAULT_AUDIT_TIMEZONE,
  UnknownTimezoneError,
  assertKnownTimezone,
  auditWindowCreatedAtFilter,
  classifyAuditAction,
  classifyAuditResourceType,
  resolveAuditWindow,
  zonedYmd,
  type AuditVocabularyKind,
} from '@pilotage/contracts';
import { UnrecoverableError } from 'bullmq';

import type { GenerateArgs, GenerateResult } from './types';

/**
 * U+FEFF, declared once and named — an invisible character nobody can review,
 * and therefore one nobody may delete by accident. See the return below.
 */
const UTF8_BOM = '\uFEFF';

/**
 * Audit CSV — append-only export of the audit log.
 *
 * Parameters (optional):
 *   - from / to: ISO dates bounding `created_at`
 *
 * **This is the file a DPO hands to a regulator** — the third consumer of the
 * audit vocabulary that a web+API fix would have left drifting (S-E04-4, AC-6).
 *
 * Three rules govern every column below, and the first two are in tension on
 * purpose:
 *
 *  1. **The record is reproduced, never interpreted.** `action` and
 *     `resource_type` carry the stored value **byte-for-byte**. The French
 *     labels are *additional* columns, laid beside the raw value, never on top
 *     of it. A regulator must be able to read what the system actually wrote.
 *
 *     **S-E04-11 / ADR-037 D7 — the one stated exception, and it is stated
 *     because a silent one would be the defect this slice exists to close.**
 *     The ADR scopes D4's « verbatim » to « verbatim modulo this neutraliser »,
 *     so the rule below and the vocabulary doctrine agree. A cell whose FIRST
 *     character is `=`, `+`, `-`, `@`, a tab or a carriage return is
 *     force-quoted and prefixed with a single apostrophe (`csvEscape` below).
 *     The BOM at the bottom of this file makes French Excel open the artefact as
 *     a *spreadsheet*, so such a cell is a formula, not a record — and
 *     `audit_log.user_agent` is a raw client header one column away from being
 *     exported. The transform is **additive and reversible** (strip exactly one
 *     leading `'`); nothing is ever dropped from a regulator's file, and a value
 *     that does not begin with a trigger character is emitted exactly as before
 *     — every accented French label included.
 *  2. **What cannot be classified stays visible** (DNC-08). An unrecognised code
 *     is exported with `*_label` equal to the code itself and `vocabulary` =
 *     `unknown`. It is never dropped from the file, never bucketed into a
 *     generic label, and never swallowed by a `try/catch` — the resolvers are
 *     total functions and are deliberately not wrapped.
 *  3. **The column contract is APPEND-ONLY** (ADR-037 D6, S-E04-11, PF-140 i).
 *     Indices 0..9 are frozen where they are: `action_label` / `resource_type_label` /
 *     `vocabulary` were once inserted *mid*-header and pushed `resource_id` and
 *     `ip_address` from 5-6 to 8-9, which breaks an index-keyed downstream
 *     parser in silence. A new column is appended at the end; removing or
 *     reordering one is a format change that needs a version and an
 *     announcement, not a commit. `audit-csv.generator.spec.ts` pins the frozen
 *     prefix *separately* from the full header, so "you moved a column" and "you
 *     added a column" are two different failures.
 *
 * The labels come from `@pilotage/contracts` at **module load**, so a missing
 * or stale `contracts/dist` in the worker image fails loudly at boot rather than
 * halfway through a regulator's export (ADR-037 D5).
 *
 * **S-E04-5 — the same day boundary as the screen.** This generator carried the
 * identical defect the audit page did: `to = new Date(toIso)` then `lte: to`, so
 * `to=2026-08-08` cut the file at `T00:00:00Z` and the last day was missing. The
 * page's « Exporter en CSV » button posts the *same* `from`/`to` the table used,
 * so the two disagreed — one filter, two answers, on the one surface whose whole
 * thesis is that it does not lie. Both now go through `resolveAuditWindow` from
 * `@pilotage/contracts`, in the **tenant's** timezone (`Tenant.timezone`), with
 * an exclusive upper bound. One function, not two implementations that agree
 * today.
 */
export async function generateAuditCsv(args: GenerateArgs): Promise<GenerateResult> {
  const { prisma, tenantId, parameters } = args;
  const fromIso = (parameters.from as string | undefined) ?? null;
  const toIso = (parameters.to as string | undefined) ?? null;

  // Same resolution as `analytics.service.ts`: server-side, from the tenant row,
  // never from `parameters`. An unresolvable zone throws rather than quietly
  // shifting every boundary by an hour in a regulator's file.
  //
  // **S-E04-11 / PF-149 — the guard spans the whole resolution, not one line.**
  // `assertKnownTimezone(declaredZone)` is NOT the only throw site: the
  // `DEFAULT_AUDIT_TIMEZONE` branch skips it entirely, and both `zonedYmd`
  // (`window.ts:222`) and `resolveAuditWindow` (`:323`) assert again downstream.
  // Under a small-ICU runtime it is the *default* zone that fails — for every
  // tenant at once — so a `try` around the assert alone would guard the one case
  // that cannot fire today and miss the one that can.
  let createdAt: ReturnType<typeof auditWindowCreatedAtFilter>;
  try {
    const tenantRow = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const declaredZone = (tenantRow?.timezone ?? '').trim();
    // ABSENT (no row, empty column) is not the same as UNUSABLE: absent falls
    // back to the column's own default, unusable fails closed. That distinction
    // is the design, and no fallback to the server zone exists on either path.
    const timezone =
      declaredZone === '' ? DEFAULT_AUDIT_TIMEZONE : assertKnownTimezone(declaredZone);

    const now = new Date();
    // Unfiltered defaults, expressed as tenant days so they go through the same
    // boundary code as an explicit filter — a default computed a second way is a
    // second implementation waiting to drift.
    const auditWindow = resolveAuditWindow(
      fromIso ?? zonedYmd(daysAgo(90, now), timezone),
      toIso ?? zonedYmd(now, timezone),
      timezone,
    );
    createdAt = auditWindowCreatedAtFilter(auditWindow);
  } catch (err) {
    if (!isUnknownTimezoneError(err)) throw err;
    // A bad `Tenant.timezone` is CONFIGURATION, not a transient fault. Left as a
    // plain `Error`, BullMQ retries it three times into three identical
    // failures; `UnrecoverableError` is graded `failed_terminal` on attempt 1
    // (`queue-metrics.ts:504-506`, bullmq@5.76.8 `classes/job.js:486`).
    //
    // NO logger and NO second `catch` here on purpose: `GenerateArgs` carries no
    // logger, generators are pure functions, and `exports.processor.ts:112-124`
    // already logs `[audit_csv] <id> — failed: <msg>` and persists
    // `errorMessage: msg.slice(0, 500)` on the `ExportJob` row. This block only
    // *rewords* — the message below is what a DPO reads verbatim in the truncated
    // « Échec » line of `/admin/exports`, so it is UI copy: French, one short
    // self-sufficient first sentence naming the offending zone, then the fix and
    // the tenant. The developer-facing detail (`RangeError`, small-ICU) stays in
    // `err.message`, which the processor's log line still carries.
    throw new UnrecoverableError(
      `Export impossible : le fuseau « ${err.timezone} » de l'établissement est invalide. ` +
        `Corrigez Tenant.timezone (tenant ${tenantId}) avec un identifiant IANA valide, ` +
        `puis relancez l'export. Détail : ${err.message}`,
    );
  }

  const rows = await prisma.auditLog.findMany({
    where: {
      tenantId,
      ...(createdAt ? { createdAt } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50_000,
  });

  const header = [
    // ---- FROZEN PREFIX, indices 0..9 (S-E04-11, rule 3 above). ----
    // Positions here are the contract. A `*_label` follows the raw value it
    // describes — that adjacency is what `audit-vocabulary-gate.spec.ts:1215`
    // asserts, and it is the only thing the old comment got right. It did NOT
    // hold that the label columns were "appended, never interleaved": they were
    // inserted mid-header and moved `resource_id`/`ip_address` from 5-6 to 8-9.
    // The rule that is true, and now enforced, is the one above: 0..9 never
    // move, new columns go at the END.
    'created_at',
    'actor_id',
    'portal',
    'action',
    'action_label',
    'resource_type',
    'resource_type_label',
    // KEPT deliberately (S-E04-11, AC-2). This is `weakerVocabulary(action,
    // resource_type)` and is therefore fully DERIVABLE from the two appended
    // per-axis columns (`unknown` > `legacy` > `canonical`) — redundant, not a
    // third axis, so the three can never disagree. Removing it would move
    // `resource_id`/`ip_address` a *second* time, i.e. commit PF-140 (i) inside
    // the fix for PF-140 (i). Its retirement is a follow-up needing a versioned,
    // announced format change.
    'vocabulary',
    'resource_id',
    'ip_address',
    // ---- APPENDED, indices 10..11 (S-E04-11, PF-140 ii). ----
    // The collapsed `vocabulary` column alone cannot tell a regulator WHICH axis
    // was unclassified, while the screen already keeps them apart
    // (`audit-labels.ts:140-144` names « l'action » and « le type de ressource »
    // separately). The export was less truthful than the surface it documents.
    'action_vocabulary',
    'resource_type_vocabulary',
  ];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    const action = classifyAuditAction(r.action);
    const resourceType = classifyAuditResourceType(r.resourceType);
    lines.push(
      [
        r.createdAt.toISOString(),
        r.actorId ?? '',
        r.portal ?? '',
        r.action,
        action.label,
        r.resourceType,
        resourceType.label,
        weakerVocabulary(action.vocabulary, resourceType.vocabulary),
        r.resourceId ?? '',
        r.ipAddress ?? '',
        // The two axes the collapsed column above summarises, each read from the
        // SAME ADR-037 resolver the API KPI predicates and the web adapter read.
        // No local copy, and no third source of truth: column 7 is a function of
        // these two, asserted row-by-row in the spec.
        action.vocabulary,
        resourceType.vocabulary,
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  return {
    // UTF-8 BOM. Without it French Excel — the tool a DPO actually opens this
    // in — decodes the file as Windows-1252 and renders « Évaluation » as
    // « Ã‰valuation ». The accented values were already there in the legacy
    // rows; adding French label columns turns a latent defect into every row.
    // One character, no effect on any other consumer.
    buffer: Buffer.from(UTF8_BOM + lines.join('\n'), 'utf-8'),
    contentType: 'text/csv; charset=utf-8',
  };
}

/**
 * A row is only as classified as its weakest axis: `unknown` beats `legacy`
 * beats `canonical`. Reporting a half-unknown row as `canonical` would be the
 * export telling a regulator the system understood something it did not.
 */
export function weakerVocabulary(
  a: AuditVocabularyKind,
  b: AuditVocabularyKind,
): AuditVocabularyKind {
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  if (a === 'legacy' || b === 'legacy') return 'legacy';
  return 'canonical';
}

/**
 * The characters that make a cell a **formula** rather than a record when the
 * file is opened as a spreadsheet — Excel, LibreOffice and Google Sheets all
 * evaluate a cell starting with one of these. `\t` and `\r` are here for a
 * second reason as well: pasted into a sheet they split the cell, and a bare
 * `\r` in an unquoted cell terminates the *record*.
 */
const CSV_INJECTION_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/** The neutralising prefix. See `csvEscape` for why this character and not a tab. */
const CSV_NEUTRALISER = "'";

/**
 * **S-E04-11 / PF-140 (iii) / ADR-037 D7 — the chosen defensive form, stated
 * rather than assumed.**
 *
 * Quoting alone does not neutralise: Excel evaluates `"=1+1"` on CSV import. So
 * a triggering cell is **force-quoted AND prefixed with a single apostrophe**
 * (the OWASP form). Three properties make this the right trade in a file handed
 * to a regulator:
 *
 *  - **Nothing is dropped.** The payload survives in full; a plain parser reads
 *    `'=cmd|…` and recovers the original by stripping exactly ONE leading `'`.
 *    Silent removal would be a worse defect than the injection.
 *  - **Uniform across every column, never a per-column allowlist.** An allowlist
 *    is precisely what drifts the day `audit_log.user_agent` — a raw client
 *    header — joins the export.
 *  - **Non-triggering cells are byte-identical to before.** `Évaluation`,
 *    `Résultats`, `role.delete`, `10.0.0.1`, an ISO timestamp and an empty cell
 *    all pass through untouched, because none of them starts with a trigger.
 *
 * Why an apostrophe and not a leading tab (the other standard mitigation): a tab
 * is itself in the trigger set, so prefixing one produces a cell the escaper
 * must consider dangerous again. `'` is not a trigger, so **one pass suffices
 * and this function never recurses** — the neutralisation step is idempotent on
 * its own output. (Full `csvEscape` idempotence is not a property any RFC-4180
 * escaper has, at HEAD or here: `csvEscape('a,b')` is `"a,b"` and re-escaping
 * that legitimately doubles the quotes. Round-tripping is the parser's job.)
 *
 * The record separator stays `\n` and the delimiter stays `,` — changing either
 * would rewrite every byte offset in the file, which is the silent byte change
 * this slice exists to stop.
 */
export function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  const dangerous = s.length > 0 && CSV_INJECTION_TRIGGERS.indexOf(s.charAt(0)) !== -1;
  const body = dangerous ? CSV_NEUTRALISER + s : s;
  if (dangerous || /[",\n\r]/.test(body)) return `"${body.replace(/"/g, '""')}"`;
  return body;
}

/**
 * `instanceof` **plus** the name, and the disjunction is load-bearing.
 *
 * `packages/contracts` ships CJS; `apps/api` and `apps/worker` resolve their own
 * copy, and a spec may reach `src` while the runtime reaches `dist`. Two class
 * objects make `instanceof` false, the branch below becomes dead code, and the
 * job dies generically again — while a test that constructs the error itself
 * still passes. `window.ts:55` already sets the prototype for the ES5 half of
 * this problem; the name check covers the module-identity half.
 */
function isUnknownTimezoneError(err: unknown): err is UnknownTimezoneError {
  return (
    err instanceof UnknownTimezoneError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'UnknownTimezoneError' &&
      typeof (err as { timezone?: unknown }).timezone === 'string')
  );
}

/**
 * `n` days before `ref`, as an instant. Only ever handed to `zonedYmd`, which
 * turns it into the tenant's civil day — the day is what the window resolves,
 * so this function no longer decides a boundary, only a rough starting point.
 */
function daysAgo(n: number, ref: Date): Date {
  const d = new Date(ref.getTime());
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
