'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, isNextNavigationSignal } from '@/lib/api-client';

type Result = { ok: true } | { ok: false; error: string };

function toError(err: unknown): Result {
  if (isNextNavigationSignal(err)) throw err;
  if (err instanceof ApiError) {
    const body = err.body as { message?: string | string[] } | null;
    const msg = Array.isArray(body?.message) ? body!.message.join(' · ') : (body?.message ?? `HTTP ${err.status}`);
    return { ok: false, error: msg };
  }
  return { ok: false, error: (err as Error).message };
}

function bust() {
  revalidatePath('/admin/classes');
  revalidatePath('/admin/dashboard');
}

export async function createClass(payload: {
  name: string;
  academicYearId: string;
  gradeLevelId: string;
  maxStudents?: number;
}): Promise<Result> {
  try {
    await api('/api/v1/classes', { method: 'POST', body: payload });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function updateClass(
  id: string,
  patch: { name?: string; maxStudents?: number; status?: 'active' | 'closed' },
): Promise<Result> {
  try {
    await api(`/api/v1/classes/${id}`, { method: 'PATCH', body: patch });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deleteClass(id: string): Promise<Result> {
  try {
    await api(`/api/v1/classes/${id}`, { method: 'DELETE' });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
