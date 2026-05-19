'use client';

import { Loader2, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { deleteAnnouncement, publishAnnouncement } from '../actions';

/**
 * Detail-page action group: publish (drafts only) + delete.
 *
 * On publish, refresh the page in place so the new recipient roster + stats
 * show up immediately. On delete, send the admin back to the communications
 * list since the detail page no longer exists.
 */
export function DetailActions({
  id,
  isDraft,
}: {
  id: string;
  isDraft: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'publish' | 'delete' | null>(null);

  const onPublish = async () => {
    if (
      !confirm('Publier maintenant ? Les destinataires recevront cette annonce.')
    ) {
      return;
    }
    setBusy('publish');
    const res = await publishAnnouncement(id);
    setBusy(null);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    router.refresh();
  };

  const onDelete = async () => {
    if (!confirm('Supprimer cette annonce ? Cette action est irréversible.')) return;
    setBusy('delete');
    const res = await deleteAnnouncement(id);
    setBusy(null);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    router.push('/admin/communications');
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      {isDraft && (
        <button
          type="button"
          onClick={onPublish}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === 'publish' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Publier maintenant
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-bold text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-50"
      >
        {busy === 'delete' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
        Supprimer
      </button>
    </div>
  );
}
