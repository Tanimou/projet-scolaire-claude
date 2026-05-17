'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError } from '@/lib/api-client';

export async function markAnnouncementReadAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api(`/api/v1/announcements/${id}/read`, { method: 'POST' });
    revalidatePath('/parent/announcements');
    revalidatePath(`/parent/announcements/${id}`);
    revalidatePath('/parent/notifications');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `HTTP ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
}
