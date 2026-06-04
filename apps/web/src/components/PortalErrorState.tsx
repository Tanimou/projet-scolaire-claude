'use client';

import { AlertTriangle, ArrowLeft, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

import { Button } from '@pilotage/ui';

type Portal = 'admin' | 'teacher' | 'parent';

const PORTAL_LABEL: Record<Portal, string> = {
  admin: "l'espace administration",
  teacher: "l'espace professeur",
  parent: "l'espace parent",
};

/**
 * Branded fallback rendered by the portal `error.tsx` boundaries when a server
 * (or client) component throws — including transient API failures (the NestJS
 * API restarting → ECONNRESET) that would otherwise surface as Next.js' raw
 * white "Application error: a server-side exception has occurred" page.
 *
 * `reset()` re-renders the segment (retries the failed render); the link offers
 * a way back to the portal home if the retry keeps failing.
 */
export function PortalErrorState({
  error,
  reset,
  portal,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  portal?: Portal;
}) {
  useEffect(() => {
    // Surface the real cause in the browser/server console for diagnosis.
    console.error('[portal-error]', error);
  }, [error]);

  const homeHref = portal ? `/${portal}/dashboard` : '/';

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <AlertTriangle className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Une erreur est survenue</h1>
        <p className="mt-2 text-sm text-slate-500">
          Impossible d’afficher {portal ? PORTAL_LABEL[portal] : 'cette page'} pour le moment. Le
          problème est peut-être temporaire — réessayez dans un instant.
        </p>
        {error?.digest ? (
          <p className="mt-3 font-mono text-xs text-slate-400">Référence : {error.digest}</p>
        ) : null}
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button onClick={() => reset()} className="w-full sm:w-auto">
            <RotateCw className="h-4 w-4" aria-hidden />
            Réessayer
          </Button>
          <Link
            href={homeHref}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 sm:w-auto"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Retour au tableau de bord
          </Link>
        </div>
      </div>
    </div>
  );
}
