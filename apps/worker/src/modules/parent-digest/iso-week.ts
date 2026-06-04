import { createHash } from 'node:crypto';

/**
 * Pure ISO-week helpers for the weekly parent digest (E1-S4). No date-fns/luxon
 * dependency — a tiny, deterministic, UTC-based implementation.
 */

/**
 * ISO-8601 week key for a date, e.g. "2026-W23". Weeks start Monday; week 1 is
 * the week containing the first Thursday of the year. Computed in UTC so the
 * worker (which runs UTC) is deterministic regardless of host timezone.
 */
export function isoWeekKey(date: Date): string {
  // Copy and shift to the Thursday of the current ISO week (UTC).
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  // First Thursday of the ISO year.
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week =
    1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Deterministic UUID derived from a string seed (SHA-1, RFC-4122 v5-shaped).
 * Used to fit the weekly idempotency marker into `Notification.sourceId`, which
 * is a `@db.Uuid` column: the marker is keyed by a stable UUID computed purely
 * from (tenantId, userProfileId, weekKey), so a re-tick in the same ISO week
 * finds the exact same row and skips the send.
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

/** Stable marker UUID for (tenant, guardian, ISO week). */
export function digestMarkerId(args: {
  tenantId: string;
  userProfileId: string;
  weekKey: string;
}): string {
  return deterministicUuid(`weekly_digest|${args.tenantId}|${args.userProfileId}|${args.weekKey}`);
}

const FR_MONTHS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

/** Human week range label like "26 mai – 1 juin" for a Monday→Sunday window. */
export function weekRangeLabel(monday: Date, sunday: Date): string {
  const fmt = (d: Date) => `${d.getUTCDate()} ${FR_MONTHS[d.getUTCMonth()]}`;
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

/** Monday 00:00 UTC of the ISO week containing `date`. */
export function isoWeekMonday(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum);
  return d;
}
