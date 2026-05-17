'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError } from '@/lib/api-client';

export interface InvitePayload {
  email: string;
  firstName: string;
  lastName: string;
  realmRole: 'school_admin' | 'teacher' | 'parent';
  customRoleSlug?: string;
}

export async function inviteUserAction(
  payload: InvitePayload,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  try {
    const res = await api<{ emailSentTo: string }>('/api/v1/users/invite', {
      method: 'POST',
      body: payload,
    });
    revalidatePath('/admin/users');
    return { ok: true, email: res.emailSentTo };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string } | null;
      const msg =
        typeof body?.message === 'string'
          ? body.message
          : err.status === 409
            ? "L'email existe déjà dans Keycloak."
            : `HTTP ${err.status}`;
      return { ok: false, error: msg };
    }
    return { ok: false, error: (err as Error).message };
  }
}
