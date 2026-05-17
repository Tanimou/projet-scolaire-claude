'use client';

import { Loader2, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { deleteTeacherAnnouncement, publishTeacherAnnouncement } from './actions';

export function MessageRowActions({ id, published }: { id: string; published: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onPublish = async () => {
    if (!confirm('Publier maintenant ? Les familles concernées seront notifiées.')) return;
    setBusy(true);
    const res = await publishTeacherAnnouncement(id);
    setBusy(false);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    router.refresh();
  };

  const onDelete = async () => {
    if (!confirm('Supprimer ce message ? Cette action est irréversible.')) return;
    setBusy(true);
    const res = await deleteTeacherAnnouncement(id);
    setBusy(false);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex items-center justify-end gap-1">
      {!published && (
        <button
          type="button"
          onClick={onPublish}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
          aria-label="Publier l'annonce"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Publier
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="grid h-7 w-7 place-items-center rounded-md text-red-500 transition hover:bg-red-50 disabled:opacity-50"
        aria-label="Supprimer l'annonce"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
