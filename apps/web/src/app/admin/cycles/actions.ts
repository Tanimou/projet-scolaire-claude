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
  revalidatePath('/admin/cycles');
  revalidatePath('/admin/dashboard');
  revalidatePath('/admin/subjects');
  revalidatePath('/admin/classes');
}

export async function createCycle(payload: { code: string; name: string; orderIndex: number; color?: string; icon?: string }): Promise<Result> {
  try {
    await api('/api/v1/cycles', { method: 'POST', body: payload });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function updateCycle(
  id: string,
  patch: { name?: string; orderIndex?: number; color?: string; icon?: string },
): Promise<Result> {
  try {
    await api(`/api/v1/cycles/${id}`, { method: 'PATCH', body: patch });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deleteCycle(id: string): Promise<Result> {
  try {
    await api(`/api/v1/cycles/${id}`, { method: 'DELETE' });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function createGradeLevel(cycleId: string, payload: { code: string; name: string; orderIndex: number }): Promise<Result> {
  try {
    await api(`/api/v1/cycles/${cycleId}/grade-levels`, { method: 'POST', body: payload });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deleteGradeLevel(levelId: string): Promise<Result> {
  try {
    await api(`/api/v1/cycles/grade-levels/${levelId}`, { method: 'DELETE' });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
