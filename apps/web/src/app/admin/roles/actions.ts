'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { api, ApiError } from '@/lib/api-client';

export interface CreateRolePayload {
  name: string;
  slug: string;
  description?: string;
  portal: 'admin' | 'teacher' | 'parent';
  permissionCodes: string[];
}

export async function createRoleAction(
  payload: CreateRolePayload,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await api<{ id: string }>(`/api/v1/roles`, { method: 'POST', body: payload });
    revalidatePath('/admin/roles');
    revalidatePath('/admin/users');
    return { ok: true, id: res.id };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string | { message: string; missing?: string[] } };
      const msg = typeof body?.message === 'string' ? body.message : body?.message?.message ?? `HTTP ${err.status}`;
      return { ok: false, error: msg };
    }
    return { ok: false, error: (err as Error).message };
  }
}

export async function updateRoleAction(
  id: string,
  patch: { name?: string; description?: string; permissionCodes?: string[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api(`/api/v1/roles/${id}`, { method: 'PATCH', body: patch });
    revalidatePath('/admin/roles');
    revalidatePath(`/admin/roles/${id}/edit`);
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string };
      return { ok: false, error: body?.message ?? `HTTP ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}

export async function deleteRoleAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api(`/api/v1/roles/${id}`, { method: 'DELETE' });
    revalidatePath('/admin/roles');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string };
      return { ok: false, error: body?.message ?? `HTTP ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}

export async function createRoleAndRedirect(payload: CreateRolePayload) {
  const result = await createRoleAction(payload);
  if (result.ok) redirect('/admin/roles');
  return result;
}
