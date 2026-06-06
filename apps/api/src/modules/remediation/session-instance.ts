/**
 * E7-S2 — pure session-instance resolution (the capacity-guard key correctness).
 *
 * The booking concurrency guard (ADR-020) only holds if two parents booking "the
 * same instance" of a slot compute a **byte-identical** `sessionAt` timestamp.
 * `sessionAt` is therefore NEVER trusted from the client beyond the date: the
 * server resolves the canonical instant from the slot's shape and rejects a
 * mismatch (422). This module is the single source of that resolution — pure and
 * unit-testable, so the partial-unique index and the idempotency `@@unique` always
 * see the same key.
 *
 * Note on timezone: availabilities store `startTime` as a "HH:mm" school-local
 * string and one-off `startsAt` as a `Timestamptz`. We canonicalise to a UTC
 * instant by combining the chosen date (UTC midnight) with the slot's "HH:mm" —
 * deterministic and identical across requests. A future ADR could thread true
 * school-locale TZ; for the concurrency invariant only determinism matters.
 */

export type AvailabilityKindLike = 'recurring_weekly' | 'one_off';

export interface SlotShape {
  kind: AvailabilityKindLike;
  /** recurring_weekly: 0=Mon … 6=Sun (null for one_off). */
  weekday: number | null;
  /** recurring_weekly: "HH:mm" local school time (null for one_off). */
  startTime: string | null;
  /** one_off: the concrete start instant (null for recurring_weekly). */
  startsAt: Date | null;
}

/** Truncate a Date to a whole UTC second (drop millis) — stable instance key. */
function truncateToSecond(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 1000) * 1000);
}

/**
 * JS `Date.getUTCDay()` is 0=Sun … 6=Sat. The slot stores 0=Mon … 6=Sun.
 * Convert a UTC weekday-from-Sunday into the slot's Monday-based index.
 */
function utcDayToSlotWeekday(jsDay: number): number {
  return (jsDay + 6) % 7; // Sun(0)->6, Mon(1)->0, … Sat(6)->5
}

/** Parse a strict "HH:mm" (or "HH:mm:ss") into [h, m] or null. */
function parseHHmm(value: string | null): [number, number] | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return [h, min];
}

/**
 * Resolve the canonical UTC instant for a CLIENT-SUPPLIED `sessionAt` against the
 * slot, returning null when the requested instant does not match the slot shape
 * (the caller maps null → 422). Never throws.
 *
 *  - one_off: the requested instant MUST equal the slot's `startsAt` (to the
 *    second). The canonical key is `startsAt` truncated to the second.
 *  - recurring_weekly: the requested instant's UTC weekday MUST match the slot's
 *    `weekday`. The canonical key is that calendar date at the slot's "HH:mm"
 *    (UTC), discarding any client-supplied time-of-day (so two parents booking
 *    the same Tuesday compute the same key regardless of submitted ms/offset).
 */
export function resolveCanonicalSessionAt(slot: SlotShape, requestedIso: string): Date | null {
  const requested = new Date(requestedIso);
  if (Number.isNaN(requested.getTime())) return null;

  if (slot.kind === 'one_off') {
    if (!slot.startsAt) return null;
    const canonical = truncateToSecond(slot.startsAt);
    // Accept the request only if it points at the slot's own instant (to the second).
    if (truncateToSecond(requested).getTime() !== canonical.getTime()) return null;
    return canonical;
  }

  // recurring_weekly
  if (slot.weekday == null) return null;
  if (utcDayToSlotWeekday(requested.getUTCDay()) !== slot.weekday) return null;

  const hm = parseHHmm(slot.startTime) ?? [0, 0];
  const canonical = new Date(
    Date.UTC(
      requested.getUTCFullYear(),
      requested.getUTCMonth(),
      requested.getUTCDate(),
      hm[0],
      hm[1],
      0,
      0,
    ),
  );
  return canonical;
}

/**
 * Resolve the slot's NEXT concrete dated instance (for the catalogue's
 * remaining-seat computation), from `now`. Returns null when the slot has no
 * future instance resolvable (a past one-off, or a malformed recurring slot).
 *
 *  - one_off: its `startsAt` if still in the future (else null).
 *  - recurring_weekly: the next date (within the coming 7 days, inclusive of
 *    today if still ahead of the slot time) matching `weekday` at "HH:mm" UTC.
 */
export function resolveNextSessionAt(slot: SlotShape, now: Date = new Date()): Date | null {
  if (slot.kind === 'one_off') {
    if (!slot.startsAt) return null;
    const at = truncateToSecond(slot.startsAt);
    return at.getTime() > now.getTime() ? at : null;
  }

  if (slot.weekday == null) return null;
  const hm = parseHHmm(slot.startTime) ?? [0, 0];

  // Walk forward up to 7 days to find the next matching weekday at the slot time.
  for (let i = 0; i < 8; i += 1) {
    const day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, hm[0], hm[1], 0, 0),
    );
    if (utcDayToSlotWeekday(day.getUTCDay()) !== slot.weekday) continue;
    if (day.getTime() > now.getTime()) return day;
  }
  return null;
}

/** Is the resolved instant strictly in the future relative to `now`? */
export function isFutureInstant(at: Date, now: Date = new Date()): boolean {
  return at.getTime() > now.getTime();
}
