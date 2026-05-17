'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, isNextNavigationSignal } from '@/lib/api-client';

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

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
  revalidatePath('/admin/academic-years');
  revalidatePath('/admin/dashboard');
  revalidatePath('/admin/classes');
}

export async function createAcademicYear(payload: {
  name: string;
  startDate: string;
  endDate: string;
  status?: 'active' | 'closed' | 'archived';
}): Promise<Result> {
  try {
    await api(`/api/v1/academic-years`, { method: 'POST', body: payload });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function updateAcademicYear(
  id: string,
  patch: { name?: string; startDate?: string; endDate?: string; status?: 'active' | 'closed' | 'archived' },
): Promise<Result> {
  try {
    await api(`/api/v1/academic-years/${id}`, { method: 'PATCH', body: patch });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deleteAcademicYear(id: string): Promise<Result> {
  try {
    await api(`/api/v1/academic-years/${id}`, { method: 'DELETE' });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function createTerm(
  yearId: string,
  payload: { name: string; orderIndex: number; startDate: string; endDate: string },
): Promise<Result> {
  try {
    await api(`/api/v1/academic-years/${yearId}/terms`, { method: 'POST', body: payload });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deleteTerm(termId: string): Promise<Result> {
  try {
    await api(`/api/v1/academic-years/terms/${termId}`, { method: 'DELETE' });
    bust();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
