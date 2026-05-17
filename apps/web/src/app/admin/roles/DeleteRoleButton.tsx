'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { deleteRoleAction } from './actions';

export function DeleteRoleButton({ roleId, roleName }: { roleId: string; roleName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    if (!confirm(`Supprimer le rôle « ${roleName} » ? Cette action est journalisée et irréversible.`)) return;
    setBusy(true);
    const res = await deleteRoleAction(roleId);
    setBusy(false);
    if (!res.ok) {
      alert(`Suppression impossible : ${res.error}`);
      return;
    }
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      className="inline-flex items-center gap-1 text-xs font-medium text-red-700 transition hover:underline disabled:opacity-50"
      aria-label={`Supprimer ${roleName}`}
    >
      <Trash2 className="h-3 w-3" />
      Supprimer
    </button>
  );
}
