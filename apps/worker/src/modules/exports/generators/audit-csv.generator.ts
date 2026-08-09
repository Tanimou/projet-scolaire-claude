import {
  DEFAULT_AUDIT_TIMEZONE,
  assertKnownTimezone,
  auditWindowCreatedAtFilter,
  classifyAuditAction,
  classifyAuditResourceType,
  resolveAuditWindow,
  zonedYmd,
  type AuditVocabularyKind,
} from '@pilotage/contracts';

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
 * Two rules govern every column below, and they are in tension on purpose:
 *
 *  1. **The record is reproduced, never interpreted.** `action` and
 *     `resource_type` carry the stored value **byte-for-byte**. The French
 *     labels are *additional* columns, laid beside the raw value, never on top
 *     of it. A regulator must be able to read what the system actually wrote.
 *  2. **What cannot be classified stays visible** (DNC-08). An unrecognised code
 *     is exported with `*_label` equal to the code itself and `vocabulary` =
 *     `unknown`. It is never dropped from the file, never bucketed into a
 *     generic label, and never swallowed by a `try/catch` — the resolvers are
 *     total functions and are deliberately not wrapped.
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
  const tenantRow = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { timezone: true },
  });
  const declaredZone = (tenantRow?.timezone ?? '').trim();
  const timezone = declaredZone === '' ? DEFAULT_AUDIT_TIMEZONE : assertKnownTimezone(declaredZone);

  const now = new Date();
  // Unfiltered defaults, expressed as tenant days so they go through the same
  // boundary code as an explicit filter — a default computed a second way is a
  // second implementation waiting to drift.
  const auditWindow = resolveAuditWindow(
    fromIso ?? zonedYmd(daysAgo(90, now), timezone),
    toIso ?? zonedYmd(now, timezone),
    timezone,
  );
  const createdAt = auditWindowCreatedAtFilter(auditWindow);

  const rows = await prisma.auditLog.findMany({
    where: {
      tenantId,
      ...(createdAt ? { createdAt } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50_000,
  });

  const header = [
    'created_at',
    'actor_id',
    'portal',
    // Raw, as stored. The `*_label` columns are appended beside them, never
    // interleaved with them and never in their place.
    'action',
    'action_label',
    'resource_type',
    'resource_type_label',
    'vocabulary',
    'resource_id',
    'ip_address',
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

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
