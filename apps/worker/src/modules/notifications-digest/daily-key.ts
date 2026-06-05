import { createHash } from 'node:crypto';

/**
 * Pure day-key helpers for the cross-kind daily digest (E5-S2). The structural
 * sibling of `parent-digest/iso-week.ts`, generalised from an ISO-week key to a
 * single UTC **day** key. No date-fns/luxon dependency — a tiny, deterministic,
 * UTC-based implementation (the worker runs UTC).
 */

/** UTC calendar-day key for a date, e.g. "2026-06-05". */
export function dayKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Midnight 00:00:00.000 UTC of the calendar day containing `date`. */
export function dayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Deterministic UUID derived from a string seed (SHA-1, RFC-4122 v5-shaped).
 * Identical algorithm to `parent-digest/iso-week.ts#deterministicUuid` so the
 * daily idempotency marker fits the `Notification.sourceId` `@db.Uuid` column:
 * the marker is keyed by a stable UUID computed purely from
 * (tenantId, userProfileId, dayKey), so a re-tick on the same UTC day finds the
 * exact same row and skips the send.
 */
export function deterministicUuid(seed: string): string {
  const h = createHash('sha1').update(seed).digest('hex');
  // Force version 5 + RFC-4122 variant bits.
  const v = (
    h.slice(0, 8) +
    h.slice(8, 12) +
    '5' +
    h.slice(13, 16) +
    ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) +
    h.slice(17, 20) +
    h.slice(20, 32)
  ).slice(0, 32);
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20, 32)}`;
}

/** Stable marker UUID for (tenant, user, UTC day). Namespaced `daily_digest`. */
export function dailyDigestMarkerId(args: {
  tenantId: string;
  userProfileId: string;
  dayKey: string;
}): string {
  return deterministicUuid(
    `daily_digest|${args.tenantId}|${args.userProfileId}|${args.dayKey}`,
  );
}

const FR_MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** Human day label like "5 juin 2026" for the digest subject/header. */
export function dayLabel(date: Date): string {
  return `${date.getUTCDate()} ${FR_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
