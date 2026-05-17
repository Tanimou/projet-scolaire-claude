'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError } from '@/lib/api-client';

export type AlertRuleCode =
  | 'LOW_SUBJECT_AVG'
  | 'NEGATIVE_TREND'
  | 'REPEATED_FAILURE'
  | 'MISSING_ASSESSMENT'
  | 'HIGH_ABSENCE'
  | 'TEACHER_COMMENT_FLAG'
  | 'BEHAVIOR_ALERT';

export interface ActionResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

async function callApi<T = unknown>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: unknown,
): Promise<ActionResult> {
  try {
    const data = await api<T>(path, { method, body });
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ApiError) {
      const msg =
        typeof err.body === 'object' && err.body && 'message' in err.body
          ? String((err.body as { message: unknown }).message)
          : `HTTP ${err.status}`;
      return { ok: false, error: msg };
    }
    return { ok: false, error: (err as Error).message };
  }
}

export async function toggleRuleAction(code: AlertRuleCode, enabled: boolean) {
  const res = await callApi(`/api/v1/alerts/rules/${code}`, 'PATCH', { enabled });
  if (res.ok) revalidatePath('/admin/alerts');
  return res;
}

export async function acknowledgeAlertAction(id: string) {
  const res = await callApi(`/api/v1/alerts/instances/${id}/acknowledge`, 'POST');
  if (res.ok) revalidatePath('/admin/alerts');
  return res;
}

export async function resolveAlertAction(id: string) {
  const res = await callApi(`/api/v1/alerts/instances/${id}/resolve`, 'POST');
  if (res.ok) revalidatePath('/admin/alerts');
  return res;
}

export async function dismissAlertAction(id: string) {
  const res = await callApi(`/api/v1/alerts/instances/${id}/dismiss`, 'POST');
  if (res.ok) revalidatePath('/admin/alerts');
  return res;
}

export async function evaluateNowAction() {
  const res = await callApi(`/api/v1/alerts/evaluate`, 'POST', {});
  if (res.ok) revalidatePath('/admin/alerts');
  return res;
}
