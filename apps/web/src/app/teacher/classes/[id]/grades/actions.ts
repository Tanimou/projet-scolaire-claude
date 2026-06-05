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

export async function createAssessment(payload: Record<string, unknown>): Promise<Result<{ id: string }>> {
  try {
    const data = await api<{ id: string }>('/api/v1/assessments', { method: 'POST', body: payload });
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function saveGrades(payload: Record<string, unknown>): Promise<Result> {
  try {
    const data = await api('/api/v1/grades/batch', { method: 'POST', body: payload });
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function flagGrade(
  gradeId: string,
  flagged: boolean,
  note?: string,
): Promise<Result> {
  try {
    const body: { flagged: boolean; note?: string } = { flagged };
    if (note !== undefined) body.note = note;
    const data = await api(`/api/v1/grades/${gradeId}/flag`, { method: 'PATCH', body });
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function publishAssessment(id: string): Promise<Result> {
  try {
    const data = await api(`/api/v1/assessments/${id}/publish`, { method: 'POST' });
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function refresh(teachingAssignmentId: string) {
  revalidatePath(`/teacher/classes/${teachingAssignmentId}/grades`);
}
