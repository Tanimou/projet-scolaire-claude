'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError } from '@/lib/api-client';

export async function saveBranding(
  schoolId: string,
  patch: {
    displayName?: string;
    primaryColor?: string;
    accentColor?: string | null;
    fontFamily?: string | null;
    logoUrl?: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api(`/api/v1/schools/${schoolId}/branding`, {
      method: 'PATCH',
      body: patch,
    });
    revalidatePath('/admin/school/branding');
    revalidatePath('/admin/dashboard');
    revalidatePath('/teacher/dashboard');
    revalidatePath('/parent/dashboard');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string } | null;
      return { ok: false, error: body?.message ?? `HTTP ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}
