'use client';

import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';

/**
 * Screen-only toolbar for the printable report. Hidden when printing
 * (`print:hidden`). The print button calls the browser print dialog, from
 * which the parent can save as PDF or print on paper — no server-side PDF
 * generation needed (that lands later via the R7 worker).
 */
export function ReportToolbar({
  backHref,
  childName,
}: {
  backHref: string;
  childName: string;
}) {
  return (
    <div className="print:hidden sticky top-0 z-10 border-b border-slate-200 bg-white/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[820px] flex-wrap items-center justify-between gap-3 px-5 py-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Retour au profil
        </Link>
        <div className="min-w-0 text-center">
          <p className="truncate text-xs font-semibold text-slate-500">
            Bilan de suivi · {childName}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700"
        >
          <Printer className="h-3.5 w-3.5" />
          Imprimer / Enregistrer en PDF
        </button>
      </div>
    </div>
  );
}
