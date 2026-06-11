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

export async function uploadImport(type: string, payload: { fileName: string; rawCsv: string }): Promise<Result<{ id: string }>> {
  try {
    const data = await api<{ id: string }>(`/api/v1/imports/${type}/upload`, {
      method: 'POST',
      body: payload,
    });
    revalidatePath('/admin/imports');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function applyImport(id: string, mode: 'all_or_nothing' | 'skip_invalid'): Promise<Result> {
  try {
    const data = await api(`/api/v1/imports/${id}/apply`, { method: 'POST', body: { mode } });
    revalidatePath(`/admin/imports/${id}`);
    revalidatePath('/admin/imports');
    revalidatePath('/admin/classes');
    revalidatePath('/admin/subjects');
    revalidatePath('/admin/dashboard');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function resolveImportConflict(
  batchId: string,
  rowId: string,
  decision: 'keep_current' | 'take_source',
): Promise<Result> {
  try {
    const data = await api(`/api/v1/imports/${batchId}/conflicts/${rowId}/resolve`, {
      method: 'POST',
      body: { decision },
    });
    revalidatePath(`/admin/imports/${batchId}`);
    revalidatePath('/admin/dashboard');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

export async function rollbackImport(id: string): Promise<Result> {
  try {
    const data = await api(`/api/v1/imports/${id}/rollback`, { method: 'POST' });
    revalidatePath(`/admin/imports/${id}`);
    revalidatePath('/admin/imports');
    revalidatePath('/admin/classes');
    revalidatePath('/admin/subjects');
    revalidatePath('/admin/dashboard');
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}
