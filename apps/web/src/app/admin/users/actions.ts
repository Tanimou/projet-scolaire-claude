'use server';

import { revalidatePath } from 'next/cache';

import { api } from '@/lib/api-client';

export async function assignRoleAction(userId: string, roleId: string) {
  await api(`/api/v1/users/${userId}/roles`, { method: 'POST', body: { roleId } });
  revalidatePath('/admin/users');
}

export async function revokeRoleAction(userRoleId: string) {
  await api(`/api/v1/users/roles/${userRoleId}`, { method: 'DELETE' });
  revalidatePath('/admin/users');
}
