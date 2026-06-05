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

// ── E4-S3 — teacher class grade-grid export (XLSX) ─────────────────────────
// Mirrors the admin/parent exports pattern: enqueue → poll → signed-URL-on-click
// download, over the NEW teacher-permitted surface (`exports.execute.teacher`).
// The API re-checks teaching-assignment ownership and SERVER-derives the
// classSectionId from the OWNED assignment — the client only ever sends
// `{ teachingAssignmentId, termId? }` (anti foreign-class export / IDOR).

export type TeacherExportStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/**
 * A teacher-visible grade-grid export job, scoped to the caller's own
 * `grades_xlsx` jobs. Mirrors `@pilotage/contracts` `TeacherExportJob` — kept as
 * a local type so the page server-component can consume it without pulling the
 * zod schema into the RSC bundle.
 */
export interface TeacherExportJob {
  id: string;
  status: TeacherExportStatus;
  fileSizeBytes: number | null;
  classSectionId: string | null;
  termId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/**
 * Enqueue a teacher class grade-grid XLSX export via
 * POST /api/v1/teacher/exports/grade-grid. Body is minimal — the API re-checks
 * teaching-assignment ownership and derives the class section server-side.
 */
export async function createGradeGridAction(
  teachingAssignmentId: string,
  termId?: string,
): Promise<Result<{ id: string }>> {
  try {
    const body: { teachingAssignmentId: string; termId?: string } = {
      teachingAssignmentId,
    };
    if (termId) body.termId = termId;
    const data = await api<{ id: string }>('/api/v1/teacher/exports/grade-grid', {
      method: 'POST',
      body,
    });
    revalidatePath(`/teacher/classes/${teachingAssignmentId}/grades`);
    return { ok: true, data };
  } catch (err) {
    return toError(err);
  }
}

/**
 * Fetch the caller's OWN most-recent grade-grid job for a given class section
 * (newest first, server-scoped to `requestedBy = me`). Used by the export
 * button to poll status while a generation is in-flight.
 */
export async function latestGradeGridJobAction(
  classSectionId: string,
): Promise<{ ok: true; job: TeacherExportJob | null } | { ok: false; error: string }> {
  try {
    const res = await api<{ data: TeacherExportJob[] }>(
      `/api/v1/teacher/exports?classSectionId=${encodeURIComponent(classSectionId)}&limit=1`,
    );
    return { ok: true, job: res.data[0] ?? null };
  } catch (err) {
    if (isNextNavigationSignal(err)) throw err;
    if (err instanceof ApiError) return { ok: false, error: `HTTP ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Resolve a fresh 1 h pre-signed download URL for one of the caller's OWN
 * succeeded grade-grid jobs via GET /api/v1/teacher/exports/:id/download-url.
 * The API re-asserts `requestedBy = me` (404 otherwise). The URL is resolved on
 * click (never baked into the HTML) because it expires.
 */
export async function fetchGradeGridUrlAction(
  id: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const res = await api<{ url: string }>(`/api/v1/teacher/exports/${id}/download-url`);
    return { ok: true, url: res.url };
  } catch (err) {
    if (isNextNavigationSignal(err)) throw err;
    if (err instanceof ApiError) return { ok: false, error: `HTTP ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
}
