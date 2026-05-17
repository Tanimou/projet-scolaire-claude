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

export async function createSchool(payload: Record<string, unknown>): Promise<Result> {
  try {
    const data = await api('/api/v1/schools', { method: 'POST', body: payload });
    revalidatePath('/admin/schools');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function switchActiveSchool(id: string): Promise<Result> {
  try {
    const data = await api(`/api/v1/schools/${id}/switch`, { method: 'POST' });
    revalidatePath('/', 'layout'); // refresh everything since context changes
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}
