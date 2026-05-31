'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError } from '@/lib/api-client';

export type NotificationKindCode =
  | 'announcement'
  | 'alert'
  | 'grade_published'
  | 'enrollment_status'
  | 'lesson_published'
  | 'system';

export interface UpdatePreferencePatch {
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
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
