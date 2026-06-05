'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { fetchBulletinUrlAction } from './actions';

/**
 * Parent-scoped clone of the admin `ExportDownloadButton`. Resolves a fresh 1 h
 * pre-signed S3 URL for one of the caller's OWN succeeded bulletin jobs on click,
 * then opens the PDF in a new tab. We never bake URLs into the HTML — they expire
 * and tend to leak via referrer/search if shared.
 *
 * `label` is woven into the accessible name (term + child) so a screen-reader
 * user hears exactly which bulletin they're about to download.
 */
export function ParentBulletinDownloadButton({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle() {
    setError(null);
    startTransition(async () => {
      const res = await fetchBulletinUrlAction(id);
      if (res.ok && res.url) {
        window.open(res.url, '_blank', 'noopener');
      } else {
        setError("Le lien n'a pas pu être généré. Réessayez dans un instant.");
      }
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        aria-label={label}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none sm:text-xs"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Download className="h-4 w-4" aria-hidden />
        )}
        Télécharger le bulletin
      </button>
      {error && (
        <span role="alert" className="text-[11px] font-medium text-rose-600">
          {error}
        </span>
      )}
    </div>
  );
}
