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

export async function createStudent(payload: Record<string, unknown>): Promise<Result<{ id: string }>> {
  try {
    const data = await api<{ id: string }>('/api/v1/students', { method: 'POST', body: payload });
    revalidatePath('/admin/students');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function updateStudent(id: string, payload: Record<string, unknown>): Promise<Result> {
  try {
    const data = await api(`/api/v1/students/${id}`, { method: 'PATCH', body: payload });
    revalidatePath('/admin/students');
    revalidatePath(`/admin/students/${id}`);
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function deleteStudent(id: string): Promise<Result> {
  try {
    const data = await api(`/api/v1/students/${id}`, { method: 'DELETE' });
    revalidatePath('/admin/students');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function enrollStudent(
  studentId: string,
  classSectionId: string,
): Promise<Result> {
  try {
    const data = await api('/api/v1/enrollments', {
      method: 'POST',
      body: { studentId, classSectionId },
    });
    revalidatePath('/admin/students');
    revalidatePath(`/admin/students/${studentId}`);
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function transferEnrollment(
  studentId: string,
  enrollmentId: string,
  toClassSectionId: string,
  reason?: string,
): Promise<Result> {
  try {
    const data = await api(`/api/v1/enrollments/${enrollmentId}/transfer`, {
      method: 'POST',
      body: { toClassSectionId, reason },
    });
    revalidatePath(`/admin/students/${studentId}`);
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function endEnrollment(
  studentId: string,
  enrollmentId: string,
  status: string,
  reason?: string,
): Promise<Result> {
  try {
    const data = await api(`/api/v1/enrollments/${enrollmentId}`, {
      method: 'PATCH',
      body: { status, reason },
    });
    revalidatePath(`/admin/students/${studentId}`);
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function attachGuardian(
  studentId: string,
  guardianPayload: Record<string, unknown>,
  relationship: string,
  isPrimaryContact: boolean,
): Promise<Result> {
  try {
    let guardianId = guardianPayload.guardianId as string | undefined;
    if (!guardianId) {
      const newG = await api<{ id: string }>('/api/v1/guardians', {
        method: 'POST',
        body: guardianPayload,
      });
      guardianId = newG.id;
    }
    const data = await api('/api/v1/guardians/guardianships', {
      method: 'POST',
      body: { guardianId, studentId, relationship, isPrimaryContact },
    });
    revalidatePath(`/admin/students/${studentId}`);
    revalidatePath('/admin/guardians');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function revokeGuardianship(
  studentId: string,
  guardianshipId: string,
): Promise<Result> {
  try {
    const data = await api(`/api/v1/guardians/guardianships/${guardianshipId}`, {
      method: 'DELETE',
    });
    revalidatePath(`/admin/students/${studentId}`);
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}
