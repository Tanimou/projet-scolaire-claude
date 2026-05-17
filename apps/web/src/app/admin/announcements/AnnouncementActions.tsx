'use client';

import { Loader2, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { deleteAnnouncement, publishAnnouncement } from './actions';

export function AnnouncementActions({ id, published }: { id: string; published: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onPublish = async () => {
    if (!confirm("Publier maintenant ? Les destinataires recevront cette annonce.")) return;
    setBusy(true);
    const res = await publishAnnouncement(id);
    setBusy(false);
    if (!res.ok) alert(res.error);
    else router.refresh();
  };
  const onDelete = async () => {
    if (!confirm('Supprimer cette annonce ? Cette action est irréversible.')) return;
    setBusy(true);
    const res = await deleteAnnouncement(id);
    setBusy(false);
    if (!res.ok) alert(res.error);
    else router.refresh();
  };
  return (
    <div className="flex items-center gap-1">
      {!published && (
        <button
          type="button"
          onClick={onPublish}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Publier
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="grid h-7 w-7 place-items-center rounded-md text-red-500 hover:bg-red-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
