'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, isNextNavigationSignal } from '@/lib/api-client';

/**
 * S-E06-3 — widened to the `admin/students/actions.ts` generic shape so a create
 * action can return the created row's id (the redirect target). `updateClass` /
 * `deleteClass` keep the default type parameter; their only consumer
 * (`ClassInfoEditor`) reads `.ok` / `.error`, which is source-compatible.
 */
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

function bust() {
  revalidatePath('/admin/classes');
  revalidatePath('/admin/dashboard');
}

/** Options pédagogiques : dictionnaire libre clé → valeur. */
export type ClassOptions = Record<string, unknown>;

export async function createClass(payload: {
  name: string;
  academicYearId: string;
  gradeLevelId: string;
  maxStudents?: number;
  room?: string;
  color?: string;
  icon?: string;
  options?: ClassOptions;
  internalNotes?: string;
}): Promise<Result<{ id: string }>> {
  try {
    const data = await api<{ id: string }>('/api/v1/classes', { method: 'POST', body: payload });
    // `bust()` revalidates /admin/classes (+ the dashboard), which is what makes
    // the freshly created class appear in the list on the way back.
    bust();
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function updateClass(
  id: string,
  patch: {
    name?: string;
    maxStudents?: number;
    status?: 'active' | 'closed';
    room?: string | null;
    color?: string | null;
    icon?: string | null;
    options?: ClassOptions | null;
    internalNotes?: string | null;
  },
): Promise<Result> {
  try {
    const data = await api(`/api/v1/classes/${id}`, { method: 'PATCH', body: patch });
    bust();
    revalidatePath(`/admin/classes/${id}`);
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function deleteClass(id: string): Promise<Result> {
  try {
    const data = await api(`/api/v1/classes/${id}`, { method: 'DELETE' });
    bust();
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}
