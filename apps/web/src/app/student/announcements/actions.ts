'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError } from '@/lib/api-client';

/**
 * Mark the caller's OWN announcement receipt read (E8-S3) — the ONE mutation a
 * student may make on their own data. Self-scoped server-side on the caller's
 * `userProfileId` (the `:id` is an announcementId, NOT a studentId → no IDOR);
 * idempotent, 404 when the caller has no receipt for that announcement.
 *
 * Hits the student-portal route (`announcements.read.self`), NEVER the broad
 * parent/admin `POST /announcements/:id/read` (which the student lacks the
 * permission for — it would 403).
 */
export async function markStudentAnnouncementReadAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api(`/api/v1/student/announcements/${id}/read`, { method: 'POST' });
    revalidatePath('/student/announcements');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `HTTP ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
}
