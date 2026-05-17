'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError } from '@/lib/api-client';

export async function markReadAction(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await api(`/api/v1/notifications/${id}/read`, { method: 'POST' });
    revalidatePath('/admin/notifications');
    revalidatePath('/teacher/notifications');
    revalidatePath('/parent/notifications');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `HTTP ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
}

export async function markAllReadAction(): Promise<{ ok: boolean; count?: number; error?: string }> {
  try {
    const res = await api<{ ok: true; count: number }>('/api/v1/notifications/read-all', {
      method: 'POST',
    });
    revalidatePath('/admin/notifications');
    revalidatePath('/teacher/notifications');
    revalidatePath('/parent/notifications');
    return { ok: true, count: res.count };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `HTTP ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
}
