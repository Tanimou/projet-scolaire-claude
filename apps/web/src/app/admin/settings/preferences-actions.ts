'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError } from '@/lib/api-client';

export type NotificationKindCode =
  | 'announcement'
  | 'alert'
  | 'grade_published'
  | 'enrollment_status'
  | 'lesson_published'
  | 'system'
  // E2-S4 — opt-in email on a new parent↔teacher message (OFF by default, RGPD).
  | 'message'
  | 'weekly_digest';

/**
 * Per-kind email cadence (E5-S2/S3). Mirrors the shared contract enum
 * `NOTIFICATION_CADENCE` 1:1 — governs *email frequency* only, orthogonal to the
 * channel booleans. `instant` = today's per-event email (default); `daily_digest`
 * = bundle into one daily summary; `off` = mute this kind's email (reversible
 * soft snooze that preserves the channel choice server-side).
 */
export type NotificationCadenceCode = 'instant' | 'daily_digest' | 'off';

export interface UpdatePreferencePatch {
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
  cadence?: NotificationCadenceCode;
}

function revalidateSettings() {
  revalidatePath('/admin/settings');
  revalidatePath('/teacher/settings');
  revalidatePath('/parent/settings');
}

export async function updatePreferenceAction(
  kind: NotificationKindCode,
  patch: UpdatePreferencePatch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api(`/api/v1/notifications/preferences/${kind}`, {
      method: 'PATCH',
      body: patch,
    });
    revalidateSettings();
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `HTTP ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
}

export interface BulkChannelResult {
  ok: boolean;
  error?: string;
  /** Kinds whose PATCH actually landed — the client reconciles against these. */
  succeededKinds: NotificationKindCode[];
}

/**
 * Bulk-toggle a single channel (in-app / email / push) across many notification
 * kinds in one round-trip. Backs the "tout activer / désactiver" column action
 * in the notification preferences panel. PATCHes run in parallel server-side so
 * the client never has to fan out N requests.
 *
 * The endpoint has no transactional bulk variant, so a partial failure is
 * possible: some PATCHes land while others reject. We therefore use
 * `Promise.allSettled` and report exactly which kinds succeeded, letting the
 * client keep the confirmed changes and revert only the failed ones — instead
 * of a blanket rollback that would desync the UI from the server.
 */
export async function setChannelForKindsAction(
  kinds: NotificationKindCode[],
  channel: keyof UpdatePreferencePatch,
  enabled: boolean,
): Promise<BulkChannelResult> {
  const results = await Promise.allSettled(
    kinds.map((kind) =>
      api(`/api/v1/notifications/preferences/${kind}`, {
        method: 'PATCH',
        body: { [channel]: enabled } as UpdatePreferencePatch,
      }),
    ),
  );

  const succeededKinds = kinds.filter((_, i) => results[i]?.status === 'fulfilled');
  revalidateSettings();

  if (succeededKinds.length === kinds.length) {
    return { ok: true, succeededKinds };
  }

  const firstRejected = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  const reason = firstRejected?.reason;
  const error =
    reason instanceof ApiError ? `HTTP ${reason.status}` : ((reason as Error)?.message ?? 'Erreur');
  return { ok: false, error, succeededKinds };
}

/**
 * Bulk-set the email *cadence* across many notification kinds in one round-trip.
 * Backs the header "Tout mettre en sourdine" mute (→ `off` for every per-event
 * kind) and its inverse "Tout réactiver" (→ `instant`). Same partial-failure
 * reconciliation contract as {@link setChannelForKindsAction}: the client keeps
 * the kinds that actually landed and reverts only the rejected ones.
 *
 * Cadence governs the *email* channel only, so the channel booleans are left
 * untouched server-side — muting is a reversible soft snooze (FR-2 / data-model
 * §1.2). The caller excludes the email-only weekly digest from this set (it is
 * its own summary row, never a per-event cadence kind).
 */
export async function setCadenceForKindsAction(
  kinds: NotificationKindCode[],
  cadence: NotificationCadenceCode,
): Promise<BulkChannelResult> {
  const results = await Promise.allSettled(
    kinds.map((kind) =>
      api(`/api/v1/notifications/preferences/${kind}`, {
        method: 'PATCH',
        body: { cadence } as UpdatePreferencePatch,
      }),
    ),
  );

  const succeededKinds = kinds.filter((_, i) => results[i]?.status === 'fulfilled');
  revalidateSettings();

  if (succeededKinds.length === kinds.length) {
    return { ok: true, succeededKinds };
  }

  const firstRejected = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  const reason = firstRejected?.reason;
  const error =
    reason instanceof ApiError ? `HTTP ${reason.status}` : ((reason as Error)?.message ?? 'Erreur');
  return { ok: false, error, succeededKinds };
}
