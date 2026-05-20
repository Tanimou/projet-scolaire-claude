/**
 * Minimal RFC 5545 (iCalendar) serialiser for exporting the school calendar.
 *
 * Pure functions only — no DOM, no fetch — so the output is deterministic and
 * easy to reason about. The browser-side download wrapper lives in the
 * `CalendarExportButton` component. Events handed in are already filtered by
 * the backend visibility ABAC (the `/calendar/events` endpoint), so this module
 * performs no authorisation: it only formats what the caller already holds.
 */

export interface IcsEvent {
  id: string;
  title: string;
  description?: string | null;
  /** ISO 8601 instant. */
  startsAt: string;
  /** ISO 8601 instant (inclusive of the last day for all-day events). */
  endsAt: string;
  allDay: boolean;
  /** Free-text categories, e.g. ['Examens']. */
  categories?: string[];
  /** Human-readable scope, e.g. 'Classe 6e A'. */
  location?: string | null;
}

export interface BuildCalendarIcsOptions {
  /** Shown by calendar apps as the imported calendar's name. */
  calendarName: string;
  /** Instant used for DTSTAMP / UID generation. Defaults to now. */
  now?: Date;
}

const PRODID = '-//Pilotage Scolaire//Calendrier scolaire//FR';

/** Escape a TEXT value per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line to <=75 octets per RFC 5545 §3.1, breaking on UTF-8
 * octet boundaries (never mid-character). Continuation lines begin with a
 * single space, which itself counts toward the octet budget.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let currentOctets = 0;
  let isContinuation = false;

  for (const char of line) {
    const charOctets = encoder.encode(char).length;
    // First line budget is 75; continuation lines reserve 1 octet for the
    // leading space, leaving 74 for content.
    const budget = isContinuation ? 74 : 75;
    if (currentOctets + charOctets > budget) {
      out.push(current);
      current = char;
      currentOctets = charOctets;
      isContinuation = true;
    } else {
      current += char;
      currentOctets += charOctets;
    }
  }
  out.push(current);

  return out.map((seg, i) => (i === 0 ? seg : ` ${seg}`)).join('\r\n');
}

/** UTC timestamp form: 20260520T140000Z. */
function formatIcsUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Date form for all-day values: 20260520 (uses UTC components). */
export function formatIcsDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function addUtcDays(date: Date, n: number): Date {
  const r = new Date(date);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function buildVevent(event: IcsEvent, stamp: string): string[] {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const lines: string[] = ['BEGIN:VEVENT'];

  lines.push(`UID:${event.id}@pilotage-scolaire`);
  lines.push(`DTSTAMP:${stamp}`);

  if (event.allDay) {
    // DTEND is exclusive for VALUE=DATE — add one day past the inclusive end.
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(start)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(addUtcDays(end, 1))}`);
  } else {
    lines.push(`DTSTART:${formatIcsUtc(start)}`);
    lines.push(`DTEND:${formatIcsUtc(end)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  if (event.categories && event.categories.length > 0) {
    lines.push(`CATEGORIES:${event.categories.map(escapeIcsText).join(',')}`);
  }

  lines.push('END:VEVENT');
  return lines;
}

/** Serialise events into a single VCALENDAR document (CRLF-terminated). */
export function buildCalendarIcs(
  events: ReadonlyArray<IcsEvent>,
  options: BuildCalendarIcsOptions,
): string {
  const stamp = formatIcsUtc(options.now ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    'X-WR-TIMEZONE:Europe/Paris',
  ];

  for (const event of events) {
    lines.push(...buildVevent(event, stamp));
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
