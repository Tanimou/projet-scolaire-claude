'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, isNextNavigationSignal } from '@/lib/api-client';

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

function toError(err: unknown): Result<never> {
  if (isNextNavigationSignal(err)) throw err;
  if (err instanceof ApiError) {
    const body = err.body as { message?: string | string[] } | null;
    const msg = Array.isArray(body?.message) ? body!.message.join(' · ') : (body?.message ?? `HTTP ${err.status}`);
    return { ok: false, error: msg };
  }
  return { ok: false, error: (err as Error).message };
}

export async function createAssignment(payload: Record<string, unknown>): Promise<Result> {
  try {
    const data = await api('/api/v1/teaching-assignments', { method: 'POST', body: payload });
    revalidatePath('/admin/teaching-assignments');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function updateAssignment(id: string, payload: Record<string, unknown>): Promise<Result> {
  try {
    const data = await api(`/api/v1/teaching-assignments/${id}`, { method: 'PATCH', body: payload });
    revalidatePath('/admin/teaching-assignments');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function deleteAssignment(id: string): Promise<Result> {
  try {
    const data = await api(`/api/v1/teaching-assignments/${id}`, { method: 'DELETE' });
    revalidatePath('/admin/teaching-assignments');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}
