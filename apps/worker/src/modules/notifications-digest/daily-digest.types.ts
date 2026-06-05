import type { NotificationKind } from '@prisma/client';

/**
 * Worker-local payload types for the cross-kind daily digest (E5-S2). Mirrors the
 * hand-maintained, worker-only shape convention of
 * `parent-digest/digest-email.types.ts`: nothing in the API or web consumes these
 * (the digest is computed + rendered entirely worker-side from the user's own
 * `Notification` rows), so no `packages/contracts` type is added.
 */

/** One kind-group inside a user's daily digest ("3 nouvelles notes", etc.). */
export interface DigestKindGroup {
  kind: NotificationKind;
  /** Number of day-window notifications of this kind for the user. */
  count: number;
  /**
   * Up to N sample titles of those notifications (most recent first), shown as a
   * short preview list under the group header.
   */
  sampleTitles: string[];
  /**
   * The single deep link for this group's CTA — the `link` of the most recent
   * notification in the group, or a sensible kind-level fallback when absent.
   */
  link: string;
}

/** Render input for one user's composite daily digest email. */
export interface DailyDigestRenderInput {
  recipientName: string;
  /** Human day label, e.g. "5 juin 2026". */
  dayLabel: string;
  /** Total notifications bundled across all groups (for the subject line). */
  totalCount: number;
  /** Kind-groups in display order (already sorted, non-empty). */
  groups: DigestKindGroup[];
}
