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
  revalidatePath('/admin/subjects');
  revalidatePath('/admin/dashboard');
}

export async function createSubject(payload: {
  code: string;
  name: string;
  defaultCoefficient?: number;
  color?: string;
  icon?: string;
}): Promise<Result> {
  try {
    await api('/api/v1/subjects', { method: 'POST', body: payload });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function updateSubject(
  id: string,
  patch: { name?: string; defaultCoefficient?: number; color?: string; icon?: string; active?: boolean },
): Promise<Result> {
  try {
    await api(`/api/v1/subjects/${id}`, { method: 'PATCH', body: patch });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deactivateSubject(id: string): Promise<Result> {
  try {
    await api(`/api/v1/subjects/${id}`, { method: 'DELETE' });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function saveCoefficients(
  entries: { gradeLevelId: string; subjectId: string; coefficient: number }[],
): Promise<Result> {
  try {
    await api('/api/v1/subjects/coefficients/matrix', { method: 'PUT', body: { entries } });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
