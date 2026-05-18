'use server';

import { redirect } from 'next/navigation';

import { api, ApiError } from '@/lib/api-client';

/**
 * Enqueue an audit CSV export (last 90 days by default — the worker honours
 * optional `from` / `to` parameters). Redirects the user to `/admin/exports`
 * where they can watch the job progress and grab the signed download URL.
 */
export async function exportAuditAction(formData: FormData): Promise<void> {
  const from = (formData.get('from') as string) || undefined;
  const to = (formData.get('to') as string) || undefined;
  try {
    await api<{ id: string }>('/api/v1/exports', {
      method: 'POST',
      body: { kind: 'audit_csv', parameters: { from, to } },
    });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    // Surfacing a flash is overkill for an admin-only screen; admins land on
    // /admin/exports and immediately see the row in `Échec` if anything broke.
  }
  redirect('/admin/exports');
}
