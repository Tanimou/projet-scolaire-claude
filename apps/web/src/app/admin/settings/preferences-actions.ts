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

/**
 * Bulk-toggle a single channel (in-app / email / push) across many notification
 * kinds in one round-trip. Backs the "tout activer / désactiver" column action
 * in the notification preferences panel. PATCHes run in parallel server-side so
 * the client never has to fan out N requests.
 */
export async function setChannelForKindsAction(
  kinds: NotificationKindCode[],
  channel: keyof UpdatePreferencePatch,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await Promise.all(
      kinds.map((kind) =>
        api(`/api/v1/notifications/preferences/${kind}`, {
          method: 'PATCH',
          body: { [channel]: enabled } as UpdatePreferencePatch,
        }),
      ),
    );
    revalidateSettings();
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `HTTP ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
}
