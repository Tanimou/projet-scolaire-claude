'use client';

import { MoreHorizontal, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { deleteStudent } from './actions';

export function StudentRowActions({
  studentId,
  hasEnrollments,
}: {
  studentId: string;
  hasEnrollments: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onDelete = async () => {
    if (hasEnrollments) {
      alert(
        "Cet élève a un historique d'inscriptions. Marquez-le « retiré » depuis sa fiche au lieu de le supprimer.",
      );
      return;
    }
    if (!confirm('Supprimer définitivement cet élève ?')) return;
    setBusy(true);
    setErr(null);
    const res = await deleteStudent(studentId);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      alert(res.error);
    } else router.refresh();
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/admin/students/${studentId}`}
        className="rounded-md px-2 py-1 text-xs font-bold accent-text hover:bg-slate-100"
      >
        Détail
      </Link>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
        title="Supprimer"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      {err && <span className="sr-only">{err}</span>}
    </div>
  );
}
