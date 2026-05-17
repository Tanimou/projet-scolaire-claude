'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { fetchSignedUrlAction } from './actions';

/**
 * Client button that resolves a fresh pre-signed S3 URL (1 h TTL) on click,
 * then opens the file in a new tab. We don't bake URLs into the table HTML
 * because they expire — and tend to leak via referrer/search if shared.
 */
export function ExportDownloadButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle() {
    setError(null);
    startTransition(async () => {
      const res = await fetchSignedUrlAction(id);
      if (res.ok && res.url) {
        window.open(res.url, '_blank', 'noopener');
      } else {
        setError(res.error ?? 'Échec du téléchargement');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        Télécharger
      </button>
      {error && <span className="text-[10px] text-rose-600">{error}</span>}
    </div>
  );
}
