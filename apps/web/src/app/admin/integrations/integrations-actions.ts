'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';

import type { OneRosterBundleInput, RosterSourceDto, RosterSourceKind, SyncResultDto } from './types';

/**
 * E11-S3 — OneRoster integration server actions ("/admin/integrations").
 *
 * Thin `'use server'` wrappers over the `integrations.write`-gated endpoints.
 * Every wall (tenant scope, credential sealing, the validate-via-handler map) is
 * enforced server-side; these only normalise the result and revalidate the
 * integrations surface. The credential is sent once on connect and never read
 * back. The Result mirrors the remediation-actions house style (apiResultFromError).
 */

export interface ConnectSourceInput {
  kind: RosterSourceKind;
  label: string;
  baseUrl?: string;
  credential?: string;
}

/** Connect a new roster source (create a RosterSource). */
export async function connectSourceAction(input: ConnectSourceInput): Promise<ApiResult<RosterSourceDto>> {
  try {
    const data = await api<RosterSourceDto>('/api/v1/integrations/oneroster', {
      method: 'POST',
      body: input,
    });
    revalidatePath('/admin/integrations');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

/**
 * Pull + map a OneRoster CSV bundle into validated ImportBatch(es). On success
 * the UI navigates to the produced batch's detail/health surface.
 */
export async function syncSourceAction(
  sourceId: string,
  bundle: OneRosterBundleInput,
): Promise<ApiResult<SyncResultDto>> {
  try {
    const data = await api<SyncResultDto>(`/api/v1/integrations/oneroster/${sourceId}/sync`, {
      method: 'POST',
      body: { bundle },
    });
    revalidatePath('/admin/integrations');
    revalidatePath('/admin/imports');
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}
