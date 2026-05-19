'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';

import type {
  DisplayPreferences,
  UpdateDisplayPreferencesPatch,
} from './display-prefs-types';

export async function updateDisplayPreferencesAction(
  patch: UpdateDisplayPreferencesPatch,
): Promise<ApiResult<DisplayPreferences>> {
  try {
    const res = await api<{ data: DisplayPreferences }>('/api/v1/me/display-preferences', {
      method: 'PATCH',
      body: patch,
    });
    revalidatePath('/admin/settings');
    revalidatePath('/teacher/settings');
    revalidatePath('/parent/settings');
    return { ok: true, data: res.data };
  } catch (err) {
    return apiResultFromError(err);
  }
}
