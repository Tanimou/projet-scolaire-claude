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

export async function updatePreferenceAction(
  kind: NotificationKindCode,
  patch: UpdatePreferencePatch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api(`/api/v1/notifications/preferences/${kind}`, {
      method: 'PATCH',
      body: patch,
    });
    revalidatePath('/admin/settings');
    revalidatePath('/teacher/settings');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `HTTP ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
}
