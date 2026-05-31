'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';

export interface SelfProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
  bio: string | null;
  isTeacher: boolean;
  specialty: string | null;
  hiredAt: string | null;
  externalRef: string | null;
}

export interface UpdateProfilePatch {
  phone?: string;
  specialty?: string;
  bio?: string;
}

export async function updateTeacherProfileAction(
  patch: UpdateProfilePatch,
): Promise<ApiResult<SelfProfile>> {
  try {
    const res = await api<{ data: SelfProfile }>('/api/v1/me/profile', {
      method: 'PATCH',
      body: patch,
    });
    revalidatePath('/teacher/settings');
    revalidatePath('/teacher/dashboard');
    return { ok: true, data: res.data };
  } catch (err) {
    return apiResultFromError(err);
  }
}
